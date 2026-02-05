import { Hono } from 'hono';
import { ulid } from 'ulid';
import type { Env, CreateEventRequest, StartUploadRequest, CompleteUploadRequest } from '../types';
import { generateSalt, hashPassword, generateUniqueSlug } from '../utils';
import { generateThumbnails } from '../imageProcessing';

const app = new Hono<{ Bindings: Env }>();

/**
 * Admin authentication middleware
 */
app.use('/*', async (c, next) => {
  // Check for Cloudflare Access JWT (automatically added on free plan)
  const accessJwt = c.req.header('Cf-Access-Jwt-Assertion');
  
  // In development, check for optional shared secret
  if (c.env.ENVIRONMENT === 'development') {
    const adminSecret = c.req.header('X-Admin-Secret');
    if (c.env.ADMIN_SHARED_SECRET && adminSecret !== c.env.ADMIN_SHARED_SECRET) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  } else {
    // In production, check for Cloudflare Access JWT
    if (!accessJwt) {
      return c.json({ error: 'Unauthorized - Admin access required' }, 401);
    }
    // Note: For better security, you could verify the JWT signature here
    // using your Cloudflare Access team domain's public keys
  }
  
  await next();
});

/**
 * POST /events
 * Creates a new event
 */
app.post('/events', async (c) => {
  try {
    const body = await c.req.json<CreateEventRequest>();
    
    if (!body.name) {
      return c.json({ error: 'Name is required' }, 400);
    }
    
    // Generate slug
    const slug = body.slug || await generateUniqueSlug(c.env.DB, body.name);
    
    // Generate password hash if password provided
    let salt = null;
    let hash = null;
    if (body.password) {
      salt = generateSalt();
      hash = await hashPassword(body.password, salt);
    }
    
    // Insert event
    const result = await c.env.DB
      .prepare('INSERT INTO events (slug, name, password_salt, password_hash) VALUES (?, ?, ?, ?)')
      .bind(slug, body.name, salt, hash)
      .run();
    
    if (!result.success) {
      return c.json({ error: 'Failed to create event' }, 500);
    }
    
    // Get created event
    const event = await c.env.DB
      .prepare('SELECT id, slug, name, inferred_date, created_at FROM events WHERE slug = ?')
      .bind(slug)
      .first();
    
    return c.json({ event }, 201);
  } catch (error) {
    console.error('Error creating event:', error);
    return c.json({ error: 'Failed to create event' }, 500);
  }
});

/**
 * POST /events/:slug/uploads/start
 * Starts a multipart upload for a photo
 */
app.post('/events/:slug/uploads/start', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    const body = await c.req.json<StartUploadRequest>();
    
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
    
    // Create multipart upload in R2
    const key = `original/${slug}/${body.photoId}.jpg`;
    const multipartUpload = await c.env.PHOTOS_BUCKET.createMultipartUpload(key);
    
    // Store photo metadata in database
    const captureTime = body.captureTime || new Date().toISOString();
    await c.env.DB
      .prepare(`INSERT INTO photos (
        id, event_id, original_filename, capture_time, width, height,
        iso, aperture, shutter_speed, focal_length, camera_make, camera_model, lens_model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        body.photoId, event.id, body.filename, captureTime, 
        body.width || null, body.height || null,
        body.iso || null, body.aperture || null, body.shutterSpeed || null,
        body.focalLength || null, body.cameraMake || null, body.cameraModel || null,
        body.lensModel || null
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
 * Uploads a part directly to R2
 */
app.put('/events/:slug/uploads/:photoId/parts/:partNumber', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId');
  const partNumber = parseInt(c.req.param('partNumber'));
  
  try {
    const uploadId = c.req.header('X-Upload-Id');
    
    if (!uploadId) {
      return c.json({ error: 'X-Upload-Id header is required' }, 400);
    }
    
    if (isNaN(partNumber) || partNumber < 1) {
      return c.json({ error: 'Invalid part number' }, 400);
    }
    
    const key = `original/${slug}/${photoId}.jpg`;
    
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
 * Completes a multipart upload
 */
app.post('/events/:slug/uploads/:photoId/complete', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId');
  
  try {
    const body = await c.req.json<CompleteUploadRequest>();
    
    if (!body.uploadId || !body.parts || body.parts.length === 0) {
      return c.json({ error: 'uploadId and parts are required' }, 400);
    }
    
    const key = `original/${slug}/${photoId}.jpg`;
    
    // Complete the multipart upload
    const upload = c.env.PHOTOS_BUCKET.resumeMultipartUpload(key, body.uploadId);
    await upload.complete(body.parts);
    
    // Generate thumbnails asynchronously (don't wait for completion)
    c.executionCtx.waitUntil(generateThumbnails(c.env.PHOTOS_BUCKET, slug, photoId));
    
    return c.json({ success: true, message: 'Upload completed successfully' });
  } catch (error) {
    console.error('Error completing upload:', error);
    return c.json({ error: 'Failed to complete upload' }, 500);
  }
});

/**
 * POST /events/:slug/regenerate-thumbnails
 * Regenerates thumbnails for all photos in an event
 */
app.post('/events/:slug/regenerate-thumbnails', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    // Get all photos for this event
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    const photos = await c.env.DB
      .prepare('SELECT id FROM photos WHERE event_id = ?')
      .bind(event.id)
      .all<{ id: string }>();
    
    if (!photos.results || photos.results.length === 0) {
      return c.json({ message: 'No photos found for this event' }, 200);
    }
    
    // Generate thumbnails for each photo asynchronously
    for (const photo of photos.results) {
      c.executionCtx.waitUntil(generateThumbnails(c.env.PHOTOS_BUCKET, slug, photo.id));
    }
    
    return c.json({ 
      success: true, 
      message: `Regenerating thumbnails for ${photos.results.length} photos`,
      count: photos.results.length
    });
  } catch (error) {
    console.error('Error regenerating thumbnails:', error);
    return c.json({ error: 'Failed to regenerate thumbnails' }, 500);
  }
});

export default app;
