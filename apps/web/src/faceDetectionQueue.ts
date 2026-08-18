/**
 * Watches the upload manager for newly-completed image uploads and runs
 * client-side face detection on them, posting any detected faces to the
 * worker for later clustering (see apps/worker/src/faceClustering.ts).
 *
 * Deliberately implemented as an EXTERNAL listener (uploadManager.subscribe)
 * rather than modifying uploadManager.ts's own upload logic — that file
 * handles chunked multipart uploads with a lot of retry/resume nuance (see
 * repo notes), so this stays fully decoupled: if face detection fails or
 * @vladmandic/human has a problem, uploads are completely unaffected.
 *
 * Uses the original File blob already held by the queue item (via
 * URL.createObjectURL) rather than re-fetching the uploaded image, which
 * avoids any auth/CORS considerations entirely and works identically on
 * web and native.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { uploadManager } from './services/uploadManager';
import { detectFaces } from './faceDetection';
import { saveFaces } from './api';
import FolderSync from './services/folderSyncPlugin';
import SafDirectory from './services/safDirectory';
import type { UploadQueueItem } from './types';

const processedIds = new Set<string>();
const MAX_TRACKED_IDS = 500;

/**
 * Detection tasks run STRICTLY ONE AT A TIME through this chain.
 *
 * Previously each completed upload was launched with a bare `void processItem(item)`. Since
 * uploadManager.notify() hands every listener the whole queue snapshot, a bulk upload started
 * a detection for each photo the moment it completed — with no cap. Detection takes seconds
 * per photo on a phone (BlazeFace + FaceMesh + an ArcFace ResNet100 ONNX inference) while
 * uploads finish 2-6 at a time, so tasks piled up faster than they drained. Each one holds a
 * decoded image plus model tensors, which is what exhausted the Android WebView's renderer
 * process and killed the whole app. Uploads themselves have had a concurrency cap for exactly
 * this reason (see MAX_CONCURRENT_UPLOADS in services/uploadManager.ts); this is the same
 * discipline applied to the work that follows them.
 *
 * A plain promise chain rather than a worker pool: the correct concurrency here is 1, and
 * anything that keeps two detections alive at once reintroduces the bug.
 */
let detectionChain: Promise<void> = Promise.resolve();

function enqueueDetection(task: () => Promise<void>): void {
  detectionChain = detectionChain.then(task, task);
}

function isImage(item: UploadQueueItem): boolean {
  const fileType = item.fileType || item.file?.type || '';
  return fileType.startsWith('image/') && fileType !== 'image/gif';
}

async function processItem(item: UploadQueueItem): Promise<void> {
  if (!item.photoId || !item.file) return;

  try {
    // The File is passed straight through — detectFaces() decodes it itself, capped at
    // ~1920px (see faceDetection.ts's DETECTION_MAX_DIMENSION), so no object URL and no
    // full-resolution decode is needed here.
    const faces = await detectFaces(item.file);
    if (faces.length > 0) {
      await saveFaces(item.eventSlug, item.photoId, faces);
    }
  } catch (err) {
    // Best-effort only — never let a face-detection failure surface anywhere.
    console.warn('[faceDetectionQueue] Failed to process item:', err);
  }
}

/**
 * Runs face detection for photos the NATIVE folder-sync engine uploaded.
 *
 * Those never pass through the upload manager — the engine streams them
 * straight from their content:// URIs in a background WorkManager job, with no
 * WebView alive — so the subscription below never sees them and they would
 * silently get no faces. The engine parks each uploaded image in its ledger
 * instead, and this drains that list whenever the app is open.
 *
 * Uses SafDirectory.readPreview() rather than reading the original: it returns
 * the same ~1920px JPEG the engine uploaded as the photo's preview, which is
 * ample for detection and, unlike reading a 108MP original through the
 * Capacitor bridge, cannot exhaust the WebView's memory.
 */
async function drainNativeFaceJobs(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { jobs } = await FolderSync.takePendingFaceJobs();
    for (const job of jobs) {
      try {
        const { data } = await SafDirectory.readPreview({ uri: job.uri });
        const blob = base64ToBlob(data, 'image/jpeg');
        const faces = await detectFaces(blob);
        if (faces.length > 0) {
          await saveFaces(job.eventSlug, job.photoId, faces);
        }
        await FolderSync.clearFaceJob({ photoId: job.photoId });
      } catch (err) {
        // Clear the job anyway: a file that can't be decoded (deleted since
        // upload, unsupported container) would otherwise be retried on every
        // single app launch forever.
        console.warn('[faceDetectionQueue] Native face job failed:', job.name, err);
        await FolderSync.clearFaceJob({ photoId: job.photoId }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[faceDetectionQueue] Failed to drain native face jobs:', err);
  }
}

/** Decodes a base64 payload without building an intermediate full-size string copy. */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

let started = false;

/** Starts watching the upload manager. Safe to call multiple times (no-op after the first). */
export function startFaceDetectionQueue(): void {
  if (started) return;
  started = true;

  if (Capacitor.isNativePlatform()) {
    // Through the same chain as upload-triggered detections: a resume can land
    // mid-upload, and two detections alive at once is the exact condition that
    // exhausts the renderer.
    enqueueDetection(drainNativeFaceJobs);
    // Also drain on resume — a background sync run may have uploaded photos
    // while the app was closed.
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) enqueueDetection(drainNativeFaceJobs);
    }).catch(() => { /* listener registration is best-effort */ });
  }

  uploadManager.subscribe((items) => {
    for (const item of items) {
      if (item.status !== 'completed') continue;
      if (processedIds.has(item.id)) continue;
      if (!isImage(item)) continue;
      // Don't mark as processed until the actual File is available — completion
      // notifications from backgroundSync/syncItemProgress can arrive BEFORE the
      // full queue item (with its File) has been backfilled from Dexie (see
      // uploadManager.syncItemProgress()'s doc comment); marking this id as
      // processed too early would permanently skip it once the file DOES arrive
      // in a follow-up notify().
      if (!item.file) continue;

      processedIds.add(item.id);

      // Queued, not awaited: uploads must never wait on face detection, but the
      // detections themselves run one at a time (see enqueueDetection).
      enqueueDetection(() => processItem(item));
    }

    // Keep processedIds bounded WITHOUT ever forgetting an id that's still present-and-completed
    // in the queue: uploadManager.notify() re-delivers the whole snapshot every time, so evicting
    // a still-live completed id (the old "drop the oldest half" logic did) meant the very next
    // notify() re-enqueued detection for it — re-decoding the image and re-POSTing saveFaces,
    // the exact wasteful reprocessing this set exists to prevent. An id that has DROPPED OUT of
    // the snapshot can never be re-delivered, so it's safe to forget; that alone keeps the set
    // naturally bounded by the live queue size. The cap is just a backstop (ids are cheap
    // strings; real memory pressure comes from concurrent detections, which enqueueDetection
    // already serializes).
    if (processedIds.size > MAX_TRACKED_IDS) {
      const currentIds = new Set(items.map((i) => i.id));
      for (const id of processedIds) {
        if (!currentIds.has(id)) processedIds.delete(id);
      }
    }
  });
}
