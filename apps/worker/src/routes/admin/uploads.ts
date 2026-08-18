import { Hono } from 'hono';
import type { Env, StartUploadRequest, CompleteUploadRequest, User } from '../../types';
import { requireUploadPermission, isAdmin } from '../../auth';
import { logCollaborationAction } from '../collaborators';
import { logActivity } from '../../activityLog';
import { checkFeature } from '../../features';
import { isVideoFileType, getStorageExtension } from '../../fileTypeUtils';
import { isValidFaceInput, EXPECTED_EMBEDDING_LENGTH } from '../../faceValidation';
import { MAX_SQL_IN_CHUNK, chunkArray } from '../../utils';

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Upper bound on hashes accepted per POST /check-hashes call. Keeps the
 *  request body and the number of chunked D1 statements bounded regardless of
 *  how large the client's backlog is — the Android sync engine pages through
 *  its pending files in batches of this size. */
const MAX_HASHES_PER_CHECK = 500;

/** SHA-256 hex, matching computeFileHash() in apps/web/src/imageUtils.ts and
 *  MediaProbe.sha256() in the Android sync engine. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * POST /events/:slug/uploads/check-hashes
 *
 * Given a batch of SHA-256 content hashes, reports which ones this event
 * already has a fully-uploaded, non-deleted photo for. Lets a client skip
 * re-uploading content the server already holds.
 *
 * This is what makes folder sync survive a reinstall, cleared app data, or a
 * second device: the Android engine's local ledger is the fast path, and this
 * endpoint is the authoritative fallback when that ledger doesn't know about a
 * file yet. Without it, re-adding a previously-synced folder re-uploads every
 * photo in it.
 *
 * Mounted on the uploads router so requireUploadPermission applies (admins and
 * collaborators with upload capability), and so the path — which contains
 * `/uploads/` — hits the admin-only-gate exemption in routes/admin.ts.
 */
app.post('/check-hashes', requireUploadPermission, async (c) => {
  const slug = c.req.param('slug')!;

  try {
    const body = await c.req.json<{ hashes?: unknown }>().catch(() => ({ hashes: undefined }));

    if (!Array.isArray(body.hashes)) {
      return c.json({ error: 'hashes must be an array' }, 400);
    }
    if (body.hashes.length > MAX_HASHES_PER_CHECK) {
      return c.json({ error: `At most ${MAX_HASHES_PER_CHECK} hashes may be checked per request` }, 400);
    }

    // Normalise and drop anything that isn't a plausible hash, so a malformed
    // client can never widen the IN (...) list with junk.
    const hashes = Array.from(
      new Set(
        body.hashes
          .filter((h): h is string => typeof h === 'string')
          .map((h) => h.trim().toLowerCase())
          .filter((h) => SHA256_HEX.test(h))
      )
    );

    if (hashes.length === 0) {
      return c.json({ existing: [] });
    }

    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();

    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }

    // Only count photos that actually finished uploading and aren't in the
    // trash — a half-uploaded or soft-deleted row must NOT suppress a
    // re-upload, or the photo would be permanently missing from the event.
    const statements = chunkArray(hashes, MAX_SQL_IN_CHUNK).map((chunk) =>
      c.env.DB
        .prepare(
          `SELECT DISTINCT file_hash FROM photos
           WHERE event_id = ?
             AND deleted_at IS NULL
             AND upload_complete = 1
             AND file_hash IN (${chunk.map(() => '?').join(',')})`
        )
        .bind(event.id, ...chunk)
    );

    const results = await c.env.DB.batch<{ file_hash: string }>(statements);
    const existing = results.flatMap((r) => (r.results || []).map((row) => row.file_hash));

    return c.json({ existing });
  } catch (error) {
    console.error('Error checking file hashes:', error);
    return c.json({ error: 'Failed to check file hashes' }, 500);
  }
});

/**
 * POST /start
 * Starts a multipart upload for a photo (original or preview)
 * Accessible by admins and event collaborators
 */
