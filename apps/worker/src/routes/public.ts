import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Event, Photo } from '../types';
import { hasEventSessionAccess } from '../cookies';
import { optionalAuth, getUser, isAdmin, getCollaboratorRoleByEventId } from '../auth';
import { cosineSimilarity, embedSearchQuery } from '../aiEnrichment';
import { getPhotoPeople } from '../faceClustering';

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

// GET /api/search's FTS branch fetches candidates WITHOUT an `event_id IN (...)` clause (access
// filtering happens afterward in JS against `eventMap` — see that route's doc comment for why:
// combining an FTS MATCH param with a large accessible-event-id list can exceed D1's 100-bound-
// parameter limit for anyone with many accessible events). Since some fraction of these
// candidates may get discarded afterward for belonging to an event the requester can't see, the
// raw fetch limit is set higher than the old flat `LIMIT 300` (which assumed every fetched row
// was already access-filtered) so a private/inaccessible event's matches can't silently starve
// out the requester's own accessible results.
const FTS_CANDIDATE_LIMIT = 1000;

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
 * Supports query params: sort (date_asc, date_desc, uploaded_desc, name_asc, name_desc), people (comma-
 * separated person_clusters ids — requires the photo to contain EVERY given person, same AND
 * semantics and same auto-detected-∪-manually-tagged union as GET /api/search's `people` param).
 */
app.get('/api/events/:slug/photos', optionalAuth, async (c) => {
  const slug = c.req.param('slug')!;
  if (!isValidSlug(slug)) return c.json({ error: 'Invalid slug format' }, 400);
  const sort = c.req.query('sort') || 'date_desc';
  const peopleParam = (c.req.query('people') || '').trim();
  const personIds = peopleParam
    ? [...new Set(peopleParam.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n)))]
    : [];
  
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
      case 'uploaded_desc':
        orderBy = 'p.uploaded_at DESC';
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
    const peopleFilterClause = personIds.length > 0
      ? `AND p.id IN (
          SELECT photo_id FROM (
            SELECT photo_id, person_id FROM photo_faces WHERE person_id IN (${personIds.map(() => '?').join(',')})
            UNION
            SELECT photo_id, person_id FROM photo_person_tags WHERE person_id IN (${personIds.map(() => '?').join(',')})
          )
          GROUP BY photo_id
          HAVING COUNT(DISTINCT person_id) = ?
        )`
      : '';

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
      ${peopleFilterClause}
      ORDER BY ${orderBy}
    `;

    const bindArgs: (string | number)[] = [event.id];
    if (personIds.length > 0) {
      bindArgs.push(...personIds, ...personIds, personIds.length);
    }

    const photos = await c.env.DB
      .prepare(query)
      .bind(...bindArgs)
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
  const photoId = c.req.param('photoId')!;
  
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
    
    // Named people tagged on this photo (automatic face detection + manual admin tags — see
    // getPhotoPeople()'s doc comment in faceClustering.ts). Fetched as a second query rather
    // than a JOIN/GROUP_CONCAT in the query above since a photo can have any number of tagged
    // people and .first<Photo>() only ever returns one row.
    photo.people = await getPhotoPeople(c.env, photoId);

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
 * GET /api/people/named
 * Lightweight list of every NAMED person (id + name only) for the public Search page's people
 * filter — deliberately public/unauthenticated (unlike /admin/people, which is admin-gated and
 * returns much more, e.g. face_count/linked accounts/cover photos): this app's only use of a
 * person's name elsewhere is as admin-only detail-page/edit data, but the filter itself is a
 * normal visitor-facing feature (like filtering by tag or city), so exposing just the name list
 * (not who they're linked to, not their face data) here is intentional and safe for anyone to
 * see and use, matching the request that this filter "was meant for everyone".
 *
 * Restricted to people the requester could plausibly "know" — i.e. who appear (via an
 * auto-detected face OR a manual tag) in at least one photo in an event the requester actually
 * has access to (public events, always; private events, admins only; collaborators_only events,
 * only if the requester is a collaborator on that specific event). Without this, the filter
 * would leak the mere EXISTENCE/name of people who only ever appear in someone's private or
 * collaborators-only album to any anonymous visitor, regardless of whether they could ever see
 * a single photo of them — the same access boundary already enforced on the search results
 * themselves (see the `people` param handling in GET /api/search below) needs to apply here
 * too, or the filter picker itself becomes the leak. Admins see everyone, matching how they see
 * every event regardless of visibility.
 */
app.get('/api/people/named', optionalAuth, async (c) => {
  try {
    const user = getUser(c);
    const userIsAdmin = isAdmin(c);
    const userEmail = user?.email || '';

    const people = await c.env.DB
      .prepare(`
        SELECT DISTINCT pc.id, pc.name
        FROM person_clusters pc
        WHERE pc.name IS NOT NULL
          AND (
            ? = 1
            OR EXISTS (
              SELECT 1
              FROM (
                SELECT photo_id FROM photo_faces WHERE person_id = pc.id
                UNION
                SELECT photo_id FROM photo_person_tags WHERE person_id = pc.id
              ) pp
              JOIN photos p ON p.id = pp.photo_id
              JOIN events e ON e.id = p.event_id
              LEFT JOIN event_collaborators ec ON e.id = ec.event_id AND ec.user_email = ?
              WHERE p.deleted_at IS NULL
                AND (
                  e.visibility = 'public'
                  OR (e.visibility = 'collaborators_only' AND ec.user_email IS NOT NULL)
                )
            )
          )
        ORDER BY pc.name COLLATE NOCASE
      `)
      .bind(userIsAdmin ? 1 : 0, userEmail)
      .all<{ id: number; name: string }>();
    return c.json({ people: people.results || [] });
  } catch (error) {
    console.error('Error fetching named people:', error);
    return c.json({ error: 'Failed to fetch named people' }, 500);
  }
});

/**
 * GET /api/search?q=...&people=1,2,3
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
 *
 * `people` is an optional comma-separated list of person_clusters ids (see
 * apps/admin/people). Photos are required to contain EVERY given person, not
 * just any of them (an admin picking 2 people almost always means "show me
 * the photos of the two of them together", not "either of them") — combines
 * BOTH ways a person can be attached to a photo (automatically-detected
 * photo_faces AND manual photo_person_tags, same union used elsewhere in
 * this feature, e.g. getPhotoPeople() in faceClustering.ts) since either
 * alone would miss real matches. `q` and `people` can be combined (both
 * filters apply) or `people` can be used alone with no text query.
 */
app.get('/api/search', optionalAuth, async (c) => {
  try {
    const query = (c.req.query('q') || '').trim();
    const peopleParam = (c.req.query('people') || '').trim();
    const personIds = peopleParam
      ? [...new Set(peopleParam.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n)))]
      : [];

    if (!query && personIds.length === 0) {
      return c.json({ photos: [] });
    }

    const user = getUser(c);
    const userIsAdmin = isAdmin(c);
    const userEmail = user?.email || '';
    // Default/max result count — raised from 60/200 (2026-08-06) after a person with ~1000
    // photos in the library was silently truncated to 200 results with no indication anything
    // was cut off. People-only filtering (no `q`) is a simple id-set lookup, not full-text
    // search relevance ranking, so there's no meaningful "top N most relevant" concept to cap
    // tightly on — the whole point is showing every photo of that person.
    const limit = Math.min(parseInt(c.req.query('limit') || '60', 10), 2000);

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

    const eventMap = new Map<number, { slug: string; name: string }>();
    for (const e of events.results) {
      eventMap.set(e.id, { slug: e.slug, name: e.name });
    }

    // Resolve the people filter to a concrete set of photo ids FIRST (before FTS/embedding
    // work below) — a photo must contain every given person (AND, not OR), found by unioning
    // photo_faces + photo_person_tags per person then requiring COUNT(DISTINCT person_id) to
    // equal the number of people asked for.
    let peopleFilteredPhotoIds: Set<string> | null = null;
    if (personIds.length > 0) {
      const personPlaceholders = personIds.map(() => '?').join(',');
      const matchRows = await c.env.DB
        .prepare(`
          SELECT photo_id FROM (
            SELECT photo_id, person_id FROM photo_faces WHERE person_id IN (${personPlaceholders})
            UNION
            SELECT photo_id, person_id FROM photo_person_tags WHERE person_id IN (${personPlaceholders})
          )
          GROUP BY photo_id
          HAVING COUNT(DISTINCT person_id) = ?
        `)
        .bind(...personIds, ...personIds, personIds.length)
        .all<{ photo_id: string }>();
      peopleFilteredPhotoIds = new Set((matchRows.results || []).map((r) => r.photo_id));
      if (peopleFilteredPhotoIds.size === 0) {
        return c.json({ photos: [] });
      }
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
    // Set when the FTS branch's own internal LIMIT (FTS_CANDIDATE_LIMIT) was hit, so `hasMore`
    // below can still report truncation even in the (rare) case where post-filter results end up
    // under the final `limit` param despite more matches existing above the raw fetch cap.
    let ftsCandidateLimitHit = false;
    if (ftsQuery) {
      // Event-access filtering is done in JS against `eventMap` (built from `eventIds`) AFTER
      // the query, rather than cramming `p.event_id IN (${placeholders})` into the same FTS
      // statement — combining an FTS MATCH param with a large `eventIds` IN() list can exceed
      // D1's 100-bound-parameter limit for anyone with a large event list (e.g. an admin who
      // can see every event), the exact same class of bug already fixed below for the
      // people-only path. LIMIT 300 is deliberately generous here since filtering happens
      // afterward — see FTS_CANDIDATE_LIMIT's doc comment.
      const result = await c.env.DB
        .prepare(`
          SELECT p.id, p.event_id, p.original_filename, p.file_type, p.capture_time,
                 p.width, p.height, p.blur_placeholder, p.cache_version, p.ai_caption,
                 p.embedding
          FROM photos_fts f
          JOIN photos p ON p.rowid = f.rowid
          WHERE photos_fts MATCH ?
            AND p.upload_complete = 1
            AND p.deleted_at IS NULL
          ORDER BY p.capture_time DESC
          LIMIT ${FTS_CANDIDATE_LIMIT}
        `)
        .bind(ftsQuery)
        .all<Photo & { event_id: number; embedding: ArrayBuffer | null }>();
      ftsCandidateLimitHit = (result.results || []).length >= FTS_CANDIDATE_LIMIT;
      candidateRows = (result.results || []).filter((p) => eventMap.has(p.event_id));
      if (peopleFilteredPhotoIds) {
        candidateRows = candidateRows.filter((p) => peopleFilteredPhotoIds!.has(p.id));
      }
    } else if (peopleFilteredPhotoIds) {
      // People-only search (no text query) — pull candidates directly, restricted to the
      // people-filtered photo id set. Chunked (D1 caps bound parameters per statement at 100)
      // since a frequently-photographed person can easily appear in more photos than fit in one
      // IN(). Event-access filtering is done in JS against `eventMap` (built from `eventIds`)
      // AFTER the query, rather than also cramming `p.event_id IN (${placeholders})` into the
      // same statement — combining both IN() clauses in one call used to intermittently exceed
      // D1's 100-bound-parameter limit for anyone with a large event list (e.g. an admin, who
      // can see every event: 37 events + an 80-photo chunk = 117 params, well over the limit),
      // throwing a genuine D1 error that the outer try/catch turned into a 500 — which the
      // frontend then silently rendered as "no results" instead of surfacing the real failure.
      // Confirmed via production data: person 8141 has 319 photos (4 chunks of up to 80), and
      // an admin session (37 total events) reliably hit this on at least one chunk.
      const idsArray = Array.from(peopleFilteredPhotoIds);
      const PHOTO_ID_CHUNK_SIZE = 90;
      for (let i = 0; i < idsArray.length; i += PHOTO_ID_CHUNK_SIZE) {
        const idChunk = idsArray.slice(i, i + PHOTO_ID_CHUNK_SIZE);
        const idPlaceholders = idChunk.map(() => '?').join(',');
        const result = await c.env.DB
          .prepare(`
            SELECT p.id, p.event_id, p.original_filename, p.file_type, p.capture_time,
                   p.width, p.height, p.blur_placeholder, p.cache_version, p.ai_caption,
                   p.embedding
            FROM photos p
            WHERE p.id IN (${idPlaceholders})
              AND p.upload_complete = 1
              AND p.deleted_at IS NULL
          `)
          .bind(...idChunk)
          .all<Photo & { event_id: number; embedding: ArrayBuffer | null }>();
        for (const row of result.results || []) {
          if (eventMap.has(row.event_id)) candidateRows.push(row);
        }
      }
      candidateRows.sort((a, b) => (a.capture_time < b.capture_time ? 1 : -1));
      // No artificial cap here (unlike the FTS branch's LIMIT 300, which exists for text-search
      // relevance/cost reasons) — this is a plain id-set lookup already bounded by however many
      // photos actually match every selected person, and the whole point of a people filter is
      // to show ALL of them, not an arbitrarily truncated "top 300". The final response size is
      // still bounded by `limit` below (now up to 2000, see its own doc comment).
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

    // `hasMore` tells the frontend whether `ranked` actually had more candidates than `limit`
    // could return, so it can show a "showing first N results" notice instead of silently
    // truncating with zero indication anything was cut off (previously a person with more
    // photos than the cap allowed would just see a flat, unexplained N-result list).
    const hasMore = ranked.length > limit || ftsCandidateLimitHit;

    return c.json({ photos, hasMore });
  } catch (error) {
    console.error('Error searching photos:', error);
    return c.json({ error: 'Failed to search photos' }, 500);
  }
});

export default app;
