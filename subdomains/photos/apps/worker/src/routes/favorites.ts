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
        WHERE uf.user_email = ?
        ORDER BY uf.created_at DESC
      `)
      .bind(user.email)
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
        WHERE user_email = ?
      `)
      .bind(user.email)
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
        INSERT INTO user_favorites (user_email, photo_id, event_id)
        VALUES (?, ?, ?)
        ON CONFLICT(user_email, photo_id) DO NOTHING
      `)
      .bind(user.email, photoId, photo.event_id)
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
      .prepare('DELETE FROM user_favorites WHERE user_email = ? AND photo_id = ?')
      .bind(user.email, photoId)
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
  console.log('[GET /api/user/profile] User from context:', user);
  
  // Return null if not authenticated (don't force login)
  if (!user) {
    console.log('[GET /api/user/profile] No user in context, returning null');
    return c.json({ user: null });
  }

  try {
    console.log('[GET /api/user/profile] Querying DB for user:', user.email);
    
    // First check if user exists
    const userExists = await c.env.DB
      .prepare('SELECT email, name FROM users WHERE email = ?')
      .bind(user.email)
      .first();
    
    console.log('[GET /api/user/profile] Direct user query result:', userExists);
    
    // Get user with favorite count
    const dbUser = await c.env.DB
      .prepare(`
        SELECT 
          u.email,
          u.name,
          u.created_at,
          u.last_login,
          COUNT(uf.photo_id) as favorites_count
        FROM users u
        LEFT JOIN user_favorites uf ON u.email = uf.user_email
        WHERE u.email = ?
        GROUP BY u.email, u.name, u.created_at, u.last_login
      `)
      .bind(user.email)
      .first();

    console.log('[GET /api/user/profile] Full DB query result:', dbUser);
    console.log('[GET /api/user/profile] Name from DB:', dbUser?.name);
    
    return c.json({ 
      user: dbUser ? { ...dbUser, id: user.id, isAdmin: isAdmin(c) } : null 
    });
  } catch (error) {
    console.error('[GET /api/user/profile] Error fetching user profile:', error);
    return c.json({ error: 'Failed to fetch profile' }, 500);
  }
});

/**
 * PUT /api/user/profile
 * Update current user profile
 */
app.put('/api/user/profile', requireAuth, async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json<{ name?: string }>();
    
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return c.json({ error: 'Name is required' }, 400);
    }

    const name = body.name.trim();

    console.log('[PUT /api/user/profile] Updating user:', user.email, 'with name:', name);

    // First, ensure user exists in database
    const existingUser = await c.env.DB
      .prepare('SELECT email, name FROM users WHERE email = ?')
      .bind(user.email)
      .first();

    console.log('[PUT /api/user/profile] Existing user in DB:', existingUser);

    let updateResult;
    if (!existingUser) {
      console.log('[PUT /api/user/profile] User does not exist, creating...');
      // Create user if doesn't exist
      updateResult = await c.env.DB
        .prepare('INSERT INTO users (email, name) VALUES (?, ?)')
        .bind(user.email, name)
        .run();
      console.log('[PUT /api/user/profile] INSERT result:', updateResult);
    } else {
      console.log('[PUT /api/user/profile] User exists, updating...');
      // Update user name
      updateResult = await c.env.DB
        .prepare('UPDATE users SET name = ? WHERE email = ?')
        .bind(name, user.email)
        .run();
      console.log('[PUT /api/user/profile] UPDATE result:', updateResult);
      console.log('[PUT /api/user/profile] Rows affected:', updateResult.meta?.changes);
    }

    // Verify the update worked
    const verifyUser = await c.env.DB
      .prepare('SELECT email, name FROM users WHERE email = ?')
      .bind(user.email)
      .first();
    
    console.log('[PUT /api/user/profile] Verification query result:', verifyUser);
    console.log('[PUT /api/user/profile] Name after update:', verifyUser?.name);

    // Fetch updated user with favorites count
    const updatedUser = await c.env.DB
      .prepare(`
        SELECT 
          u.email,
          u.name,
          u.created_at,
          u.last_login,
          COUNT(uf.photo_id) as favorites_count
        FROM users u
        LEFT JOIN user_favorites uf ON u.email = uf.user_email
        WHERE u.email = ?
        GROUP BY u.email, u.name, u.created_at, u.last_login
      `)
      .bind(user.email)
      .first();

    console.log('[PUT /api/user/profile] Updated user from DB:', updatedUser);
    console.log('[PUT /api/user/profile] Name from DB:', updatedUser?.name);

    return c.json({ 
      user: updatedUser ? { ...updatedUser, id: user.id, isAdmin: isAdmin(c) } : null 
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    return c.json({ error: 'Failed to update profile' }, 500);
  }
});

/**
 * GET /api/user/collaborations
 * Get events where the user is a collaborator
 */
app.get('/api/user/collaborations', requireAuth, async (c) => {
  const user = getUser(c);
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    console.log('[GET /api/user/collaborations] Fetching for user:', user.email);
    const collaborations = await c.env.DB
      .prepare(`
        SELECT 
          ec.event_id,
          e.slug as event_slug,
          e.name as event_name,
          ec.invited_at
        FROM event_collaborators ec
        JOIN events e ON ec.event_id = e.id
        WHERE ec.user_email = ?
        ORDER BY ec.invited_at DESC
      `)
      .bind(user.email)
      .all();

    console.log('[GET /api/user/collaborations] Found', collaborations.results?.length || 0, 'collaborations');
    
    return c.json({ 
      collaborations: (collaborations.results || []).map(collab => ({
        ...collab,
        can_upload: true // All collaborators can upload
      }))
    });
  } catch (error) {
    console.error('[GET /api/user/collaborations] Error:', error);
    return c.json({ error: 'Failed to fetch collaborations' }, 500);
  }
});

export default app;
