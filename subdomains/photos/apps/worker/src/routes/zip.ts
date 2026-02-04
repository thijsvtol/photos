import { Hono } from 'hono';
import type { Env, ZipRequest } from '../types';
import { getEventSession } from '../cookies';

const app = new Hono<{ Bindings: Env }>();

/**
 * POST /api/events/:slug/zip
 * Creates a ZIP file with selected photos (max 50)
 * Note: This is a simplified implementation that returns URLs
 * In production, you might want to use a separate service to generate actual ZIP files
 */
app.post('/api/events/:slug/zip', async (c) => {
  const slug = c.req.param('slug');
  
  // Check authentication
  const isAuthenticated = await getEventSession(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
  if (!isAuthenticated) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  
  try {
    const body = await c.req.json<ZipRequest>();
    
    if (!body.photoIds || body.photoIds.length === 0) {
      return c.json({ error: 'photoIds array is required' }, 400);
    }
    
    if (body.photoIds.length > 50) {
      return c.json({ error: 'Maximum 50 photos can be downloaded at once' }, 400);
    }
    
    // Verify event exists
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Verify all photos belong to this event
    const placeholders = body.photoIds.map(() => '?').join(',');
    const photos = await c.env.DB
      .prepare(`SELECT id FROM photos WHERE event_id = ? AND id IN (${placeholders})`)
      .bind(event.id, ...body.photoIds)
      .all();
    
    if (!photos.results || photos.results.length !== body.photoIds.length) {
      return c.json({ error: 'Some photos not found or do not belong to this event' }, 400);
    }
    
    // For now, return list of download URLs
    // In production, implement actual ZIP generation using a streaming approach
    const downloadUrls = body.photoIds.map(photoId => ({
      photoId,
      url: `/media/${slug}/original/${photoId}.jpg`,
    }));
    
    return c.json({
      message: 'Download URLs generated',
      photos: downloadUrls,
      note: 'Download each photo individually. ZIP generation can be implemented server-side or client-side.',
    });
  } catch (error) {
    console.error('Error generating ZIP:', error);
    return c.json({ error: 'Failed to generate ZIP' }, 500);
  }
});

export default app;
