import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../types';

const app = new Hono<{ Bindings: Env }>();

// CORS configuration
app.use('/*', cors({
  origin: '*',
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

/**
 * POST /api/photos/:photoId/favorite
 * Increments the favorites count for a photo
 */
app.post('/api/photos/:photoId/favorite', async (c) => {
  try {
    const photoId = c.req.param('photoId');
    
    // Increment favorites_count
    await c.env.DB
      .prepare('UPDATE photos SET favorites_count = favorites_count + 1 WHERE id = ?')
      .bind(photoId)
      .run();
    
    // Get updated count
    const result = await c.env.DB
      .prepare('SELECT favorites_count FROM photos WHERE id = ?')
      .bind(photoId)
      .first<{ favorites_count: number }>();
    
    return c.json({ favorites_count: result?.favorites_count || 0 });
  } catch (error) {
    console.error('Error incrementing favorites:', error);
    return c.json({ error: 'Failed to favorite photo' }, 500);
  }
});

/**
 * GET /api/photos/featured
 * Returns all featured photos across all public events
 * Falls back to recent photos if no featured photos exist
 */
app.get('/api/photos/featured', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '10');
    
    // Try to get featured photos first
    let photos = await c.env.DB
      .prepare(`
        SELECT p.*, e.slug as event_slug, e.name as event_name
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.is_featured = 1 AND e.password_hash IS NULL
        ORDER BY p.capture_time DESC
        LIMIT ?
      `)
      .bind(limit)
      .all();
    
    // If no featured photos, fall back to recent photos from public events
    if (!photos.results || photos.results.length === 0) {
      photos = await c.env.DB
        .prepare(`
          SELECT p.*, e.slug as event_slug, e.name as event_name
          FROM photos p
          JOIN events e ON p.event_id = e.id
          WHERE e.password_hash IS NULL
          ORDER BY p.capture_time DESC
          LIMIT ?
        `)
        .bind(limit)
        .all();
    }
    
    return c.json({ photos: photos.results || [] });
  } catch (error) {
    console.error('Error fetching featured photos:', error);
    return c.json({ error: 'Failed to fetch featured photos' }, 500);
  }
});

/**
 * GET /api/photos/most-favorited
 * Returns most favorited photos
 */
app.get('/api/photos/most-favorited', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '20');
    
    const photos = await c.env.DB
      .prepare(`
        SELECT p.*, e.slug as event_slug, e.name as event_name
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE e.password_hash IS NULL
        ORDER BY p.favorites_count DESC, p.capture_time DESC
        LIMIT ?
      `)
      .bind(limit)
      .all();
    
    return c.json({ photos: photos.results || [] });
  } catch (error) {
    console.error('Error fetching most favorited photos:', error);
    return c.json({ error: 'Failed to fetch most favorited photos' }, 500);
  }
});

/**
 * GET /api/tags
 * Returns all available tags
 */
app.get('/api/tags', async (c) => {
  try {
    const tags = await c.env.DB
      .prepare('SELECT * FROM tags ORDER BY name')
      .all();
    
    return c.json({ tags: tags.results || [] });
  } catch (error) {
    console.error('Error fetching tags:', error);
    return c.json({ error: 'Failed to fetch tags' }, 500);
  }
});

/**
 * GET /api/events/by-tag/:tagSlug
 * Returns events filtered by tag
 */
app.get('/api/events/by-tag/:tagSlug', async (c) => {
  try {
    const tagSlug = c.req.param('tagSlug');
    console.log('Fetching events for tag:', tagSlug);
    
    // First get events with the tag
    const events = await c.env.DB
      .prepare(`
        SELECT DISTINCT 
          e.id, 
          e.slug, 
          e.name, 
          e.inferred_date, 
          e.created_at,
          (e.password_hash IS NOT NULL) as requires_password
        FROM events e
        JOIN event_tags et ON e.id = et.event_id
        JOIN tags t ON et.tag_id = t.id
        WHERE t.slug = ?
        ORDER BY e.inferred_date DESC, e.created_at DESC
      `)
      .bind(tagSlug)
      .all();
    
    console.log('Events found:', events.results?.length || 0);
    
    const eventsWithDetails = await Promise.all(
      (events.results || []).map(async (event: any) => {
        // Get tags for this event
        const tagsResult = await c.env.DB
          .prepare(`
            SELECT t.id, t.name, t.slug
            FROM tags t
            JOIN event_tags et ON t.id = et.tag_id
            WHERE et.event_id = ?
          `)
          .bind(event.id)
          .all();
        
        // Get preview photo for public events
        let previewPhotoId = null;
        if (!event.requires_password) {
          const previewResult = await c.env.DB
            .prepare('SELECT id FROM photos WHERE event_id = ? LIMIT 1')
            .bind(event.id)
            .first();
          previewPhotoId = previewResult?.id || null;
        }
        
        return {
          ...event,
          tags: tagsResult.results || [],
          preview_photo_id: previewPhotoId
        };
      })
    );
    
    return c.json({ events: eventsWithDetails });
  } catch (error) {
    console.error('Error fetching events by tag:', error);
    return c.json({ error: 'Failed to fetch events' }, 500);
  }
});

export default app;
