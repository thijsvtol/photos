import { Hono } from 'hono';
import type { Env } from '../types';
import { getEventSession } from '../cookies';

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /media/:slug/preview/:photoId.jpg
 * Serves watermarked preview image (requires authentication)
 */
app.get('/media/:slug/preview/:photoId', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId').replace(/\.jpg$/, '');
  
  console.log(`[MEDIA] Request for preview: ${slug}/${photoId}`);
  
  try {
    // Check if event is password protected
    const event = await c.env.DB
      .prepare('SELECT password_hash FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ password_hash: string | null }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Check authentication only if password protected
    if (event.password_hash) {
      const isAuthenticated = await getEventSession(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
      console.log(`[MEDIA] Authentication status: ${isAuthenticated}`);
      
      if (!isAuthenticated) {
        return c.json({ error: 'Authentication required' }, 401);
      }
    } else {
      console.log(`[MEDIA] Event is not password protected, allowing access`);
    }
    // Try to get the preview version
    let key = `preview/${slug}/${photoId}.jpg`;
    console.log(`[MEDIA] Trying to get: ${key}`);
    let object = await c.env.PHOTOS_BUCKET.get(key);
    
    // If preview doesn't exist, fall back to original
    if (!object) {
      console.log(`[MEDIA] Preview not found, trying original`);
      key = `original/${slug}/${photoId}.jpg`;
      object = await c.env.PHOTOS_BUCKET.get(key);
    }
    
    if (!object) {
      console.log(`[MEDIA] Neither preview nor original found for ${photoId}`);
      return c.json({ error: 'Photo not found' }, 404);
    }
    
    console.log(`[MEDIA] Found image at ${key}, size: ${object.size} bytes`);
    
    return new Response(object.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('[MEDIA] Error serving preview:', error);
    return c.json({ error: 'Failed to serve photo' }, 500);
  }
});

/**
 * GET /media/:slug/ig/:photoId.jpg
 * Serves Instagram-ready watermarked image (requires authentication)
 */
app.get('/media/:slug/ig/:photoId', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId').replace(/\.jpg$/, '');
  
  try {
    // Check if event is password protected
    const event = await c.env.DB
      .prepare('SELECT password_hash FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ password_hash: string | null }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Check authentication only if password protected
    if (event.password_hash) {
      const isAuthenticated = await getEventSession(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
      if (!isAuthenticated) {
        return c.json({ error: 'Authentication required' }, 401);
      }
    }
    // Try to get the Instagram version
    let key = `ig/${slug}/${photoId}.jpg`;
    let object = await c.env.PHOTOS_BUCKET.get(key);
    
    // If IG version doesn't exist, fall back to original
    if (!object) {
      key = `original/${slug}/${photoId}.jpg`;
      object = await c.env.PHOTOS_BUCKET.get(key);
    }
    
    if (!object) {
      return c.json({ error: 'Photo not found' }, 404);
    }
    
    return new Response(object.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('Error serving IG photo:', error);
    return c.json({ error: 'Failed to serve photo' }, 500);
  }
});

/**
 * GET /media/:slug/original/:photoId.jpg
 * Serves original full-resolution image (requires authentication)
 * Sets Content-Disposition with renamed filename
 */
app.get('/media/:slug/original/:photoId', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId').replace(/\.jpg$/, '');
  
  try {
    // Get event to check if password protected
    const event = await c.env.DB
      .prepare('SELECT id, password_hash FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number; password_hash: string | null }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Check authentication only if password protected
    if (event.password_hash) {
      const isAuthenticated = await getEventSession(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
      if (!isAuthenticated) {
        return c.json({ error: 'Authentication required' }, 401);
      }
    }
    
    const photo = await c.env.DB
      .prepare('SELECT capture_time FROM photos WHERE id = ? AND event_id = ?')
      .bind(photoId, event.id)
      .first<{ capture_time: string }>();
    
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }
    
    // Get from R2
    const key = `original/${slug}/${photoId}.jpg`;
    const object = await c.env.PHOTOS_BUCKET.get(key);
    
    if (!object) {
      return c.json({ error: 'Photo not found in storage' }, 404);
    }
    
    // Generate filename: eventSlug_captureTime_photoId.jpg
    const captureTime = photo.capture_time.replace(/[:.]/g, '-');
    const filename = `${slug}_${captureTime}_${photoId}.jpg`;
    
    return new Response(object.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('Error serving original:', error);
    return c.json({ error: 'Failed to serve photo' }, 500);
  }
});

export default app;
