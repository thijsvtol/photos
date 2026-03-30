import { Hono } from 'hono';
import type { Env, CreateEventRequest, User } from '../../types';
import { generateSalt, hashPassword, generateUniqueSlug } from '../../utils';
import { requireAdmin } from '../../auth';

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Apply admin authentication
app.use('/*', requireAdmin);

/**
 * POST /events
 * Creates a new event
 */
app.post('/', async (c) => {
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
      .prepare('INSERT INTO events (slug, name, password_salt, password_hash, visibility) VALUES (?, ?, ?, ?, ?)')
      .bind(slug, body.name, salt, hash, body.visibility || 'public')
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
 * PUT /events/:slug
 * Update event details
 */
app.put('/:slug', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    const { name, password, description, visibility } = await c.req.json<{
      name?: string;
      password?: string;
      description?: string;
      visibility?: string;
    }>();
    
    // Get event
    const event = await c.env.DB
      .prepare('SELECT id, password_salt FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number; password_salt: string | null }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    
    if (visibility !== undefined) {
      updates.push('visibility = ?');
      values.push(visibility || 'public');
    }
    
    if (password !== undefined) {
      if (password === '') {
        // Remove password
        updates.push('password_hash = NULL', 'password_salt = NULL');
      } else {
        // Set new password
        const salt = generateSalt();
        const hash = await hashPassword(password, salt);
        updates.push('password_hash = ?', 'password_salt = ?');
        values.push(hash, salt);
      }
    }
    
    if (updates.length === 0) {
      return c.json({ error: 'No updates provided' }, 400);
    }
    
    // Add event ID for WHERE clause
    values.push(event.id);
    
    await c.env.DB
      .prepare(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error updating event:', error);
    return c.json({ error: 'Failed to update event' }, 500);
  }
});

/**
 * DELETE /events/:slug
 * Delete event and all associated photos
 */
app.delete('/:slug', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    // Get event and all photos
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Get all photo IDs for R2 cleanup (only non-copied photos have their own R2 files)
    const photos = await c.env.DB
      .prepare('SELECT id FROM photos WHERE event_id = ? AND source_photo_id IS NULL')
      .bind(event.id)
      .all<{ id: string }>();
    
    // Delete from R2 (original, preview, ig sizes)
    for (const photo of photos.results || []) {
      try {
        await c.env.PHOTOS_BUCKET.delete(`original/${slug}/${photo.id}.jpg`);
        await c.env.PHOTOS_BUCKET.delete(`preview/${slug}/${photo.id}.jpg`);
        await c.env.PHOTOS_BUCKET.delete(`ig/${slug}/${photo.id}.jpg`);
      } catch (err) {
        console.error(`Failed to delete photo ${photo.id} from R2:`, err);
        // Continue with other photos
      }
    }
    
    // Delete from database (cascading will handle photos and event_tags)
    await c.env.DB
      .prepare('DELETE FROM events WHERE id = ?')
      .bind(event.id)
      .run();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting event:', error);
    return c.json({ error: 'Failed to delete event' }, 500);
  }
});

/**
 * PUT /events/:slug/location
 * Set GPS location for all photos in an event that don't have GPS data
 */
app.put('/:slug/location', async (c) => {
  try {
    const slug = c.req.param('slug');
    const { latitude, longitude } = await c.req.json<{ latitude: number; longitude: number }>();
    
    if (!latitude || !longitude) {
      return c.json({ error: 'Latitude and longitude are required' }, 400);
    }
    
    // First get the event_id from the slug
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Update photos that don't have GPS coordinates
    const result = await c.env.DB
      .prepare('UPDATE photos SET latitude = ?, longitude = ? WHERE event_id = ? AND (latitude IS NULL OR longitude IS NULL)')
      .bind(latitude, longitude, event.id)
      .run();
    
    return c.json({ success: true, updated_count: result.meta.changes });
  } catch (error) {
    console.error('Error setting event location:', error);
    return c.json({ error: 'Failed to set event location' }, 500);
  }
});

/**
 * POST /events/:slug/tags
 * Set tags for an event (replaces all existing tags)
 */
app.post('/:slug/tags', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    const { tagIds } = await c.req.json<{ tagIds: number[] }>();
    
    if (!Array.isArray(tagIds)) {
      return c.json({ error: 'Invalid tagIds format' }, 400);
    }
    
    // Get event ID
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Delete existing tags
    await c.env.DB
      .prepare('DELETE FROM event_tags WHERE event_id = ?')
      .bind(event.id)
      .run();
    
    // Insert new tags
    if (tagIds.length > 0) {
      for (const tagId of tagIds) {
        await c.env.DB
          .prepare('INSERT INTO event_tags (event_id, tag_id) VALUES (?, ?)')
          .bind(event.id, tagId)
          .run();
      }
    }
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error setting event tags:', error);
    return c.json({ error: 'Failed to set event tags' }, 500);
  }
});

export default app;
