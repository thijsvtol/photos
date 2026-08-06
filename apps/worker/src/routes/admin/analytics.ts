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
 * Maps a domain filter to the action prefixes it covers. Kept in sync with
 * ACTIVITY_DOMAINS on the client (apps/web/src/api.ts) — the UI sends a
 * domain, not a list of actions, so adding an action to an existing domain
 * doesn't need a client release.
 */
const DOMAIN_PREFIXES: Record<string, string[]> = {
  photos: ['photo_'],
  events: ['event_'],
  tags: ['tag_'],
  people: ['person_'],
  sharing: ['collab_'],
};

/**
 * GET /activity
 * Site-wide activity feed, read via polling from the admin UI (no realtime
 * infra — see the cost-governance notes).
 *
 * Reads BOTH audit trails and interleaves them by time: `activity_log`
 * (photo/event/tag/people actions — see apps/worker/src/activityLog.ts) and
 * `collaboration_history` (invite/accept/decline/remove plus collaborator
 * uploads — also still surfaced per-event at GET
 * /admin/events/:slug/collaboration-history, which is unaffected by this).
 * Nothing is written to both tables, so the union never double-counts;
 * collaboration_history actions are namespaced to `collab_*` here so the
 * client sees one flat action space.
 *
 * Note the two tables have independent autoincrement ids, so `id` is NOT
 * unique across the result set — callers must key rows on `source` + `id`.
 *
 * Query params: `limit` (≤200), `before` (ISO timestamp cursor),
 * `domain`, `eventSlug`, `actor`.
 */
app.get('/activity', async (c) => {
  try {
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
    const before = c.req.query('before') || null;
    const eventSlug = c.req.query('eventSlug') || null;
    const actor = c.req.query('actor') || null;
    const domain = c.req.query('domain') || null;

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (before) {
      conditions.push('t.created_at < ?');
      params.push(before);
    }
    if (eventSlug) {
      conditions.push('e.slug = ?');
      params.push(eventSlug);
    }
    if (actor) {
      conditions.push('LOWER(t.actor_email) = LOWER(?)');
      params.push(actor);
    }

    const prefixes = domain ? DOMAIN_PREFIXES[domain] : undefined;
    if (prefixes) {
      conditions.push(`(${prefixes.map(() => 't.action LIKE ?').join(' OR ')})`);
      params.push(...prefixes.map((p) => `${p}%`));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Fetch one extra row to determine whether another page exists without a
    // second COUNT query.
    const rows = await c.env.DB
      .prepare(`
        SELECT t.source, t.id, t.event_id, t.actor_email, t.action, t.target_type,
               t.target_id, t.target_user_email, t.metadata, t.created_at,
               e.name as event_name, e.slug as event_slug
        FROM (
          SELECT 'activity' AS source, a.id, a.event_id, a.actor_email, a.action,
                 a.target_type, a.target_id, NULL AS target_user_email,
                 a.metadata, a.created_at
          FROM activity_log a
          UNION ALL
          SELECT 'collab' AS source, h.id, h.event_id, h.user_email, 'collab_' || h.action_type,
                 NULL AS target_type, NULL AS target_id, h.target_user_email,
                 h.metadata, h.created_at
          FROM collaboration_history h
        ) t
        LEFT JOIN events e ON t.event_id = e.id
        ${where}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ?
      `)
      .bind(...params, limit + 1)
      .all<{ created_at: string }>();

    const results = rows.results || [];
    const hasMore = results.length > limit;
    const activity = hasMore ? results.slice(0, limit) : results;
    const nextCursor = hasMore ? activity[activity.length - 1].created_at : null;

    return c.json({ activity, nextCursor });
  } catch (error) {
    console.error('Error fetching activity feed:', error);
    return c.json({ error: 'Failed to fetch activity feed' }, 500);
  }
});

/**
 * GET /activity/actors
 * Distinct actor emails across both feeds, for the activity page's actor
 * filter dropdown. Derived server-side rather than from the loaded page so
 * the dropdown lists everyone, not just whoever appears in the last 50 rows.
 */
app.get('/activity/actors', async (c) => {
  try {
    const rows = await c.env.DB
      .prepare(`
        SELECT DISTINCT actor_email FROM (
          SELECT actor_email FROM activity_log
          UNION
          SELECT user_email AS actor_email FROM collaboration_history
        )
        ORDER BY actor_email ASC
        LIMIT 200
      `)
      .all<{ actor_email: string }>();

    return c.json({ actors: (rows.results || []).map((r) => r.actor_email) });
  } catch (error) {
    console.error('Error fetching activity actors:', error);
    return c.json({ error: 'Failed to fetch activity actors' }, 500);
  }
});

export default app;