app.post('/start', requireUploadPermission, async (c) => {
  const slug = c.req.param('slug')!;
  
  try {
    const body = await c.req.json<StartUploadRequest & { isPreview?: boolean }>();
    
    if (!body.photoId || !body.filename) {
      return c.json({ error: 'photoId and filename are required' }, 400);
    }
    
    // Verify event exists
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Determine file extension based on fileType
    const fileType = body.fileType || 'image/jpeg';
    const isVideo = isVideoFileType(fileType);
    
    // Determine upload path based on isPreview flag
    const folder = body.isPreview ? 'preview' : 'original';
    const extension = getStorageExtension(fileType, folder);
    const key = `${folder}/${slug}/${body.photoId}.${extension}`;
    
    // Create multipart upload in R2
    const multipartUpload = await c.env.PHOTOS_BUCKET.createMultipartUpload(key);
    
    // Store photo metadata in database only if it's the original (not preview)
    if (!body.isPreview) {
      const captureTime = body.captureTime || new Date().toISOString();
      const user = c.get('user'); // Get authenticated user (admin or collaborator)

      // Videos never get a separate preview file uploaded (media.ts always
      // falls back to the original .mp4), so they're immediately treated as
      // preview-complete; only images start out pending a preview upload.
      const initialPreviewComplete = isVideo ? 1 : 0;
      
      // `uploaded_by` stores the uploader's EMAIL (not their display name) —
      // this is what public.ts's `LEFT JOIN users u ON p.uploaded_by = u.email`
      // and scheduled.ts's "exclude the uploader from their own new-photo
      // notification" logic both expect. requireUploadPermission guarantees
      // `user` (and therefore `user.email`) is always present here.
      // Previously this stored only the user's first name, which broke both
      // of those: the join could never match (so "Uploaded by" silently
      // disappeared whenever `user.name` was unset), and the notification
      // exclusion compared a first name against an email and never matched.
      const uploaderEmail = user?.email || null;
      
      // Upload retries (e.g. after a transient network/R2 failure) call /start
      // again with the *same* photoId, since a fresh multipart upload has to
      // be created either way. A plain INSERT would then hit the photos.id
      // PRIMARY KEY and throw, causing an immediate 500 on retry. Use an
      // upsert instead so re-starting an incomplete upload just refreshes its
      // metadata; if the row is already complete, the WHERE guard makes the
      // update a no-op so a finished photo is never touched.
      await c.env.DB
        .prepare(`INSERT INTO photos (
          id, event_id, original_filename, file_type, capture_time, uploaded_by, width, height,
          iso, aperture, shutter_speed, focal_length, camera_make, camera_model, lens_model,
          latitude, longitude, blur_placeholder, upload_complete, preview_complete, file_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          event_id = excluded.event_id,
          original_filename = excluded.original_filename,
          file_type = excluded.file_type,
          capture_time = excluded.capture_time,
          uploaded_by = excluded.uploaded_by,
          width = excluded.width,
          height = excluded.height,
          iso = excluded.iso,
          aperture = excluded.aperture,
          shutter_speed = excluded.shutter_speed,
          focal_length = excluded.focal_length,
          camera_make = excluded.camera_make,
          camera_model = excluded.camera_model,
          lens_model = excluded.lens_model,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          blur_placeholder = excluded.blur_placeholder,
          file_hash = excluded.file_hash
        WHERE photos.upload_complete = 0`)
        .bind(
          body.photoId, event.id, body.filename, fileType, captureTime, 
          uploaderEmail, // Store uploader's email (matches the join/notification logic)
          body.width || null, body.height || null,
          body.iso || null, body.aperture || null, body.shutterSpeed || null,
          body.focalLength || null, body.cameraMake || null, body.cameraModel || null,
          body.lensModel || null, body.latitude || null, body.longitude || null,
          body.blurPlaceholder || null, initialPreviewComplete, body.fileHash || null
        )
        .run();
      
      // Update event inferred date if this is the earliest photo
      await c.env.DB
        .prepare(`
          UPDATE events 
          SET inferred_date = (
            SELECT DATE(MIN(capture_time)) 
            FROM photos 
            WHERE event_id = ?
          )
          WHERE id = ?
        `)
        .bind(event.id, event.id)
        .run();
    }
    
    return c.json({
      uploadId: multipartUpload.uploadId,
      key: multipartUpload.key,
    });
  } catch (error) {
    console.error('Error starting upload:', error);
    return c.json({ error: 'Failed to start upload' }, 500);
  }
});

/**
 * PUT /events/:slug/uploads/:photoId/parts/:partNumber
 * Uploads a part directly to R2 (supports preview uploads via query param)
 */
