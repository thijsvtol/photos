import { Hono } from 'hono';
import type { Env, StartUploadRequest, CompleteUploadRequest, User } from '../../types';
import { requireUploadPermission, isAdmin } from '../../auth';
import { sendUploadNotification, logCollaborationAction } from '../collaborators';
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
      
      await c.env.DB
        .prepare(`INSERT INTO photos (
          id, event_id, original_filename, file_type, capture_time, uploaded_by, width, height,
          iso, aperture, shutter_speed, focal_length, camera_make, camera_model, lens_model,
          latitude, longitude, blur_placeholder
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
app.put('/:photoId/parts/:partNumber', async (c) => {
  const slug = c.req.param('slug')!;
  const photoId = c.req.param('photoId');
  const partNumber = parseInt(c.req.param('partNumber'));
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
    
    // Send notification if uploader is a collaborator (not admin)
    // Only send for original uploads, not previews, and only if feature is enabled
    if (!isPreview && !isAdmin(c) && checkFeature(c.env, 'enableCollaborators')) {
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
          // Get admin emails from environment
          const adminEmails = c.env.ADMIN_EMAILS || '';
          const adminList = adminEmails.split(',').map(email => email.trim()).filter(Boolean);
          
          // Send notification to all admins (only if Mailgun is configured)
          if (checkFeature(c.env, 'canSendEmails')) {
            for (const adminEmail of adminList) {
              console.log('[Upload Notification] Sending to admin:', adminEmail);
              await sendUploadNotification(c.env, {
                adminEmail: adminEmail,
                adminName: null,
                uploaderName: user.name || null,
                uploaderEmail: user.email,
                eventName: eventInfo.name,
                eventSlug: slug,
                photoCount: 1 // Single photo per completion
              });
            }
          } else {
            console.log('[Upload Notification] Skipped - email feature not enabled');
          }
          
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
