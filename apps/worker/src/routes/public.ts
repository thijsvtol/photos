import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Event, Photo } from '../types';
import { hasEventSessionAccess } from '../cookies';
import { optionalAuth, getUser, isAdmin, getCollaboratorRoleByEventId } from '../auth';
import { cosineSimilarity, embedSearchQuery } from '../aiEnrichment';

const app = new Hono<{ Bindings: Env }>();

// Validate slug format (alphanumeric + hyphens only)
const isValidSlug = (slug: string): boolean => /^[a-z0-9][a-z0-9\-]*[a-z0-9]$|^[a-z0-9]$/.test(slug);

// A photo's small watermarked preview is uploaded client-side as a
// progressive enhancement *after* the original finishes (see
// uploadManager.ts). Normally this only takes a few seconds, but if that
// second upload step never completes — a transient network error, retries
// exhausted, or the tab/app being closed before it finishes — the original
// photo (which uploaded successfully) must not stay hidden forever. Once
// the original has been sitting long enough that any in-flight preview
// upload would realistically have finished, fall back to showing the photo
// even without a preview; media.ts already falls back to serving the
// original file when no preview exists in R2.
const PREVIEW_GRACE_MINUTES = 10;
const PREVIEW_READY_CLAUSE =
  `(p.preview_complete = 1 OR p.uploaded_at <= datetime('now', '-${PREVIEW_GRACE_MINUTES} minutes'))`;

// CORS configuration for same-origin requests
app.use('/*', cors({
  origin: '*',
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Access'],
}));

/**
 * GET /api/events
 * Returns list of events filtered by visibility and any active event password session:
 * - Public events: visible to everyone
 * - Private events: visible only to admins
 * - Collaborators-only events: visible to admins and collaborators
 * - Password-protected events: only shown after the matching event password is entered
 */