app.put('/:photoId/parts/:partNumber', requireUploadPermission, async (c) => {
  const slug = c.req.param('slug')!;
  const photoId = c.req.param('photoId');
  const partNumber = parseInt(c.req.param('partNumber')!);
  const isPreview = c.req.query('preview') === 'true';
  
  try {
    const uploadId = c.req.header('X-Upload-Id');
    const fileType = c.req.header('X-File-Type') || 'image/jpeg';
    
    if (!uploadId) {
      return c.json({ error: 'X-Upload-Id header is required' }, 400);
    }
    
    if (isNaN(partNumber) || partNumber < 1) {
      return c.json({ error: 'Invalid part number' }, 400);
    }
    
    const folder = isPreview ? 'preview' : 'original';
    const extension = getStorageExtension(fileType, folder);
    const key = `${folder}/${slug}/${photoId}.${extension}`;
    
    // Get the body as ArrayBuffer
    const body = await c.req.arrayBuffer();
    
    // Resume multipart upload and upload this part
    const upload = c.env.PHOTOS_BUCKET.resumeMultipartUpload(key, uploadId);
    const uploadedPart = await upload.uploadPart(partNumber, body);
    
    return c.json({
      partNumber,
      etag: uploadedPart.etag,
    });
  } catch (error) {
    console.error('Error uploading part:', error);
    return c.json({ error: 'Failed to upload part' }, 500);
  }
});

type CancelUploadBody = { uploadId?: string; previewUploadId?: string; fileType?: string };

/**
 * POST /events/:slug/uploads/:photoId/cancel
 * Cancels an in-progress (or not-yet-started) upload: aborts the multipart
 * upload on R2 (best-effort, for both original and preview keys) and removes
 * the photo row that was created at /start — but ONLY if the photo never
 * finished uploading (upload_complete = 0), so a completed photo can never be
 * deleted through this endpoint.
 * Accessible by admins and event collaborators. Always available so users can
 * always clear a half-uploaded photo from the queue.
 */
