import { Hono } from 'hono';
import type { Env, User } from '../../types';
import { requireAdmin } from '../../auth';
import { runFaceClustering, countUnclusteredFaces, findMergeSuggestions } from '../../faceClustering';
import type { MergeSuggestionCursor } from '../../faceClustering';

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// People/face clusters are populated by the hourly runFaceClustering cron
// (see apps/worker/src/faceClustering.ts) from faces detected client-side at
// upload time (apps/web/src/faceDetection.ts). Admin-only management, same
// pattern as tags/albums.
app.use('/*', requireAdmin);

/**
 * POST /people/cluster-now
 *
 * Manually runs one CPU-cheap clustering batch right away instead of waiting for the hourly
 * cron. Exists because right after a large "Scan Library for Faces" backfill (see
 * faceBackfill.ts), the backlog of unclustered faces can be much bigger than one batch clears
 * — without this, newly-detected faces would only trickle into visible person clusters over
 * many hours, making the People page look empty/broken even though detection itself already
 * succeeded. Each call processes only a small, CPU-budget-adaptive batch (see faceClustering.ts
 * — Cloudflare's Workers Free plan hard-caps CPU time at 10ms per request, so this endpoint
 * canNOT just loop internally until the backlog is drained; the client-side "Cluster Now"
 * button in AdminPeople.tsx is what loops, calling this repeatedly until `remaining` reaches 0).
 */
app.post('/cluster-now', async (c) => {
  try {
    const { processed } = await runFaceClustering(c.env);
    const remaining = await countUnclusteredFaces(c.env);
    return c.json({ processed, remaining });
  } catch (error) {
    console.error('Error running face clustering:', error);
    return c.json({ error: 'Failed to run face clustering' }, 500);
  }
});

/**
 * GET /people/merge-suggestions
 *
 * One bounded step of a resumable, full pairwise scan across every person cluster, looking for
 * pairs that likely represent the same real person but were never merged by clustering itself
 * (see findMergeSuggestions()'s doc comment in faceClustering.ts for why that can happen even
 * though clustering is working correctly). Pass `sourceId`/`candidateId` (both from a previous
 * response's `nextCursor`) to resume a scan in progress; omit both to start a fresh scan from
 * the beginning. The client-side "Find Merge Suggestions" button in AdminPeople.tsx loops this
 * the same way "Cluster Now" loops POST /cluster-now, accumulating suggestions until
 * `nextCursor` comes back null.
 */
app.get('/merge-suggestions', async (c) => {
  try {
    const sourceIdParam = c.req.query('sourceId');
    const candidateIdParam = c.req.query('candidateId');
    let cursor: MergeSuggestionCursor | null = null;
    if (sourceIdParam !== undefined && candidateIdParam !== undefined) {
      const sourceId = parseInt(sourceIdParam, 10);
      const candidateId = parseInt(candidateIdParam, 10);
      if (Number.isFinite(sourceId) && Number.isFinite(candidateId)) {
        cursor = { sourceId, candidateId };
      }
    }

    const result = await findMergeSuggestions(c.env, cursor);
    return c.json(result);
  } catch (error) {
    console.error('Error finding merge suggestions:', error);
    return c.json({ error: 'Failed to find merge suggestions' }, 500);
  }
});

/**
 * GET /people
 * List all named + unnamed person clusters with a cover photo + face count.
 * Clusters with only 1 face are hidden by default (mostly noise/one-offs)
 * unless ?includeSingles=1 is passed.
 */
app.get('/', async (c) => {
  try {
    const includeSingles = c.req.query('includeSingles') === '1';
    const minFaces = includeSingles ? 1 : 2;

    const people = await c.env.DB
      .prepare(`
        SELECT pc.id, pc.name, pc.face_count, pc.created_at, pc.updated_at,
               pc.cover_photo_id, pc.linked_user_email,
               u.name as linked_user_name,
               p.file_type as cover_file_type, p.cache_version as cover_cache_version,
               e.slug as cover_event_slug
        FROM person_clusters pc
        LEFT JOIN photos p ON pc.cover_photo_id = p.id
        LEFT JOIN events e ON p.event_id = e.id
        LEFT JOIN users u ON pc.linked_user_email = u.email
        WHERE pc.face_count >= ?
        ORDER BY (pc.name IS NULL), pc.face_count DESC
      `)
      .bind(minFaces)
      .all();

    return c.json({ people: people.results || [] });
  } catch (error) {
    console.error('Error fetching people:', error);
    return c.json({ error: 'Failed to fetch people' }, 500);
  }
});

/**
 * GET /people/:personId
 * Returns the person's details plus every photo containing their face.
 */
app.get('/:personId', async (c) => {
  try {
    const personId = parseInt(c.req.param('personId'), 10);
    if (!Number.isFinite(personId)) {
      return c.json({ error: 'Invalid person ID' }, 400);
    }

    const person = await c.env.DB
      .prepare(`
        SELECT pc.*, u.name as linked_user_name
        FROM person_clusters pc
        LEFT JOIN users u ON pc.linked_user_email = u.email
        WHERE pc.id = ?
      `)
      .bind(personId)
      .first();
    if (!person) {
      return c.json({ error: 'Person not found' }, 404);
    }

    const photos = await c.env.DB
      .prepare(`
        SELECT DISTINCT p.id, p.original_filename, p.file_type, p.capture_time, p.blur_placeholder,
               p.cache_version, p.width, p.height, e.slug as event_slug, e.name as event_name
        FROM photo_faces f
        JOIN photos p ON f.photo_id = p.id
        JOIN events e ON p.event_id = e.id
        WHERE f.person_id = ? AND p.deleted_at IS NULL
        ORDER BY p.capture_time DESC
      `)
      .bind(personId)
      .all();

    return c.json({ person, photos: photos.results || [] });
  } catch (error) {
    console.error('Error fetching person:', error);
    return c.json({ error: 'Failed to fetch person' }, 500);
  }
});

