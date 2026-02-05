import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Event, Photo } from '../types';
import { getEventSession } from '../cookies';

const app = new Hono<{ Bindings: Env }>();

// CORS configuration for same-origin requests
app.use('/*', cors({
  origin: '*',
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Access'],
}));

/**
 * GET /api/events
 * Returns list of all events (without sensitive data)
 */
app.get('/api/events', async (c) => {
  try {
    const events = await c.env.DB
      .prepare('SELECT id, slug, name, inferred_date, created_at, (password_hash IS NOT NULL) as requires_password FROM events ORDER BY inferred_date DESC, created_at DESC')
      .all<Omit<Event, 'password_salt' | 'password_hash'>>();
    
    // For public events, add a preview photo ID
    const eventsWithPreviews = await Promise.all(
      (events.results || []).map(async (event) => {
        if (!(event as any).requires_password) {
          // Get the first photo for this event as preview
          const photo = await c.env.DB
            .prepare('SELECT id FROM photos WHERE event_id = ? ORDER BY capture_time ASC LIMIT 1')
            .bind(event.id)
            .first<{ id: string }>();
          
          return { ...event, preview_photo_id: photo?.id || null };
        }
        return { ...event, preview_photo_id: null };
      })
    );
    
    return c.json({ events: eventsWithPreviews });
  } catch (error) {
    console.error('Error fetching events:', error);
    return c.json({ error: 'Failed to fetch events' }, 500);
  }
});

/**
 * GET /api/events/:slug
 * Returns event details (without sensitive data)
 */
app.get('/api/events/:slug', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    const event = await c.env.DB
      .prepare('SELECT id, slug, name, inferred_date, created_at, (password_hash IS NOT NULL) as requires_password FROM events WHERE slug = ?')
      .bind(slug)
      .first<Omit<Event, 'password_salt' | 'password_hash'>>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Get tags for this event
    const tags = await c.env.DB
      .prepare(`
        SELECT t.* FROM tags t
        JOIN event_tags et ON t.id = et.tag_id
        WHERE et.event_id = ?
      `)
      .bind(event.id)
      .all();
    
    return c.json({ event: { ...event, tags: tags.results || [] } });
  } catch (error) {
    console.error('Error fetching event:', error);
    return c.json({ error: 'Failed to fetch event' }, 500);
  }
});

/**
 * GET /api/events/:slug/photos
 * Returns photos for an event (requires authentication if password protected)
 * Supports query params: sort (date_asc, date_desc, name_asc, name_desc)
 */
app.get('/api/events/:slug/photos', async (c) => {
  const slug = c.req.param('slug');
  const sort = c.req.query('sort') || 'date_desc';
  
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
    
    // Build query with sorting
    let orderBy = 'capture_time DESC'; // default
    switch (sort) {
      case 'date_asc':
        orderBy = 'capture_time ASC';
        break;
      case 'date_desc':
        orderBy = 'capture_time DESC';
        break;
      case 'name_asc':
        orderBy = 'original_filename ASC';
        break;
      case 'name_desc':
        orderBy = 'original_filename DESC';
        break;
    }
    
    const query = `SELECT * FROM photos WHERE event_id = ? ORDER BY ${orderBy}`;
    
    const photos = await c.env.DB
      .prepare(query)
      .bind(event.id)
      .all<Photo>();
    
    return c.json({ photos: photos.results || [] });
  } catch (error) {
    console.error('Error fetching photos:', error);
    return c.json({ error: 'Failed to fetch photos' }, 500);
  }
});

/**
 * GET /api/events/:slug/photos/:photoId
 * Returns single photo details (requires authentication if password protected)
 */
app.get('/api/events/:slug/photos/:photoId', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId');
  
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
    
    // Get photo
    const photo = await c.env.DB
      .prepare('SELECT id, event_id, original_filename, capture_time, uploaded_at, width, height FROM photos WHERE id = ? AND event_id = ?')
      .bind(photoId, event.id)
      .first<Photo>();
    
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }
    
    return c.json({ photo });
  } catch (error) {
    console.error('Error fetching photo:', error);
    return c.json({ error: 'Failed to fetch photo' }, 500);
  }
});

/**
 * GET /api/tags
 * Returns list of all tags
 */
app.get('/api/tags', async (c) => {
  try {
    const tags = await c.env.DB
      .prepare('SELECT id, name, slug FROM tags ORDER BY name ASC')
      .all();
    
    return c.json({ tags: tags.results || [] });
  } catch (error) {
    console.error('Error fetching tags:', error);
    return c.json({ error: 'Failed to fetch tags' }, 500);
  }
});

/**
 * GET /api/events/by-tag/:tagSlug
 * Returns events that have a specific tag
 */
app.get('/api/events/by-tag/:tagSlug', async (c) => {
  const tagSlug = c.req.param('tagSlug');
  
  try {
    const events = await c.env.DB
      .prepare(`
        SELECT DISTINCT e.id, e.slug, e.name, e.inferred_date, e.created_at, (e.password_hash IS NOT NULL) as requires_password
        FROM events e
        JOIN event_tags et ON e.id = et.event_id
        JOIN tags t ON et.tag_id = t.id
        WHERE t.slug = ?
        ORDER BY e.inferred_date DESC, e.created_at DESC
      `)
      .bind(tagSlug)
      .all();
    
    return c.json({ events: events.results || [] });
  } catch (error) {
    console.error('Error fetching events by tag:', error);
    return c.json({ error: 'Failed to fetch events' }, 500);
  }
});

export default app;
