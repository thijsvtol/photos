import { Hono } from 'hono';
import type { Env, User } from '../../types';
import { requireAdmin } from '../../auth';

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Apply admin authentication
app.use('/*', requireAdmin);

/**
 * GET /stats
 * Get overall admin statistics
 */
app.get('/', async (c) => {
  try {
    // Get total events
    const eventsResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM events')
      .first<{ count: number }>();
    
    // Get public/private event counts
    const publicEventsResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM events WHERE visibility = ?')
      .bind('public')
      .first<{ count: number }>();
    
    const privateEventsResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM events WHERE visibility = ?')
      .bind('private')
      .first<{ count: number }>();
    
    // Get total photos
    const photosResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM photos')
      .first<{ count: number }>();
    
    // Get total favorites
    const favoritesResult = await c.env.DB
      .prepare('SELECT SUM(favorites_count) as total FROM photos')
      .first<{ total: number | null }>();
    
    // Estimate storage (rough calculation: width * height * 3 bytes per pixel / 3 for JPEG compression)
    const storageResult = await c.env.DB
      .prepare('SELECT SUM(COALESCE(width, 0) * COALESCE(height, 0) * 1.0) as pixels FROM photos')
      .first<{ pixels: number | null }>();
    
    const storageBytes = storageResult?.pixels ? (storageResult.pixels * 3 / 3) : 0;
    
    // Get recent events (last 10)
    const recentEvents = await c.env.DB
      .prepare(`
        SELECT 
          e.id, 
          e.slug, 
          e.name, 
          e.created_at,
          COUNT(p.id) as photo_count
        FROM events e
        LEFT JOIN photos p ON p.event_id = e.id
        GROUP BY e.id
        ORDER BY e.created_at DESC
        LIMIT 10
      `)
      .all();
    
    return c.json({
      totalEvents: eventsResult?.count || 0,
      publicEvents: publicEventsResult?.count || 0,
      privateEvents: privateEventsResult?.count || 0,
      totalPhotos: photosResult?.count || 0,
      totalFavorites: favoritesResult?.total || 0,
      storageBytes: Math.round(storageBytes),
      recentEvents: recentEvents.results,
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    return c.json({ error: 'Failed to get stats' }, 500);
  }
});

export default app;
