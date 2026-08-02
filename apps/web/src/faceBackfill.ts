/**
 * Backfills face detection onto photos that were uploaded before the People
 * feature existed (or whose upload-time detection was skipped/failed).
 *
 * Detection itself must run client-side (Workers AI has no face-embedding
 * model — see faceDetection.ts), so unlike the other batch jobs in this app
 * (AI captions/embeddings, trash purge, face clustering — all pure server
 * crons), this cannot run purely on a schedule inside the Worker. Instead:
 *   - GET /admin/photos/faces-pending enumerates unprocessed photos
 *   - this module fetches each photo's PREVIEW image (small, fast) as a
 *     same-origin blob, runs detectFaces() on it in the browser, and posts
 *     results to POST /admin/photos/:photoId/faces
 *
 * Exposed as an explicit "Scan Library" action on the People admin page
 * (immediate, user-controlled, with progress) — see AdminPeople.tsx.
 */
import { getFacesPendingPhotos, saveBackfilledFaces, getPreviewUrl } from './api';
import { detectFaces } from './faceDetection';

const BATCH_SIZE = 8;

export interface BackfillProgress {
  processed: number;
  remaining: number;
  done: boolean;
}

async function processPhoto(photo: { id: string; file_type: string; cache_version: number; event_slug: string }): Promise<void> {
  const previewUrl = getPreviewUrl(photo.event_slug, photo.id, photo.file_type, photo.cache_version);

  // Fetch as a blob first (same pattern used by ImageEditorModal/auto-enhance)
  // so @vladmandic/human always operates on a same-origin blob URL, avoiding any
  // cross-origin canvas-tainting issues on native.
  const res = await fetch(previewUrl);
  if (!res.ok) throw new Error(`Failed to fetch preview (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const faces = await detectFaces(objectUrl);
    await saveBackfilledFaces(photo.id, faces);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Processes photos in small batches until none remain (or `onProgress`
 * returns false, signalling the caller wants to stop). Never throws — a
 * single photo failing to process is logged and skipped so one bad photo
 * doesn't halt the whole scan (it's simply left for a future run to retry,
 * since faces_processed_at is only set on success).
 */
export async function runBackfillScan(
  onProgress: (progress: BackfillProgress) => boolean | void
): Promise<void> {
  let processed = 0;

  for (;;) {
    const { photos, remaining } = await getFacesPendingPhotos(BATCH_SIZE);
    if (photos.length === 0) {
      onProgress({ processed, remaining: 0, done: true });
      return;
    }

    for (const photo of photos) {
      try {
        await processPhoto(photo);
      } catch (err) {
        console.warn('[faceBackfill] Failed to process photo', photo.id, err);
      }
      processed++;
    }

    const shouldContinue = onProgress({ processed, remaining: Math.max(0, remaining - photos.length), done: false });
    if (shouldContinue === false) {
      return;
    }
  }
}
