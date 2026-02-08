import { Hono } from 'hono';
import type { Env, Photo, UserFavorite } from '../types';
import { requireAuth, optionalAuth, getUser, isAdmin } from '../auth';

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /api/favorites
 * Get all favorites for the authenticated user
 */
app.get('/api/favorites', requireAuth, async (c) => {
  const user = getUser(c);
  
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    // Get all favorites with photo details
    const favorites = await c.env.DB
      .prepare(`
        SELECT 
          uf.photo_id,
          uf.event_id,
          uf.created_at as favorited_at,
          p.*,
          e.slug as event_slug,
          e.name as event_name
        FROM user_favorites uf
        JOIN photos p ON uf.photo_id = p.id
        JOIN events e ON uf.event_id = e.id
        WHERE uf.user_id = ?
        ORDER BY uf.created_at DESC
      `)
      .bind(user.id)
      .all();

    return c.json({ 
      favorites: favorites.results || [],
      count: favorites.results?.length || 0
    });
  } catch (error) {
    console.error('Error fetching favorites:', error);
    return c.json({ error: 'Failed to fetch favorites' }, 500);
  }
});

/**
 * GET /api/favorites/ids
 * Get just the photo IDs that are favorited (for UI state)
 */
app.get('/api/favorites/ids', requireAuth, async (c) => {
  const user = getUser(c);
  
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const favorites = await c.env.DB
      .prepare(`
        SELECT photo_id, event_id
        FROM user_favorites
        WHERE user_id = ?
      `)
      .bind(user.id)
      .all();

    const favoriteIds = (favorites.results || []).map((f: any) => ({
      photoId: f.photo_id,
      eventId: f.event_id
    }));

    return c.json({ favorites: favoriteIds });
  } catch (error) {
    console.error('Error fetching favorite IDs:', error);
    return c.json({ error: 'Failed to fetch favorites' }, 500);
  }
});

/**
 * POST /api/favorites/:photoId
 * Add a photo to favorites
 */
app.post('/api/favorites/:photoId', requireAuth, async (c) => {
  const user = getUser(c);
  const photoId = c.req.param('photoId');
  
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    // Get photo to find event_id
    const photo = await c.env.DB
      .prepare('SELECT id, event_id FROM photos WHERE id = ?')
      .bind(photoId)
      .first<Photo>();

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    // Insert favorite (ignore if already exists)
    await c.env.DB
      .prepare(`
        INSERT INTO user_favorites (user_id, photo_id, event_id)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, photo_id) DO NOTHING
      `)
      .bind(user.id, photoId, photo.event_id)
      .run();

    // Update favorites count
    await c.env.DB
      .prepare(`
        UPDATE photos
        SET favorites_count = (
          SELECT COUNT(*) FROM user_favorites WHERE photo_id = ?
        )
        WHERE id = ?
      `)
      .bind(photoId, photoId)
      .run();

    return c.json({ success: true, message: 'Added to favorites' });
  } catch (error) {
    console.error('Error adding favorite:', error);
    return c.json({ error: 'Failed to add favorite' }, 500);
  }
});

/**
 * DELETE /api/favorites/:photoId
 * Remove a photo from favorites
 */
app.delete('/api/favorites/:photoId', requireAuth, async (c) => {
  const user = getUser(c);
  const photoId = c.req.param('photoId');
  
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    // Delete favorite
    await c.env.DB
      .prepare('DELETE FROM user_favorites WHERE user_id = ? AND photo_id = ?')
      .bind(user.id, photoId)
      .run();

    // Update favorites count
    await c.env.DB
      .prepare(`
        UPDATE photos
        SET favorites_count = (
          SELECT COUNT(*) FROM user_favorites WHERE photo_id = ?
        )
        WHERE id = ?
      `)
      .bind(photoId, photoId)
      .run();

    return c.json({ success: true, message: 'Removed from favorites' });
  } catch (error) {
    console.error('Error removing favorite:', error);
    return c.json({ error: 'Failed to remove favorite' }, 500);
  }
});

/**
 * GET /api/user/profile
 * Get current user profile (optional auth - returns null if not authenticated)
 */
app.get('/api/user/profile', optionalAuth, async (c) => {
  const user = getUser(c);
  
  // Return null if not authenticated (don't force login)
  if (!user) {
    return c.json({ user: null });
  }

  try {
    // Get user with favorite count
    const dbUser = await c.env.DB
      .prepare(`
        SELECT 
          u.*,
          COUNT(uf.photo_id) as favorites_count
        FROM users u
        LEFT JOIN user_favorites uf ON u.id = uf.user_id
        WHERE u.id = ?
        GROUP BY u.id
      `)
      .bind(user.id)
      .first();

    return c.json({ 
      user: dbUser ? { ...dbUser, isAdmin: isAdmin(c) } : null 
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return c.json({ error: 'Failed to fetch profile' }, 500);
  }
});

export default app;
