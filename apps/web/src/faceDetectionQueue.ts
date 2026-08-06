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
import { uploadManager } from './services/uploadManager';
import { detectFaces } from './faceDetection';
import { saveFaces } from './api';
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

let started = false;

/** Starts watching the upload manager. Safe to call multiple times (no-op after the first). */
export function startFaceDetectionQueue(): void {
  if (started) return;
  started = true;

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