app.post('/:photoId/cancel', requireUploadPermission, async (c) => {
  const slug = c.req.param('slug')!;
  const photoId = c.req.param('photoId');

  try {
    const body = await c.req.json<CancelUploadBody>().catch((err) => {
      // A missing/empty body is expected (e.g. cancelling an item that never
      // reached /start), so this is logged at debug level, not as an error.
      console.debug('Cancel upload: no/invalid JSON body, proceeding with defaults', err);
      return {} as CancelUploadBody;
    });

    // Only ever delete a photo row that hasn't completed uploading.
    const photo = await c.env.DB
      .prepare('SELECT file_type, upload_complete FROM photos WHERE id = ?')
      .bind(photoId)
      .first<{ file_type: string; upload_complete: number }>();

    if (photo && photo.upload_complete === 1) {
      return c.json({ error: 'Cannot cancel a completed upload' }, 400);
    }

    const fileType = body.fileType || photo?.file_type || 'image/jpeg';

    // Best-effort abort of any in-progress multipart uploads on R2. Aborting
    // an already-completed/nonexistent multipart upload throws — swallow
    // those errors so a stale/missing uploadId never blocks cleanup.
    const abortAttempts: Array<Promise<unknown>> = [];
    if (body.uploadId) {
      const originalKey = `original/${slug}/${photoId}.${getStorageExtension(fileType, 'original')}`;
      abortAttempts.push(
        c.env.PHOTOS_BUCKET.resumeMultipartUpload(originalKey, body.uploadId).abort()
      );
    }
    if (body.previewUploadId) {
      const previewKey = `preview/${slug}/${photoId}.${getStorageExtension(fileType, 'preview')}`;
      abortAttempts.push(
        c.env.PHOTOS_BUCKET.resumeMultipartUpload(previewKey, body.previewUploadId).abort()
      );
    }
    await Promise.allSettled(abortAttempts);

    // Remove the incomplete photo row (if any) so it doesn't linger forever.
    if (photo) {
      await c.env.DB.prepare('DELETE FROM photos WHERE id = ? AND upload_complete = 0').bind(photoId).run();
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error cancelling upload:', error);
    return c.json({ error: 'Failed to cancel upload' }, 500);
  }
});

/**
 * POST /events/:slug/uploads/:photoId/complete
 * Completes a multipart upload (supports preview uploads via query param)
 * Accessible by admins and event collaborators
 */
app.post('/:photoId/complete', requireUploadPermission, async (c) => {
  const slug = c.req.param('slug')!;
  const photoId = c.req.param('photoId');
  const isPreview = c.req.query('preview') === 'true';
  
  try {
    const body = await c.req.json<CompleteUploadRequest>();
    
    if (!body.uploadId || !body.parts || body.parts.length === 0) {
      return c.json({ error: 'uploadId and parts are required' }, 400);
    }
    
    // Get file type from database to determine extension
    const photo = await c.env.DB
      .prepare('SELECT file_type FROM photos WHERE id = ?')
      .bind(photoId)
      .first<{ file_type: string }>();
    
    const fileType = photo?.file_type || 'image/jpeg';
    
    const folder = isPreview ? 'preview' : 'original';
    const extension = getStorageExtension(fileType, folder);
    const key = `${folder}/${slug}/${photoId}.${extension}`;
    
    // Complete the multipart upload. R2 enforces the S3 multipart rule that
    // every part except the last must be >= 5MB — surface that (and other
    // known R2 completion errors) as a specific, actionable 400 instead of a
    // generic "Failed to complete upload" 500, so a buggy/misbehaving client
    // gets a message it can actually act on.
    const upload = c.env.PHOTOS_BUCKET.resumeMultipartUpload(key, body.uploadId);
    try {
      await upload.complete(body.parts);
    } catch (completeError) {
      console.error('[UPLOAD] R2 multipart complete failed:', completeError);
      const message = completeError instanceof Error ? completeError.message : String(completeError);
      if (/EntityTooSmall/i.test(message)) {
        return c.json({ error: 'Upload failed: one or more parts is smaller than the 5MB minimum required for all parts except the last.' }, 400);
      }
      if (/InvalidPart/i.test(message)) {
        return c.json({ error: 'Upload failed: one or more parts is missing, out of order, or has a mismatched ETag.' }, 400);
      }
      if (/NoSuchUpload/i.test(message)) {
        return c.json({ error: 'Upload failed: the upload session has expired or was already completed/aborted.' }, 400);
      }
      return c.json({ error: 'Failed to complete upload' }, 500);
    }

    // Mark the photo as fully uploaded once the ORIGINAL media lands in R2, so
    // it becomes visible in galleries/detail. Preview uploads (isPreview) are a
    // progressive enhancement that happens afterwards; the media endpoint falls
    // back to the original if the preview isn't ready yet. However, the photo
    // still stays hidden from galleries/timeline until preview_complete flips
    // to 1 below, so listings never show only-original photos that would
    // otherwise load the full-size image where a lightweight preview belongs.
    //
    // Guard with "AND upload_complete = 0" and only proceed with the history
    // log below when this call was the one that actually flipped the flag.
    // Without this, a retried /complete (e.g. the first call succeeded
    // server-side but its response was lost, so the client retries the whole
    // upload) would re-run this handler for an already-completed photo and
    // insert a second "upload" row into collaboration_history, showing up as
    // a duplicate entry in the activity log.
    let firstCompletion = false;
    if (!isPreview) {
      const result = await c.env.DB
        .prepare('UPDATE photos SET upload_complete = 1 WHERE id = ? AND upload_complete = 0')
        .bind(photoId)
        .run();
      firstCompletion = result.meta.changes > 0;
    } else {
      // Same idempotent guard as above, applied to the preview flag: a
      // retried preview /complete call must not error or double-count.
      await c.env.DB
        .prepare('UPDATE photos SET preview_complete = 1 WHERE id = ? AND preview_complete = 0')
        .bind(photoId)
        .run();
    }
    
    // Log collaborator uploads to history (not admins, originals only).
    // Only on the first completion, so retries never create duplicate
    // history entries for the same photo.
    // Email notifications are sent by the hourly scheduled job (see
    // apps/worker/src/scheduled.ts), which batches new photos per event and
    // notifies collaborators + admins, avoiding a spammy email per photo.
    if (!isPreview && firstCompletion && !isAdmin(c) && checkFeature(c.env, 'enableCollaborators')) {
      const user = c.get('user');
      if (user) {
        // Get event info
        const eventInfo = await c.env.DB.prepare(`
          SELECT 
            e.id, 
            e.name
          FROM events e
          WHERE e.slug = ?
        `).bind(slug).first<{
          id: number;
          name: string;
        }>();
        
        if (eventInfo) {
          // Log upload action to history
          await logCollaborationAction(c.env.DB, {
            eventId: eventInfo.id,
            userEmail: user.email,
            actionType: 'upload',
            metadata: { photoId }
          });
        }
      }
    }

    // Admin uploads go to activity_log instead. The two are mutually exclusive
    // on purpose: the admin activity feed unions activity_log with
    // collaboration_history, so logging an upload to both would show it twice.
    // Same firstCompletion/!isPreview guard as above, for the same reason —
    // a retried /complete must not produce a second entry.
    if (!isPreview && firstCompletion && isAdmin(c)) {
      const user = c.get('user');
      const eventRow = await c.env.DB
        .prepare('SELECT id FROM events WHERE slug = ?')
        .bind(slug)
        .first<{ id: number }>();

      if (user && eventRow) {
        await logActivity(c.env, {
          eventId: eventRow.id,
          actorEmail: user.email,
          action: 'photo_upload',
          targetType: 'photo',
          targetId: photoId,
        });
      }
    }

    return c.json({ success: true, message: 'Upload completed successfully' });
  } catch (error) {
    console.error('[UPLOAD] Error completing upload:', error);
    return c.json({ error: 'Failed to complete upload' }, 500);
  }
});

/**
 * POST /:photoId/faces
 * Stores client-detected faces (bounding box + 1024-dim @vladmandic/human
 * descriptor) for a photo, computed entirely in the browser at upload time
 * (see apps/web/src/faceDetection.ts + faceDetectionQueue.ts — Workers AI
 * has no face-embedding model, so this runs client-side, same pattern as
 * the existing client-side EXIF/blur-placeholder/RAW-decode processing).
 * Mounted under the uploads router (exempted from the admin-only gate in
 * routes/admin.ts) so any collaborator with upload permission for this
 * event — not just admins — can report faces for photos they uploaded.
 * Clustering into named people happens separately (see scheduled.ts
 * runFaceClustering), this endpoint only stores raw detections.
 */
app.post('/:photoId/faces', requireUploadPermission, async (c) => {
  const slug = c.req.param('slug')!;
  const photoId = c.req.param('photoId');

  try {
    const photo = await c.env.DB
      .prepare('SELECT p.id FROM photos p JOIN events e ON p.event_id = e.id WHERE p.id = ? AND e.slug = ?')
      .bind(photoId, slug)
      .first<{ id: string }>();

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const { faces } = await c.req.json<{
      faces: Array<{ embedding: number[]; bbox: { x: number; y: number; width: number; height: number } }>;
    }>();

    if (!Array.isArray(faces)) {
      return c.json({ error: 'faces array is required' }, 400);
    }
    if (faces.length > 50) {
      return c.json({ error: 'Cannot report more than 50 faces per photo' }, 400);
    }
    // Face embeddings are computed client-side by a purpose-built ArcFace ONNX model that always
    // produces exactly EXPECTED_EMBEDDING_LENGTH (512) numbers — see faceValidation.ts. Validate
    // shape/bounds before trusting client-supplied data — this is a defense-in-depth check (the
    // caller already has upload permission for this event) against a buggy client sending
    // malformed/oversized payloads that would otherwise bloat the DB or corrupt clustering.
    if (!faces.every(isValidFaceInput)) {
      return c.json({ error: `Each face requires a ${EXPECTED_EMBEDDING_LENGTH}-number embedding and a numeric bbox` }, 400);
    }

    // Replace any previous detections for this photo (e.g. a re-run after an edit).
    await c.env.DB.prepare('DELETE FROM photo_faces WHERE photo_id = ?').bind(photoId).run();

    if (faces.length > 0) {
      const statements = faces.map((face) => {
        const embeddingBlob = new Float32Array(face.embedding).buffer;
        return c.env.DB
          .prepare(`
            INSERT INTO photo_faces (photo_id, embedding, bbox_x, bbox_y, bbox_width, bbox_height)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .bind(photoId, embeddingBlob, face.bbox.x, face.bbox.y, face.bbox.width, face.bbox.height);
      });
      await c.env.DB.batch(statements);
    }

    // Mark as checked regardless of whether any faces were found — a photo
    // with zero faces (no people in the shot) is still "processed", and
    // without this the backfill scan (which enumerates faces_processed_at
    // IS NULL) would rescan it forever.
    await c.env.DB.prepare("UPDATE photos SET faces_processed_at = datetime('now') WHERE id = ?").bind(photoId).run();

    return c.json({ success: true, count: faces.length });
  } catch (error) {
    console.error('Error saving photo faces:', error);
    return c.json({ error: 'Failed to save photo faces' }, 500);
  }
});

export default app;
