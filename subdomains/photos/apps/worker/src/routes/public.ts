import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Event, Photo } from './types';
import { getEventSession } from './cookies';

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
      .prepare('SELECT id, slug, name, inferred_date, created_at FROM events ORDER BY inferred_date DESC, created_at DESC')
      .all<Omit<Event, 'password_salt' | 'password_hash'>>();
    
    return c.json({ events: events.results || [] });
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
      .prepare('SELECT id, slug, name, inferred_date, created_at FROM events WHERE slug = ?')
      .bind(slug)
      .first<Omit<Event, 'password_salt' | 'password_hash'>>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    return c.json({ event });
  } catch (error) {
    console.error('Error fetching event:', error);
    return c.json({ error: 'Failed to fetch event' }, 500);
  }
});

/**
 * GET /api/events/:slug/photos
 * Returns photos for an event (requires authentication)
 * Supports query params: from (ISO date), to (ISO date)
 */
app.get('/api/events/:slug/photos', async (c) => {
  const slug = c.req.param('slug');
  const from = c.req.query('from');
  const to = c.req.query('to');
  
  // Check authentication
  const isAuthenticated = await getEventSession(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
  if (!isAuthenticated) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  
  try {
    // Get event
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Build query with optional date filters
    let query = 'SELECT id, event_id, original_filename, capture_time, uploaded_at, width, height FROM photos WHERE event_id = ?';
    const params: any[] = [event.id];
    
    if (from) {
      query += ' AND capture_time >= ?';
      params.push(from);
    }
    
    if (to) {
      query += ' AND capture_time <= ?';
      params.push(to);
    }
    
    query += ' ORDER BY capture_time DESC';
    
    const photos = await c.env.DB
      .prepare(query)
      .bind(...params)
      .all<Photo>();
    
    return c.json({ photos: photos.results || [] });
  } catch (error) {
    console.error('Error fetching photos:', error);
    return c.json({ error: 'Failed to fetch photos' }, 500);
  }
});

/**
 * GET /api/events/:slug/photos/:photoId
 * Returns single photo details (requires authentication)
 */
app.get('/api/events/:slug/photos/:photoId', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId');
  
  // Check authentication
  const isAuthenticated = await getEventSession(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
  if (!isAuthenticated) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  
  try {
    // Get event
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
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

export default app;
