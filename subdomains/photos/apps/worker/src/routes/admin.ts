import { Hono } from 'hono';
import { ulid } from 'ulid';
import type { Env, CreateEventRequest, StartUploadRequest, CompleteUploadRequest } from '../types';
import { generateSalt, hashPassword, generateUniqueSlug } from '../utils';

const app = new Hono<{ Bindings: Env }>();

/**
 * Admin authentication middleware
 */
app.use('/*', async (c, next) => {
  // Check for admin access header (used in development or with Cloudflare Access)
  const adminHeader = c.req.header('X-Admin-Access');
  
  // In development, check for optional shared secret
  if (c.env.ENVIRONMENT === 'development' && c.env.ADMIN_SHARED_SECRET) {
    const authHeader = c.req.header('Authorization');
    if (authHeader !== `Bearer ${c.env.ADMIN_SHARED_SECRET}`) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  } else if (!adminHeader || adminHeader !== '1') {
    // In production, rely on Cloudflare Access + header check
    return c.json({ error: 'Unauthorized - Admin access required' }, 401);
  }
  
  await next();
});

/**
 * POST /api/admin/events
 * Creates a new event
 */
app.post('/api/admin/events', async (c) => {
  try {
    const body = await c.req.json<CreateEventRequest>();
    
    if (!body.name || !body.password) {
      return c.json({ error: 'Name and password are required' }, 400);
    }
    
    // Generate slug
    const slug = body.slug || await generateUniqueSlug(c.env.DB, body.name);
    
    // Generate password hash
    const salt = generateSalt();
    const hash = await hashPassword(body.password, salt);
    
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
 * POST /api/admin/events/:slug/uploads/start
 * Starts a multipart upload for a photo
 */
app.post('/api/admin/events/:slug/uploads/start', async (c) => {
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
      .prepare('INSERT INTO photos (id, event_id, original_filename, capture_time, width, height) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(body.photoId, event.id, body.filename, captureTime, body.width || null, body.height || null)
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
 * POST /api/admin/events/:slug/uploads/:photoId/parts
 * Gets a presigned URL for uploading a part
 */
app.post('/api/admin/events/:slug/uploads/:photoId/parts', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId');
  
  try {
    const body = await c.req.json<{ uploadId: string; partNumber: number }>();
    
    if (!body.uploadId || !body.partNumber) {
      return c.json({ error: 'uploadId and partNumber are required' }, 400);
    }
    
    const key = `original/${slug}/${photoId}.jpg`;
    
    // Get multipart upload
    const upload = c.env.PHOTOS_BUCKET.resumeMultipartUpload(key, body.uploadId);
    
    // Generate presigned URL for this part
    const uploadedPart = await upload.uploadPart(body.partNumber);
    
    return c.json({
      uploadUrl: uploadedPart.uploadUrl,
      partNumber: body.partNumber,
    });
  } catch (error) {
    console.error('Error getting part URL:', error);
    return c.json({ error: 'Failed to get upload URL' }, 500);
  }
});

/**
 * POST /api/admin/events/:slug/uploads/:photoId/complete
 * Completes a multipart upload
 */
app.post('/api/admin/events/:slug/uploads/:photoId/complete', async (c) => {
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
    
    return c.json({ success: true, message: 'Upload completed successfully' });
  } catch (error) {
    console.error('Error completing upload:', error);
    return c.json({ error: 'Failed to complete upload' }, 500);
  }
});

export default app;
