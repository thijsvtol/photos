import { Hono } from 'hono';
import type { Env } from '../types';
import { getEventSession } from '../cookies';

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /media/:slug/preview/:photoId.(jpg|mp4)
 * Serves watermarked preview image or video (requires authentication)
 */
app.get('/media/:slug/preview/:photoId', async (c) => {
  const slug = c.req.param('slug');
  const photoIdWithExt = c.req.param('photoId');
  const photoId = photoIdWithExt.replace(/\.(jpg|mp4)$/, '');
  
  try {
    // Check if event is password protected
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
    
    // Get file type from database
    const photo = await c.env.DB
      .prepare('SELECT file_type FROM photos WHERE id = ? AND event_id = ?')
      .bind(photoId, event.id)
      .first<{ file_type: string }>();
    
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }
    
    const fileType = photo.file_type || 'image/jpeg';
    const isVideo = fileType === 'video/mp4';
    const extension = isVideo ? 'mp4' : 'jpg';
    const contentType = isVideo ? 'video/mp4' : 'image/jpeg';
    
    // Try to get the preview version first, fall back to original
    let key = `preview/${slug}/${photoId}.${extension}`;
    let object = await c.env.PHOTOS_BUCKET.get(key);
    
    // Fallback to original if preview doesn't exist
    if (!object) {
      key = `original/${slug}/${photoId}.${extension}`;
      object = await c.env.PHOTOS_BUCKET.get(key);
    }
    
    if (!object) {
      return c.json({ error: 'Media not found' }, 404);
    }
    
    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('[MEDIA] Error serving preview:', error);
    return c.json({ error: 'Failed to serve media' }, 500);
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
    
    // Get photo metadata for filename
    const photo = await c.env.DB
      .prepare('SELECT capture_time FROM photos WHERE id = ? AND event_id = ?')
      .bind(photoId, event.id)
      .first<{ capture_time: string }>();
    
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }
    
    // Try to get the preview (small) version
    let key = `preview/${slug}/${photoId}.jpg`;
    let object = await c.env.PHOTOS_BUCKET.get(key);
    
    // If preview version doesn't exist, fall back to original
    if (!object) {
      key = `original/${slug}/${photoId}.jpg`;
      object = await c.env.PHOTOS_BUCKET.get(key);
    }
    
    if (!object) {
      return c.json({ error: 'Photo not found' }, 404);
    }
    
    // Generate filename: eventSlug_captureTime_photoId_small.jpg
    const captureTime = photo.capture_time.replace(/[:.]/g, '-');
    const filename = `${slug}_${captureTime}_${photoId}_small.jpg`;
    
    return new Response(object.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('Error serving IG photo:', error);
    return c.json({ error: 'Failed to serve photo' }, 500);
  }
});

/**
 * GET /media/:slug/original/:photoId.(jpg|mp4)
 * Serves original full-resolution image or video (requires authentication)
 * Sets Content-Disposition with renamed filename
 */
app.get('/media/:slug/original/:photoId', async (c) => {
  const slug = c.req.param('slug');
  const photoIdWithExt = c.req.param('photoId');
  const photoId = photoIdWithExt.replace(/\.(jpg|mp4)$/, '');
  
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
      .prepare('SELECT capture_time, file_type FROM photos WHERE id = ? AND event_id = ?')
      .bind(photoId, event.id)
      .first<{ capture_time: string; file_type: string }>();
    
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }
    
    const fileType = photo.file_type || 'image/jpeg';
    const isVideo = fileType === 'video/mp4';
    const extension = isVideo ? 'mp4' : 'jpg';
    const contentType = isVideo ? 'video/mp4' : 'image/jpeg';
    
    // Get from R2
    const key = `original/${slug}/${photoId}.${extension}`;
    const object = await c.env.PHOTOS_BUCKET.get(key);
    
    if (!object) {
      return c.json({ error: 'Media not found in storage' }, 404);
    }
    
    // Generate filename: eventSlug_captureTime_photoId.ext
    const captureTime = photo.capture_time.replace(/[:.]/g, '-');
    const filename = `${slug}_${captureTime}_${photoId}.${extension}`;
    
    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('Error serving original:', error);
    return c.json({ error: 'Failed to serve media' }, 500);
  }
});

export default app;
