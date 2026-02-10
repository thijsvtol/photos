import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Event, Photo } from '../types';
import { getEventSession } from '../cookies';
import { optionalAuth, getUser, isAdmin } from '../auth';

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
 * Returns list of events filtered by visibility:
 * - Public events: visible to everyone
 * - Private events: visible only to admins
 * - Collaborators-only events: visible to admins and collaborators
 */
app.get('/api/events', optionalAuth, async (c) => {
  try {
    const user = getUser(c);
    const userIsAdmin = isAdmin(c);
    const userEmail = user?.email || '';

    // Build query with visibility filtering
    // LEFT JOIN to check if current user is a collaborator
    const query = `
      SELECT DISTINCT 
        e.id, 
        e.slug, 
        e.name, 
        e.inferred_date, 
        e.created_at, 
        e.visibility,
        (e.password_hash IS NOT NULL) as requires_password 
      FROM events e
      LEFT JOIN event_collaborators ec ON e.id = ec.event_id AND ec.user_email = ?
      WHERE 
        e.visibility = 'public'  -- Always show public events
        OR (? = 1)  -- Show all events if user is admin
        OR (e.visibility = 'collaborators_only' AND ec.user_email IS NOT NULL)  -- Show collaborators_only if user is collaborator
        OR (e.visibility = 'private' AND ? = 1)  -- Show private events only to admins
      ORDER BY e.inferred_date DESC, e.created_at DESC
    `;
    
    const events = await c.env.DB
      .prepare(query)
      .bind(userEmail, userIsAdmin ? 1 : 0, userIsAdmin ? 1 : 0)
      .all<Omit<Event, 'password_salt' | 'password_hash'>>();
    
    // For public events, add a preview photo ID and cities
    const eventsWithPreviews = await Promise.all(
      (events.results || []).map(async (event) => {
        let preview_photo_id = null;
        
        if (!(event as any).requires_password) {
          // Get the first photo for this event as preview
          const photo = await c.env.DB
            .prepare('SELECT id FROM photos WHERE event_id = ? ORDER BY capture_time ASC LIMIT 1')
            .bind(event.id)
            .first<{ id: string }>();
          
          preview_photo_id = photo?.id || null;
        }
        
        // Get unique cities for this event
        const citiesResult = await c.env.DB
          .prepare('SELECT DISTINCT city FROM photos WHERE event_id = ? AND city IS NOT NULL ORDER BY city ASC')
          .bind(event.id)
          .all<{ city: string }>();
        
        const cities = (citiesResult.results || []).map(r => r.city);
        
        // Get tags for this event
        const tagsResult = await c.env.DB
          .prepare(`
            SELECT t.* FROM tags t
            JOIN event_tags et ON t.id = et.tag_id
            WHERE et.event_id = ?
          `)
          .bind(event.id)
          .all();
        
        const tags = tagsResult.results || [];
        
        return { ...event, preview_photo_id, cities, tags };
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
app.get('/api/events/:slug', optionalAuth, async (c) => {
  const slug = c.req.param('slug');
  
  try {
    const user = getUser(c);
    const userIsAdmin = isAdmin(c);
    const userEmail = user?.email || '';
    
    const event = await c.env.DB
      .prepare('SELECT id, slug, name, inferred_date, created_at, visibility, (password_hash IS NOT NULL) as requires_password FROM events WHERE slug = ?')
      .bind(slug)
      .first<Omit<Event, 'password_salt' | 'password_hash'>>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Check if user has permission to view this event based on visibility
    if (event.visibility === 'private' && !userIsAdmin) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    if (event.visibility === 'collaborators_only' && !userIsAdmin) {
      // Check if user is a collaborator
      const collaborator = await c.env.DB
        .prepare('SELECT user_email FROM event_collaborators WHERE event_id = ? AND user_email = ?')
        .bind(event.id, userEmail)
        .first();
      
      if (!collaborator) {
        return c.json({ error: 'Event not found' }, 404);
      }
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
app.get('/api/events/:slug/photos', optionalAuth, async (c) => {
  const slug = c.req.param('slug');
  const sort = c.req.query('sort') || 'date_asc';
  
  try {
    const user = getUser(c);
    const userIsAdmin = isAdmin(c);
    const userEmail = user?.email || '';
    
    // Get event to check if password protected and visibility
    const event = await c.env.DB
      .prepare('SELECT id, password_hash, visibility FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number; password_hash: string | null; visibility: string }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Check if user has permission to view this event based on visibility
    if (event.visibility === 'private' && !userIsAdmin) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    if (event.visibility === 'collaborators_only' && !userIsAdmin) {
      // Check if user is a collaborator
      const collaborator = await c.env.DB
        .prepare('SELECT user_email FROM event_collaborators WHERE event_id = ? AND user_email = ?')
        .bind(event.id, userEmail)
        .first();
      
      if (!collaborator) {
        return c.json({ error: 'Event not found' }, 404);
      }
    }
    
    // Check authentication only if password protected
    if (event.password_hash) {
      const isAuthenticated = await getEventSession(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
      if (!isAuthenticated) {
        return c.json({ error: 'Authentication required' }, 401);
      }
    }
    
    // Build query with sorting and join uploader name
    let orderBy = 'p.capture_time DESC'; // default
    switch (sort) {
      case 'date_asc':
        orderBy = 'p.capture_time ASC';
        break;
      case 'date_desc':
        orderBy = 'p.capture_time DESC';
        break;
      case 'name_asc':
        orderBy = 'p.original_filename ASC';
        break;
      case 'name_desc':
        orderBy = 'p.original_filename DESC';
        break;
    }
    
    const query = `
      SELECT p.*, p.uploaded_by as uploader_name 
      FROM photos p
      WHERE p.event_id = ? 
      ORDER BY ${orderBy}
    `;
    
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
app.get('/api/events/:slug/photos/:photoId', optionalAuth, async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId');
  
  try {
    const user = getUser(c);
    const userIsAdmin = isAdmin(c);
    const userEmail = user?.email || '';
    
    // Get event to check if password protected and visibility
    const event = await c.env.DB
      .prepare('SELECT id, password_hash, visibility FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number; password_hash: string | null; visibility: string }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Check if user has permission to view this event based on visibility
    if (event.visibility === 'private' && !userIsAdmin) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    if (event.visibility === 'collaborators_only' && !userIsAdmin) {
      // Check if user is a collaborator
      const collaborator = await c.env.DB
        .prepare('SELECT user_email FROM event_collaborators WHERE event_id = ? AND user_email = ?')
        .bind(event.id, userEmail)
        .first();
      
      if (!collaborator) {
        return c.json({ error: 'Event not found' }, 404);
      }
    }
    
    // Check authentication only if password protected
    if (event.password_hash) {
      const isAuthenticated = await getEventSession(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
      if (!isAuthenticated) {
        return c.json({ error: 'Authentication required' }, 401);
      }
    }
    
    // Get photo with uploader name
    const photo = await c.env.DB
      .prepare(`
        SELECT p.*, p.uploaded_by as uploader_name 
        FROM photos p
        WHERE p.id = ? AND p.event_id = ?
      `)
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

export default app;
