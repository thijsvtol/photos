/**
 * Backfills face detection onto photos that were uploaded before the People
 * feature existed (or whose upload-time detection was skipped/failed).
 *
 * Detection itself must run client-side (Workers AI has no face-embedding
 * model — see faceDetection.ts), so unlike the other batch jobs in this app
 * (AI captions/embeddings, trash purge, face clustering — all pure server
 * crons), this cannot run purely on a schedule inside the Worker. Instead:
 *   - GET /admin/photos/faces-pending enumerates unprocessed photos
 *   - this module fetches each photo's ORIGINAL image (same full-resolution
 *     file that upload-time detection — faceDetectionQueue.ts — already
 *     uses) as a same-origin blob, runs detectFaces() on it in the browser,
 *     and posts results to POST /admin/photos/:photoId/faces
 *
 * IMPORTANT: this used to fetch the 1920px-capped PREVIEW image instead of the original —
 * fixed 2026-08-06 after admins found that a large fraction of manually-tagged photos had
 * been "scanned" (faces_processed_at set) yet detected zero faces despite clearly containing
 * visible people. Upload-time detection (faceDetectionQueue.ts) has always run against the
 * full original file; this backfill scan alone was silently working with strictly less pixel
 * data, which cost real recall specifically for small/distant faces in group or action-sports
 * shots — precisely the kind of face this app's content skews toward (see faceDetection.ts's
 * top-of-file doc comment) and precisely the case the preview's downscale would blur away
 * before the detector ever saw it. Slower per-photo (bigger download) but strictly more
 * accurate, matching upload-time detection's quality.
 *
 * Exposed as an explicit "Scan Library" action on the People admin page
 * (immediate, user-controlled, with progress) — see AdminPeople.tsx.
 */
import { getFacesPendingPhotos, saveBackfilledFaces, getOriginalUrl } from './api';
import { detectFaces } from './faceDetection';

const BATCH_SIZE = 8;

export interface BackfillProgress {
  processed: number;
  remaining: number;
  done: boolean;
}

async function processPhoto(photo: { id: string; file_type: string; cache_version: number; event_slug: string }): Promise<void> {
  const originalUrl = getOriginalUrl(photo.event_slug, photo.id, photo.file_type, photo.cache_version);

  try {
    // Fetch as a blob first (same pattern used by ImageEditorModal/auto-enhance)
    // so @vladmandic/human always operates on a same-origin blob URL, avoiding any
    // cross-origin canvas-tainting issues on native.
    const res = await fetch(originalUrl);
    if (!res.ok) throw new Error(`Failed to fetch original (${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const faces = await detectFaces(objectUrl);
      await saveBackfilledFaces(photo.id, faces);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (err) {
    // A photo whose preview/original image can no longer be fetched or decoded (e.g. an
    // orphaned row whose R2 object was removed, or a corrupt file) will NEVER succeed on
    // retry — but faces_processed_at is only ever set on the SUCCESS path above, so before
    // this fix such a photo was refetched by every future "Scan Library for Faces" run forever
    // (GET /admin/photos/faces-pending always returns the SAME oldest still-unprocessed photos
    // first), making the scan loop endlessly (processed count climbing while remaining stayed
    // stuck near 0, since the exact same small stuck batch kept getting reselected). Mark it
    // processed with 0 faces instead so it's never retried again — we genuinely cannot detect
    // faces on an image that can't be fetched/decoded, so "checked, found none" is accurate.
    console.warn('[faceBackfill] Failed to detect faces for photo — marking as processed with 0 faces to avoid retrying forever', photo.id, err);
    try {
      await saveBackfilledFaces(photo.id, []);
    } catch (markErr) {
      console.error('[faceBackfill] Also failed to mark photo as processed after a detection failure — it will be retried', photo.id, markErr);
    }
  }
}

/**
 * Processes photos in small batches until none remain (or `onProgress`
 * returns false, signalling the caller wants to stop). Never throws for a
 * single bad photo — processPhoto() itself marks a permanently-broken photo
 * (missing/corrupt image) as processed with 0 faces rather than leaving it
 * pending forever (see its own doc comment for why that used to cause an
 * infinite scan loop). The try/catch below is just defense-in-depth against
 * an unexpected error escaping processPhoto entirely.
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
