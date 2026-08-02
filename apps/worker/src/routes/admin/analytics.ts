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
    
    // Get total photos (excludes trashed photos, which are shown separately in the Trash view)
    const photosResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM photos WHERE deleted_at IS NULL')
      .first<{ count: number }>();
    
    // Get total favorites
    const favoritesResult = await c.env.DB
      .prepare('SELECT SUM(favorites_count) as total FROM photos WHERE deleted_at IS NULL')
      .first<{ total: number | null }>();
    
    // Estimate storage from unique stored originals only.
    // Copied photos are DB-only references and should not increase storage usage.
    const storageResult = await c.env.DB
      .prepare('SELECT SUM(COALESCE(width, 0) * COALESCE(height, 0) * 1.0) as pixels FROM photos WHERE source_photo_id IS NULL')
      .first<{ pixels: number | null }>();
    
    const storageBytes = storageResult?.pixels ? (storageResult.pixels / 3) : 0;
    
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

/**
 * GET /activity
 * Recent site-wide activity feed (favorites, event/album creation, photo
 * trashing) — read via polling from the admin UI, no realtime infra. See
 * apps/worker/src/activityLog.ts for what gets logged and why; per-event
 * collaboration actions (invite/accept/upload/etc.) have their own richer
 * history at GET /admin/events/:slug/collaboration-history instead.
 */
app.get('/activity', async (c) => {
  try {
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
    const rows = await c.env.DB
      .prepare(`
        SELECT a.id, a.event_id, a.actor_email, a.action, a.target_type, a.target_id,
               a.metadata, a.created_at, e.name as event_name, e.slug as event_slug
        FROM activity_log a
        LEFT JOIN events e ON a.event_id = e.id
        ORDER BY a.created_at DESC
        LIMIT ?
      `)
      .bind(limit)
      .all();

    return c.json({ activity: rows.results || [] });
  } catch (error) {
    console.error('Error fetching activity feed:', error);
    return c.json({ error: 'Failed to fetch activity feed' }, 500);
  }
});

export default app;