/**
 * PUT /people/:personId
 * Rename a person / set their cover photo / link (or unlink) a user account.
 *
 * linkedUserEmail is handled separately from name/coverPhotoId (which use COALESCE to mean
 * "leave unchanged when omitted") because linking needs to distinguish three states: omitted
 * (leave as-is), a real email (link), and explicit null (unlink) — COALESCE can't represent
 * that last one, since COALESCE(null, existing) just keeps the existing value.
 */
app.put('/:personId', async (c) => {
  try {
    const personId = parseInt(c.req.param('personId'), 10);
    if (!Number.isFinite(personId)) {
      return c.json({ error: 'Invalid person ID' }, 400);
    }

    const body = await c.req.json<{ name?: string | null; coverPhotoId?: string | null; linkedUserEmail?: string | null }>();
    const { name, coverPhotoId } = body;

    const existing = await c.env.DB.prepare('SELECT id FROM person_clusters WHERE id = ?').bind(personId).first();
    if (!existing) {
      return c.json({ error: 'Person not found' }, 404);
    }

    let linkedUserEmail: string | null | undefined = undefined;
    if ('linkedUserEmail' in body) {
      const raw = body.linkedUserEmail;
      if (!raw) {
        linkedUserEmail = null; // Explicit unlink (null, undefined, or empty string).
      } else {
        const candidate = raw.trim();
        const user = await c.env.DB
          .prepare('SELECT email FROM users WHERE LOWER(email) = LOWER(?)')
          .bind(candidate)
          .first<{ email: string }>();
        if (!user) {
          return c.json({ error: 'No account found with that email' }, 400);
        }

        const alreadyLinked = await c.env.DB
          .prepare('SELECT id FROM person_clusters WHERE LOWER(linked_user_email) = LOWER(?) AND id != ?')
          .bind(user.email, personId)
          .first();
        if (alreadyLinked) {
          return c.json({ error: 'That account is already linked to another person' }, 409);
        }

        linkedUserEmail = user.email; // Canonical casing from the users table.
      }
    }

    if (linkedUserEmail !== undefined) {
      await c.env.DB
        .prepare(`
          UPDATE person_clusters SET
            name = COALESCE(?, name),
            cover_photo_id = COALESCE(?, cover_photo_id),
            linked_user_email = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `)
        .bind(name ?? null, coverPhotoId ?? null, linkedUserEmail, personId)
        .run();
    } else {
      await c.env.DB
        .prepare(`
          UPDATE person_clusters SET
            name = COALESCE(?, name),
            cover_photo_id = COALESCE(?, cover_photo_id),
            updated_at = datetime('now')
          WHERE id = ?
        `)
        .bind(name ?? null, coverPhotoId ?? null, personId)
        .run();
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error updating person:', error);
    return c.json({ error: 'Failed to update person' }, 500);
  }
});

/**
 * POST /people/merge
 * Merge one or more source clusters into a target cluster (e.g. the
 * clustering algorithm split the same person into two groups). Reassigns
 * every face to the target and deletes the source clusters.
 */
app.post('/merge', async (c) => {
  try {
    const { targetPersonId, sourcePersonIds } = await c.req.json<{
      targetPersonId: number;
      sourcePersonIds: number[];
    }>();

    if (!Number.isFinite(targetPersonId) || !Array.isArray(sourcePersonIds) || sourcePersonIds.length === 0) {
      return c.json({ error: 'targetPersonId and a non-empty sourcePersonIds array are required' }, 400);
    }

    const idsToMerge = sourcePersonIds.filter((id) => id !== targetPersonId);
    if (idsToMerge.length === 0) {
      return c.json({ error: 'No valid source clusters to merge' }, 400);
    }

    const placeholders = idsToMerge.map(() => '?').join(',');
    await c.env.DB
      .prepare(`UPDATE photo_faces SET person_id = ? WHERE person_id IN (${placeholders})`)
      .bind(targetPersonId, ...idsToMerge)
      .run();

    const countRow = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM photo_faces WHERE person_id = ?')
      .bind(targetPersonId)
      .first<{ count: number }>();

    await c.env.DB
      .prepare("UPDATE person_clusters SET face_count = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(countRow?.count || 0, targetPersonId)
      .run();

    await c.env.DB.prepare(`DELETE FROM person_clusters WHERE id IN (${placeholders})`).bind(...idsToMerge).run();

    return c.json({ success: true });
  } catch (error) {
    console.error('Error merging people:', error);
    return c.json({ error: 'Failed to merge people' }, 500);
  }
});

/**
 * DELETE /people/:personId
 * Deletes a person cluster (e.g. a false-positive grouping). Faces are
 * unassigned (person_id set NULL via FK ON DELETE SET NULL) so they can be
 * re-clustered by a future run rather than being lost.
 */
app.delete('/:personId', async (c) => {
  try {
    const personId = parseInt(c.req.param('personId'), 10);
    if (!Number.isFinite(personId)) {
      return c.json({ error: 'Invalid person ID' }, 400);
    }

    await c.env.DB.prepare('DELETE FROM person_clusters WHERE id = ?').bind(personId).run();
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting person:', error);
    return c.json({ error: 'Failed to delete person' }, 500);
  }
});

export default app;
