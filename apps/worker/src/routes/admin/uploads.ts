import { Hono } from 'hono';
import type { Env, StartUploadRequest, CompleteUploadRequest, User } from '../../types';
import { requireUploadPermission, isAdmin } from '../../auth';
import { logCollaborationAction } from '../collaborators';
import { checkFeature } from '../../features';

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

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
    const isVideo = fileType === 'video/mp4';
    const extension = isVideo ? 'mp4' : 'jpg';
    
    // Determine upload path based on isPreview flag
    const folder = body.isPreview ? 'preview' : 'original';
    const key = `${folder}/${slug}/${body.photoId}.${extension}`;
    
    // Create multipart upload in R2
    const multipartUpload = await c.env.PHOTOS_BUCKET.createMultipartUpload(key);
    
    // Store photo metadata in database only if it's the original (not preview)
    if (!body.isPreview) {
      const captureTime = body.captureTime || new Date().toISOString();
      const user = c.get('user'); // Get authenticated user (admin or collaborator)
      
      // Get first name from full name, or use full name if no space
      let uploaderName = null;
      if (user?.name) {
        uploaderName = user.name.split(' ')[0]; // Get first name
      }
      
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
          latitude, longitude, blur_placeholder, upload_complete
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
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
          blur_placeholder = excluded.blur_placeholder
        WHERE photos.upload_complete = 0`)
        .bind(
          body.photoId, event.id, body.filename, fileType, captureTime, 
          uploaderName, // Store uploader's first name
          body.width || null, body.height || null,
          body.iso || null, body.aperture || null, body.shutterSpeed || null,
          body.focalLength || null, body.cameraMake || null, body.cameraModel || null,
          body.lensModel || null, body.latitude || null, body.longitude || null,
          body.blurPlaceholder || null
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
    
    const isVideo = fileType === 'video/mp4';
    const extension = isVideo ? 'mp4' : 'jpg';
    const folder = isPreview ? 'preview' : 'original';
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
    const isVideo = fileType === 'video/mp4';
    const extension = isVideo ? 'mp4' : 'jpg';

    // Best-effort abort of any in-progress multipart uploads on R2. Aborting
    // an already-completed/nonexistent multipart upload throws — swallow
    // those errors so a stale/missing uploadId never blocks cleanup.
    const abortAttempts: Array<Promise<unknown>> = [];
    if (body.uploadId) {
      const originalKey = `original/${slug}/${photoId}.${extension}`;
      abortAttempts.push(
        c.env.PHOTOS_BUCKET.resumeMultipartUpload(originalKey, body.uploadId).abort()
      );
    }
    if (body.previewUploadId) {
      const previewKey = `preview/${slug}/${photoId}.${extension}`;
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
    const isVideo = fileType === 'video/mp4';
    const extension = isVideo ? 'mp4' : 'jpg';
    
    const folder = isPreview ? 'preview' : 'original';
    const key = `${folder}/${slug}/${photoId}.${extension}`;
    
    // Complete the multipart upload
    const upload = c.env.PHOTOS_BUCKET.resumeMultipartUpload(key, body.uploadId);
    await upload.complete(body.parts);

    // Mark the photo as fully uploaded once the ORIGINAL media lands in R2, so
    // it becomes visible in galleries/detail. Preview uploads (isPreview) are a
    // progressive enhancement that happens afterwards; the media endpoint falls
    // back to the original if the preview isn't ready yet.
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
    
    return c.json({ success: true, message: 'Upload completed successfully' });
  } catch (error) {
    console.error('[UPLOAD] Error completing upload:', error);
    return c.json({ error: 'Failed to complete upload' }, 500);
  }
});

export default app;
