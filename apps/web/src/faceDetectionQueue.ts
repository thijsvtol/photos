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

function isImage(item: UploadQueueItem): boolean {
  const fileType = item.fileType || item.file?.type || '';
  return fileType.startsWith('image/') && fileType !== 'image/gif';
}

async function processItem(item: UploadQueueItem): Promise<void> {
  if (!item.photoId || !item.file) return;

  const objectUrl = URL.createObjectURL(item.file);
  try {
    const faces = await detectFaces(objectUrl);
    if (faces.length > 0) {
      await saveFaces(item.eventSlug, item.photoId, faces);
    }
  } catch (err) {
    // Best-effort only — never let a face-detection failure surface anywhere.
    console.warn('[faceDetectionQueue] Failed to process item:', err);
  } finally {
    URL.revokeObjectURL(objectUrl);
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
        const objectUrl = URL.createObjectURL(blob);
        try {
          const faces = await detectFaces(objectUrl);
          if (faces.length > 0) {
            await saveFaces(job.eventSlug, job.photoId, faces);
          }
        } finally {
          URL.revokeObjectURL(objectUrl);
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
    void drainNativeFaceJobs();
    // Also drain on resume — a background sync run may have uploaded photos
    // while the app was closed.
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void drainNativeFaceJobs();
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
      if (processedIds.size > MAX_TRACKED_IDS) {
        // Drop the oldest half to keep this bounded across a long session.
        const toDrop = Array.from(processedIds).slice(0, MAX_TRACKED_IDS / 2);
        toDrop.forEach((id) => processedIds.delete(id));
      }

      // Fire-and-forget: uploads must never wait on face detection.
      void processItem(item);
    }
  });
}