app.get('/api/events', optionalAuth, async (c) => {
  try {
    const user = getUser(c);
    const userIsAdmin = isAdmin(c);
    const userEmail = user?.email || '';

    // Build query with visibility filtering
    // Use GROUP BY to deduplicate (LEFT JOIN can produce duplicates) while preserving ORDER BY
    const query = `
      SELECT 
        e.id, 
        e.slug, 
        e.name, 
        e.inferred_date, 
        e.created_at, 
        e.visibility,
        (e.password_hash IS NOT NULL) as requires_password,
        (SELECT MAX(p.uploaded_at) FROM photos p WHERE p.event_id = e.id) as latest_upload
      FROM events e
      LEFT JOIN event_collaborators ec ON e.id = ec.event_id AND ec.user_email = ?
      WHERE 
        e.visibility = 'public'
        OR (? = 1)
        OR (e.visibility = 'collaborators_only' AND ec.user_email IS NOT NULL)
        OR (e.visibility = 'private' AND ? = 1)
      GROUP BY e.id
      ORDER BY e.inferred_date IS NULL ASC, e.inferred_date DESC, e.created_at DESC
    `;
    
    const events = await c.env.DB
      .prepare(query)
      .bind(userEmail, userIsAdmin ? 1 : 0, userIsAdmin ? 1 : 0)
      .all<Omit<Event, 'password_salt' | 'password_hash'>>();
    
    // Filter password-protected events that user hasn't authenticated to
    const visibleEvents: typeof events.results = [];
    for (const event of (events.results || [])) {
      if (
        (event as { requires_password?: boolean }).requires_password
        && event.visibility === 'public'
        && !userIsAdmin
      ) {
        const hasPasswordSession = await hasEventSessionAccess(c.req.raw, event.slug, c.env.EVENT_COOKIE_SECRET);
        if (!hasPasswordSession) {
          continue;
        }
      }
      visibleEvents.push(event);
    }

    if (visibleEvents.length === 0) {
      return c.json({ events: [] });
    }

    // Batch fetch preview photos, cities, and tags in 3 queries instead of 3N
    const eventIds = visibleEvents.map(e => e.id);
    const placeholders = eventIds.map(() => '?').join(',');

    // Batch: preview photo IDs (first featured or earliest photo per event)
    // Use a window function approach compatible with D1/SQLite
    const previewsResult = await c.env.DB
      .prepare(`
        SELECT event_id, id as photo_id FROM (
          SELECT id, event_id, 
            ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY is_featured DESC, capture_time ASC) as rn
          FROM photos
          WHERE event_id IN (${placeholders}) AND deleted_at IS NULL
        ) WHERE rn = 1
      `)
      .bind(...eventIds)
      .all<{ event_id: number; photo_id: string }>();

    // Batch: cities per event
    const citiesResult = await c.env.DB
      .prepare(`
        SELECT event_id, city FROM photos 
        WHERE event_id IN (${placeholders}) AND city IS NOT NULL AND deleted_at IS NULL
        GROUP BY event_id, city ORDER BY city ASC
      `)
      .bind(...eventIds)
      .all<{ event_id: number; city: string }>();

    // Batch: tags per event
    const tagsResult = await c.env.DB
      .prepare(`
        SELECT et.event_id, t.id, t.name, t.slug FROM tags t
        JOIN event_tags et ON t.id = et.tag_id
        WHERE et.event_id IN (${placeholders})
      `)
      .bind(...eventIds)
      .all<{ event_id: number; id: number; name: string; slug: string }>();

    // Build lookup maps
    const previewMap = new Map<number, string>();
    for (const r of (previewsResult.results || [])) {
      previewMap.set(r.event_id, r.photo_id);
    }

    const citiesMap = new Map<number, string[]>();
    for (const r of (citiesResult.results || [])) {
      if (!citiesMap.has(r.event_id)) citiesMap.set(r.event_id, []);
      citiesMap.get(r.event_id)!.push(r.city);
    }

    const tagsMap = new Map<number, Array<{ id: number; name: string; slug: string }>>();
    for (const r of (tagsResult.results || [])) {
      if (!tagsMap.has(r.event_id)) tagsMap.set(r.event_id, []);
      tagsMap.get(r.event_id)!.push({ id: r.id, name: r.name, slug: r.slug });
    }

    // Assemble final response
    const eventsWithPreviews = visibleEvents.map(event => ({
      ...event,
      preview_photo_id: previewMap.get(event.id as number) || null,
      cities: citiesMap.get(event.id as number) || [],
      tags: tagsMap.get(event.id as number) || [],
    }));
    
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
  const slug = c.req.param('slug')!;
  if (!isValidSlug(slug)) return c.json({ error: 'Invalid slug format' }, 400);
  
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
      // Return 401 if not logged in, 403 if logged in but not authorized
      const statusCode = user ? 403 : 401;
      const message = user ? 'Access forbidden' : 'Authentication required';
      return c.json({ error: message }, statusCode);
    }
    
    if (event.visibility === 'collaborators_only' && !userIsAdmin) {
      // Check if user is a collaborator (case-insensitive — email casing can
      // differ between how a collaborator was invited and how they log in,
      // and a mismatch must not cause a spurious 403 when viewing their event).
      const collaboratorRole = await getCollaboratorRoleByEventId(c.env.DB, event.id, userEmail);
      
      if (!collaboratorRole) {
        // Return 401 if not logged in, 403 if logged in but not authorized
        const statusCode = user ? 403 : 401;
        const message = user ? 'Access forbidden' : 'Authentication required';
        return c.json({ error: message }, statusCode);
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
  const slug = c.req.param('slug')!;
  if (!isValidSlug(slug)) return c.json({ error: 'Invalid slug format' }, 400);
  const sort = c.req.query('sort') || 'date_desc';
  
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
      // Return 401 if not logged in, 403 if logged in but not authorized
      const statusCode = user ? 403 : 401;
      const message = user ? 'Access forbidden' : 'Authentication required';
      return c.json({ error: message }, statusCode);
    }
    
    if (event.visibility === 'collaborators_only' && !userIsAdmin) {
      // Check if user is a collaborator (case-insensitive — email casing can
      // differ between how a collaborator was invited and how they log in,
      // and a mismatch must not cause a spurious 403 when viewing their event).
      const collaboratorRole = await getCollaboratorRoleByEventId(c.env.DB, event.id, userEmail);
      
      if (!collaboratorRole) {
        // Return 401 if not logged in, 403 if logged in but not authorized
        const statusCode = user ? 403 : 401;
        const message = user ? 'Access forbidden' : 'Authentication required';
        return c.json({ error: message }, statusCode);
      }
    }
    
    // Check authentication only if password protected
    if (event.password_hash) {
      const isAuthenticated = await hasEventSessionAccess(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
      if (!isAuthenticated) {
        return c.json({ error: 'Authentication required' }, 401);
      }
    }
    
    // Build query with uploader display name (user name fallback to email)
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
    
    // uploader_name must never leak a collaborator's raw email address to
    // anonymous viewers of a public event: prefer their display name, and
    // only fall back to the local part of the email (before '@') — never
    // the full address. Also covers legacy rows where uploaded_by stored a
    // first name instead of an email (no '@', so the CASE falls through as-is).
    const query = `
      SELECT p.*, COALESCE(
        u.name,
        CASE WHEN instr(p.uploaded_by, '@') > 0
          THEN substr(p.uploaded_by, 1, instr(p.uploaded_by, '@') - 1)
          ELSE p.uploaded_by
        END
      ) as uploader_name
      FROM photos p
      LEFT JOIN users u ON p.uploaded_by = u.email
      WHERE p.event_id = ? AND p.upload_complete = 1 AND p.deleted_at IS NULL AND ${PREVIEW_READY_CLAUSE}
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
  const slug = c.req.param('slug')!;
  if (!isValidSlug(slug)) return c.json({ error: 'Invalid slug format' }, 400);
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
      // Return 401 if not logged in, 403 if logged in but not authorized
      const statusCode = user ? 403 : 401;
      const message = user ? 'Access forbidden' : 'Authentication required';
      return c.json({ error: message }, statusCode);
    }
    
    if (event.visibility === 'collaborators_only' && !userIsAdmin) {
      // Check if user is a collaborator (case-insensitive — email casing can
      // differ between how a collaborator was invited and how they log in,
      // and a mismatch must not cause a spurious 403 when viewing their event).
      const collaboratorRole = await getCollaboratorRoleByEventId(c.env.DB, event.id, userEmail);
      
      if (!collaboratorRole) {
        // Return 401 if not logged in, 403 if logged in but not authorized
        const statusCode = user ? 403 : 401;
        const message = user ? 'Access forbidden' : 'Authentication required';
        return c.json({ error: message }, statusCode);
      }
    }
    
    // Check authentication only if password protected
    if (event.password_hash) {
      const isAuthenticated = await hasEventSessionAccess(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
      if (!isAuthenticated) {
        return c.json({ error: 'Authentication required' }, 401);
      }
    }
    
    // Get photo with uploader display name (see the analogous query above for
    // why the fallback never exposes a raw email address).
    const photo = await c.env.DB
      .prepare(`
        SELECT p.*, COALESCE(
          u.name,
          CASE WHEN instr(p.uploaded_by, '@') > 0
            THEN substr(p.uploaded_by, 1, instr(p.uploaded_by, '@') - 1)
            ELSE p.uploaded_by
          END
        ) as uploader_name
        FROM photos p
        LEFT JOIN users u ON p.uploaded_by = u.email
        WHERE p.id = ? AND p.event_id = ? AND p.upload_complete = 1 AND p.deleted_at IS NULL AND ${PREVIEW_READY_CLAUSE}
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
 * GET /api/map/photos
 * Returns all photos with GPS coordinates from events the caller can access:
 * public events (anonymous or logged-in), plus — when authenticated — events
 * the user owns/collaborates on or, for admins, every event regardless of
 * visibility. Mirrors the access-control pattern used by /api/timeline so
 * logged-in collaborators see the same events on the map as everywhere else.
 * Minimal fields for fast map rendering.
 */
app.get('/api/map/photos', optionalAuth, async (c) => {
  try {
    const user = getUser(c);
    const userIsAdmin = isAdmin(c);
    const userEmail = user?.email || '';

    const results = await c.env.DB
      .prepare(`
        SELECT 
          p.id,
          p.latitude,
          p.longitude,
          p.original_filename,
          p.blur_placeholder,
          p.cache_version,
          p.file_type,
          e.slug as event_slug,
          e.name as event_name
        FROM photos p
        JOIN events e ON p.event_id = e.id
        LEFT JOIN event_collaborators ec ON e.id = ec.event_id AND ec.user_email = ?
        WHERE p.latitude IS NOT NULL 
          AND p.longitude IS NOT NULL
          AND p.deleted_at IS NULL
          AND LOWER(e.name) NOT LIKE '[prive]%'
          AND LOWER(e.name) NOT LIKE '[hidden]%'
          AND (
            (e.visibility = 'public' AND e.password_hash IS NULL)
            OR (? = 1)
            OR (e.visibility = 'collaborators_only' AND ec.user_email IS NOT NULL)
          )
        ORDER BY p.capture_time DESC
      `)
      .bind(userEmail, userIsAdmin ? 1 : 0)
      .all();

    // Anonymous/public results are cacheable across users; authenticated
    // responses can include private data and must not be shared via a
    // shared/public cache.
    const cacheControl = user
      ? 'private, max-age=60'
      : 'public, max-age=300, s-maxage=600';

    return c.json({ photos: results.results || [] }, 200, {
      'Cache-Control': cacheControl,
    });
  } catch (error) {
    console.error('Error fetching map photos:', error);
    return c.json({ error: 'Failed to fetch map photos' }, 500);
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
 * GET /api/timeline
 * Returns photos across all visible events in chronological order (newest first).
 * Supports pagination via cursor (capture_time of last photo).
 * Each photo includes its event slug and name for navigation.
 */
app.get('/api/timeline', optionalAuth, async (c) => {
  try {
    const user = getUser(c);
    const userIsAdmin = isAdmin(c);
    const userEmail = user?.email || '';
    const limit = Math.min(parseInt(c.req.query('limit') || '200', 10), 500);
    const cursor = c.req.query('cursor') || null; // capture_time cursor

    // Get IDs of events the user can access
    const eventsQuery = `
      SELECT DISTINCT e.id, e.slug, e.name
      FROM events e
      LEFT JOIN event_collaborators ec ON e.id = ec.event_id AND ec.user_email = ?
      WHERE
        e.visibility = 'public'
        OR (? = 1)
        OR (e.visibility = 'collaborators_only' AND ec.user_email IS NOT NULL)
    `;
    const events = await c.env.DB
      .prepare(eventsQuery)
      .bind(userEmail, userIsAdmin ? 1 : 0)
      .all<{ id: number; slug: string; name: string }>();

    if (!events.results || events.results.length === 0) {
      return c.json({ photos: [], nextCursor: null });
    }

    const eventIds = events.results.map(e => e.id);
    const placeholders = eventIds.map(() => '?').join(',');

    // Build event lookup
    const eventMap = new Map<number, { slug: string; name: string }>();
    for (const e of events.results) {
      eventMap.set(e.id, { slug: e.slug, name: e.name });
    }

    let photosQuery: string;
    let bindings: (string | number)[];

    if (cursor) {
      photosQuery = `
        SELECT p.id, p.event_id, p.original_filename, p.file_type, p.capture_time,
               p.uploaded_at, p.width, p.height, p.city, p.favorites_count,
               p.blur_placeholder, p.is_featured, p.cache_version,
               p.latitude, p.longitude
        FROM photos p
        WHERE p.event_id IN (${placeholders})
          AND p.upload_complete = 1
          AND p.deleted_at IS NULL
          AND p.archived_at IS NULL
          AND ${PREVIEW_READY_CLAUSE}
          AND p.capture_time < ?
        ORDER BY p.capture_time DESC
        LIMIT ?
      `;
      bindings = [...eventIds, cursor, limit + 1];
    } else {
      photosQuery = `
        SELECT p.id, p.event_id, p.original_filename, p.file_type, p.capture_time,
               p.uploaded_at, p.width, p.height, p.city, p.favorites_count,
               p.blur_placeholder, p.is_featured, p.cache_version,
               p.latitude, p.longitude
        FROM photos p
        WHERE p.event_id IN (${placeholders})
          AND p.upload_complete = 1
          AND p.deleted_at IS NULL
          AND p.archived_at IS NULL
          AND ${PREVIEW_READY_CLAUSE}
        ORDER BY p.capture_time DESC
        LIMIT ?
      `;
      bindings = [...eventIds, limit + 1];
    }

    const result = await c.env.DB
      .prepare(photosQuery)
      .bind(...bindings)
      .all<Photo & { event_id: number }>();

    const photos = (result.results || []).slice(0, limit);
    const hasMore = (result.results || []).length > limit;
    const nextCursor = hasMore && photos.length > 0 ? photos[photos.length - 1].capture_time : null;

    // Attach event slug/name to each photo
    const enriched = photos.map(p => ({
      ...p,
      event_slug: eventMap.get(p.event_id)?.slug || '',
      event_name: eventMap.get(p.event_id)?.name || '',
    }));

    return c.json({ photos: enriched, nextCursor });
  } catch (error) {
    console.error('Error fetching timeline:', error);
    return c.json({ error: 'Failed to fetch timeline' }, 500);
  }
});

/**
 * GET /api/memories
 * "On this day" — photos captured on today's month/day in a previous year,
 * across every event the caller can access (same access-control pattern as
 * /api/timeline). Grouped by year, most recent past year first. Trashed and
 * archived photos are excluded. Pure SQL (strftime), no AI/ML involved.
 */
app.get('/api/memories', optionalAuth, async (c) => {
  try {
    const user = getUser(c);
    const userIsAdmin = isAdmin(c);
    const userEmail = user?.email || '';
    const maxPerYear = Math.min(parseInt(c.req.query('perYear') || '6', 10), 20);

    const eventsQuery = `
      SELECT DISTINCT e.id, e.slug, e.name
      FROM events e
      LEFT JOIN event_collaborators ec ON e.id = ec.event_id AND ec.user_email = ?
      WHERE
        e.visibility = 'public'
        OR (? = 1)
        OR (e.visibility = 'collaborators_only' AND ec.user_email IS NOT NULL)
    `;
    const events = await c.env.DB
      .prepare(eventsQuery)
      .bind(userEmail, userIsAdmin ? 1 : 0)
      .all<{ id: number; slug: string; name: string }>();

    if (!events.results || events.results.length === 0) {
      return c.json({ years: [] });
    }

    const eventIds = events.results.map(e => e.id);
    const placeholders = eventIds.map(() => '?').join(',');
    const eventMap = new Map<number, { slug: string; name: string }>();
    for (const e of events.results) {
      eventMap.set(e.id, { slug: e.slug, name: e.name });
    }

    const result = await c.env.DB
      .prepare(`
        SELECT p.id, p.event_id, p.original_filename, p.file_type, p.capture_time,
               p.width, p.height, p.blur_placeholder, p.cache_version,
               CAST(strftime('%Y', p.capture_time) AS INTEGER) as capture_year
        FROM photos p
        WHERE p.event_id IN (${placeholders})
          AND p.upload_complete = 1
          AND p.deleted_at IS NULL
          AND p.archived_at IS NULL
          AND ${PREVIEW_READY_CLAUSE}
          AND strftime('%m-%d', p.capture_time) = strftime('%m-%d', 'now')
          AND strftime('%Y', p.capture_time) < strftime('%Y', 'now')
        ORDER BY p.capture_time DESC
      `)
      .bind(...eventIds)
      .all<Photo & { event_id: number; capture_year: number }>();

    const byYear = new Map<number, Array<Photo & { event_slug: string; event_name: string }>>();
    for (const photo of (result.results || [])) {
      const list = byYear.get(photo.capture_year) || [];
      if (list.length < maxPerYear) {
        list.push({
          ...photo,
          event_slug: eventMap.get(photo.event_id)?.slug || '',
          event_name: eventMap.get(photo.event_id)?.name || '',
        });
        byYear.set(photo.capture_year, list);
      }
    }

    const years = Array.from(byYear.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([year, photos]) => ({ year, photos }));

    return c.json({ years });
  } catch (error) {
    console.error('Error fetching memories:', error);
    return c.json({ error: 'Failed to fetch memories' }, 500);
  }
});

/**
 * GET /api/search?q=...
 * Unified search across every event the caller can access: matches
 * filename/city (FTS5, instant, always available) plus AI-generated
 * caption/tags text (also indexed in the same FTS5 table). If a Workers AI
 * binding is configured and the query is long enough to be meaningful as a
 * sentence, results are re-ranked by cosine similarity between the query's
 * embedding and each candidate photo's stored embedding — a lightweight
 * "semantic search" layer with no extra infrastructure (brute-force
 * similarity over a modest FTS-prefiltered candidate set, fine at
 * personal/family-gallery scale — see repo cost-governance notes for why
 * this avoids Vectorize/paid vector DBs).
 */
app.get('/api/search', optionalAuth, async (c) => {
  try {
    const query = (c.req.query('q') || '').trim();
    if (!query) {
      return c.json({ photos: [] });
    }

    const user = getUser(c);
    const userIsAdmin = isAdmin(c);
    const userEmail = user?.email || '';
    const limit = Math.min(parseInt(c.req.query('limit') || '60', 10), 200);

    const eventsQuery = `
      SELECT DISTINCT e.id, e.slug, e.name
      FROM events e
      LEFT JOIN event_collaborators ec ON e.id = ec.event_id AND ec.user_email = ?
      WHERE
        e.visibility = 'public'
        OR (? = 1)
        OR (e.visibility = 'collaborators_only' AND ec.user_email IS NOT NULL)
    `;
    const events = await c.env.DB
      .prepare(eventsQuery)
      .bind(userEmail, userIsAdmin ? 1 : 0)
      .all<{ id: number; slug: string; name: string }>();

    if (!events.results || events.results.length === 0) {
      return c.json({ photos: [] });
    }

    const eventIds = events.results.map(e => e.id);
    const placeholders = eventIds.map(() => '?').join(',');
    const eventMap = new Map<number, { slug: string; name: string }>();
    for (const e of events.results) {
      eventMap.set(e.id, { slug: e.slug, name: e.name });
    }

    // FTS5 full-text match against filename/caption/tags/city. Each term is
    // wrapped in double quotes (with any embedded quotes stripped first) so
    // it is always treated as a literal phrase/prefix token, never parsed as
    // FTS5 query syntax (AND/OR/NOT, "column:value" filters, parentheses,
    // NEAR, etc.) — a bound parameter to MATCH is still parsed as an FTS5
    // query expression by SQLite, so an unescaped user query could otherwise
    // throw a syntax error (turning into a 500) or behave in unintended ways.
    const ftsQuery = query
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term.replace(/"/g, '')}"*`)
      .join(' ');

    let candidateRows: (Photo & { event_id: number; embedding: ArrayBuffer | null })[] = [];
    if (ftsQuery) {
      const result = await c.env.DB
        .prepare(`
          SELECT p.id, p.event_id, p.original_filename, p.file_type, p.capture_time,
                 p.width, p.height, p.blur_placeholder, p.cache_version, p.ai_caption,
                 p.embedding
          FROM photos_fts f
          JOIN photos p ON p.rowid = f.rowid
          WHERE photos_fts MATCH ?
            AND p.event_id IN (${placeholders})
            AND p.upload_complete = 1
            AND p.deleted_at IS NULL
          ORDER BY p.capture_time DESC
          LIMIT 300
        `)
        .bind(ftsQuery, ...eventIds)
        .all<Photo & { event_id: number; embedding: ArrayBuffer | null }>();
      candidateRows = result.results || [];
    }

    // Optional semantic re-rank: only meaningful for longer, sentence-like
    // queries (a single short keyword is already well served by FTS above),
    // and only when there's at least one FTS candidate to actually re-rank —
    // this endpoint is public/unauthenticated, and each embedding call costs
    // Workers AI neurons (free allocation: 10,000/day), so it must never be
    // called for queries that produced zero matches (e.g. abusive/garbage
    // input designed to burn through the daily budget).
    const queryEmbedding = candidateRows.length > 0 && query.split(/\s+/).length >= 2
      ? await embedSearchQuery(c.env, query)
      : null;

    let ranked = candidateRows;
    if (queryEmbedding) {
      ranked = [...candidateRows].sort((a, b) => {
        const simA = a.embedding ? cosineSimilarity(queryEmbedding, new Float32Array(a.embedding as ArrayBuffer)) : -1;
        const simB = b.embedding ? cosineSimilarity(queryEmbedding, new Float32Array(b.embedding as ArrayBuffer)) : -1;
        return simB - simA;
      });
    }

    const photos = ranked.slice(0, limit).map(({ embedding: _embedding, ...photo }) => ({
      ...photo,
      event_slug: eventMap.get(photo.event_id)?.slug || '',
      event_name: eventMap.get(photo.event_id)?.name || '',
    }));

    return c.json({ photos });
  } catch (error) {
    console.error('Error searching photos:', error);
    return c.json({ error: 'Failed to search photos' }, 500);
  }
});

export default app;
