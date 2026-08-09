/**
 * Backfills face detection onto photos that were uploaded before the People
 * feature existed (or whose upload-time detection was skipped/failed).
 *
 * Detection itself must run client-side (Workers AI has no face-embedding
 * model — see faceDetection.ts), so unlike the other batch jobs in this app
 * (AI captions/embeddings, trash purge, face clustering — all pure server
 * crons), this cannot run purely on a schedule inside the Worker. Instead:
 *   - GET /admin/photos/faces-pending enumerates unprocessed photos
 *   - this module fetches each photo's 1920px PREVIEW image as a same-origin
 *     blob, runs detectFaces() on it in the browser, and posts results to
 *     POST /admin/photos/:photoId/faces
 *
 * HISTORY — this flipped twice; read before flipping it a third time:
 *
 * It originally used the preview, was switched to the ORIGINAL on 2026-08-06 after admins
 * found photos "scanned" (faces_processed_at set) yet with zero faces despite clearly
 * containing visible people, and was switched BACK to the preview on 2026-08-08.
 *
 * The 2026-08-06 reasoning still holds on its own terms: the preview's downscale genuinely
 * does blur away small/distant faces in group and action-sports shots, which is precisely
 * what this app's content skews toward, so this scan does find fewer faces than it would on
 * originals. What that change missed was the cost. Decoding full-resolution originals is what
 * made the Android WebView's renderer process run out of memory and take the entire app
 * process down with it ("Render process kill (OOM) wasn't handed by all associated webviews,
 * killing application"). A 12MP photo is ~48MB decoded and this app ingests up to 108MP
 * originals. Recall on distant faces is worth less than the app not crashing.
 *
 * The cap now lives in ONE place — DETECTION_MAX_DIMENSION in faceDetection.ts, which every
 * detection path inherits — so fetching the preview here is really just avoiding the pointless
 * download of an original that detectFaces() would immediately downscale anyway.
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

  try {
    // Fetch as a blob first (same pattern used by ImageEditorModal/auto-enhance) so
    // @vladmandic/human always operates on same-origin pixels, avoiding any cross-origin
    // canvas-tainting issues on native. The blob goes straight to detectFaces(), which does
    // its own bounded decode — no object URL needed.
    const res = await fetch(previewUrl);
    if (!res.ok) throw new Error(`Failed to fetch preview (${res.status})`);
    const blob = await res.blob();
    const faces = await detectFaces(blob);
    await saveBackfilledFaces(photo.id, faces);
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
