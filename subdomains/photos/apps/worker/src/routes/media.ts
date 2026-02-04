import { Hono } from 'hono';
import type { Env } from '../types';
import { getEventSession } from '../cookies';

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /media/:slug/preview/:photoId.jpg
 * Serves watermarked preview image (requires authentication)
 */
app.get('/media/:slug/preview/:photoId.jpg', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId');
  
  // Check authentication
  const isAuthenticated = await getEventSession(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
  if (!isAuthenticated) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  
  try {
    const key = `preview/${slug}/${photoId}.jpg`;
    const object = await c.env.PHOTOS_BUCKET.get(key);
    
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
    console.error('Error serving preview:', error);
    return c.json({ error: 'Failed to serve photo' }, 500);
  }
});

/**
 * GET /media/:slug/ig/:photoId.jpg
 * Serves Instagram-ready watermarked image (requires authentication)
 */
app.get('/media/:slug/ig/:photoId.jpg', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId');
  
  // Check authentication
  const isAuthenticated = await getEventSession(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
  if (!isAuthenticated) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  
  try {
    const key = `ig/${slug}/${photoId}.jpg`;
    const object = await c.env.PHOTOS_BUCKET.get(key);
    
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
app.get('/media/:slug/original/:photoId.jpg', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId');
  
  // Check authentication
  const isAuthenticated = await getEventSession(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
  if (!isAuthenticated) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  
  try {
    // Get photo metadata for filename
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
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
