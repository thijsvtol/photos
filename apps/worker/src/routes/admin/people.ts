import { Hono } from 'hono';
import type { Env, User } from '../../types';
import { requireAdmin } from '../../auth';
import { getClusterData, applyClusteringResults, countUnclusteredFaces, getLegacyFaceStats, resetLegacyFaces, mergeClusters, assignPhotosToPerson, resetAllClusters } from '../../faceClustering';
import type { ClusterResult } from '../../faceClustering';

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// People/face clusters are populated by the admin-triggered client-side clustering pass (see
// apps/web/src/faceClusteringClient.ts — the vector-similarity math runs in the browser, not
// here, since Cloudflare Workers' 10ms-per-request CPU limit can never safely fit an operation
// whose cost scales with an ever-growing library; see faceClustering.ts's doc comment for the
// full history). This route module only ever does cheap I/O. Admin-only, same pattern as
// tags/albums.
app.use('/*', requireAdmin);

/**
 * GET /people/cluster-data
 *
 * Returns ONE PAGE of the raw data the browser needs to run a full clustering pass or merge-
 * suggestions scan itself: unclustered faces + person cluster centroids. Cursor-paginated
 * (`?afterClusterId=`/`?afterFaceId=`, both id-based/exclusive) — a single call converting/
 * serializing an UNBOUNDED number of rows is itself real, library-size-scaling CPU work (BLOB
 * -> array conversion + JSON encoding), independent of any vector-similarity math, and can
 * alone exceed the Workers Free plan's 10ms CPU-time limit for a large library — see
 * faceClustering.ts's `PAGE_SIZE` doc comment for the full explanation. The response's
 * `nextClusterCursor`/`nextFaceCursor` (null once exhausted) tell the caller (see
 * apps/web/src/api.ts's `getFullClusterData()`) whether to fetch another page. Pass
 * `?includeFaces=0` to skip the (potentially large) unclustered-faces array/pagination entirely
 * when only cluster centroids are needed (e.g. the merge-suggestions scan).
 */
app.get('/cluster-data', async (c) => {
  try {
    const includeFaces = c.req.query('includeFaces') !== '0';
    const afterClusterId = parseInt(c.req.query('afterClusterId') || '0', 10) || 0;
    const afterFaceId = parseInt(c.req.query('afterFaceId') || '0', 10) || 0;
    const unclusteredOnly = c.req.query('unclusteredOnly') !== '0';
    const data = await getClusterData(c.env, includeFaces, afterClusterId, afterFaceId, unclusteredOnly);
    return c.json(data);
  } catch (error) {
    console.error('Error fetching cluster data:', error);
    return c.json({ error: 'Failed to fetch cluster data' }, 500);
  }
});

/**
 * POST /people/apply-clustering
 *
 * Persists a batch of clustering results the browser already computed client-side (see
 * apps/web/src/faceClusteringClient.ts and AdminPeople.tsx's "Cluster Now" button) — pure I/O
 * (INSERT/UPDATE), no vector math, so this is safe regardless of how many faces/clusters were
 * involved in the client's computation.
 */
app.post('/apply-clustering', async (c) => {
  try {
    const { results } = await c.req.json<{ results: ClusterResult[] }>();
    if (!Array.isArray(results)) {
      return c.json({ error: 'results array is required' }, 400);
    }

    const { facesAssigned, rejected } = await applyClusteringResults(c.env, results);
    const remaining = await countUnclusteredFaces(c.env);
    return c.json({ facesAssigned, remaining, rejected });
  } catch (error) {
    console.error('Error applying clustering results:', error);
    return c.json({ error: 'Failed to apply clustering results' }, 500);
  }
});

/**
 * GET /people/legacy-face-stats
 *
 * Counts how many photo_faces/person_clusters rows still use the legacy pre-2026-08
 * face-api.js embedding format (128-dim) instead of the current @vladmandic/human format
 * (1024-dim) — see getLegacyFaceStats()'s doc comment in faceClustering.ts for why this
 * silently breaks clustering/merge-suggestion matches for anyone whose photos predate the
 * model switch. Surfaced on the People admin page as a one-time "fix outdated face data"
 * prompt when either count is nonzero.
 */
app.get('/legacy-face-stats', async (c) => {
  try {
    const stats = await getLegacyFaceStats(c.env);
    return c.json(stats);
  } catch (error) {
    console.error('Error fetching legacy face stats:', error);
    return c.json({ error: 'Failed to fetch legacy face stats' }, 500);
  }
});

/**
 * POST /people/reset-legacy-faces
 *
 * One-time repair: deletes every legacy-dimension photo_faces/person_clusters row (they can't
 * be "fixed" in place — the old embedding is simply the wrong shape) and resets
 * `faces_processed_at` on affected photos so the next "Scan Library for Faces" backfill
 * re-detects them under the current model. See resetLegacyFaces()'s doc comment in
 * faceClustering.ts for full details. Safe to call repeatedly (no-op once clean).
 */
app.post('/reset-legacy-faces', async (c) => {
  try {
    const result = await resetLegacyFaces(c.env);
    return c.json(result);
  } catch (error) {
    console.error('Error resetting legacy faces:', error);
    return c.json({ error: 'Failed to reset legacy faces' }, 500);
  }
});

/**
 * POST /people/reset-clusters
 *
 * Unassigns every face from its person and deletes every person cluster, in preparation for a
 * full "Rebuild All (Deep)" reclustering pass (see resetAllClusters()'s doc comment in
 * faceClustering.ts). Raw photo_faces.embedding rows are never touched — fully recoverable by
 * reclustering again, nothing is permanently lost. Destructive but idempotent/safe to call
 * repeatedly (a no-op once already reset).
 */
app.post('/reset-clusters', async (c) => {
  try {
    const result = await resetAllClusters(c.env);
    return c.json(result);
  } catch (error) {
    console.error('Error resetting clusters:', error);
    return c.json({ error: 'Failed to reset clusters' }, 500);
  }
});

/**
 * GET /people/embedding-model
 *
 * Streams the face-recognition ONNX model (ArcFace ResNet100, int8-quantized, ~63MB) used
 * client-side by apps/web/src/faceEmbeddingOnnx.ts to compute proper face-recognition
 * embeddings (replacing @vladmandic/human's general-purpose FaceRes descriptor, which wasn't
 * trained to discriminate between different identities — see repo memory / faceClusteringClient.ts's
 * top-of-file doc comment for the full saga this was ultimately needed to fix). Hosted in R2
 * (not as a Cloudflare Pages static asset) because a single Pages asset is capped at 25MiB —
 * see this app's photo-storage architecture for the same reasoning. Long, immutable cache
 * headers since the model file at this key never changes without a deploy (a version bump would
 * use a new R2 key, not overwrite this one, to avoid ever serving a half-cached mixed version).
 * Admin-only (same as every other /admin/people/* route) purely because it's only ever needed
 * by the admin-only People page — not because the model itself is sensitive.
 */
app.get('/embedding-model', async (c) => {
  try {
    const object = await c.env.PHOTOS_BUCKET.get('models/arcface-r100-int8.onnx');
    if (!object) {
      return c.json({ error: 'Model not found' }, 404);
    }
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(object.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error fetching embedding model:', error);
    return c.json({ error: 'Failed to fetch embedding model' }, 500);
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
 * Merge one or more source clusters into a target cluster (e.g. the clustering algorithm split
 * the same person into two groups, or an admin recognizes two people are actually one). Moves
 * every face to the target and deletes the source clusters. The target's centroid is
 * recomputed as a face_count-weighted average of all merged centroids (see mergeClusters()'s
 * doc comment in faceClustering.ts) so this manual correction "teaches" the target person's
 * centroid, benefiting future automatic clustering passes too.
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

    const { facesMoved } = await mergeClusters(c.env, targetPersonId, sourcePersonIds);
    return c.json({ success: true, facesMoved });
  } catch (error) {
    console.error('Error merging people:', error);
    return c.json({ error: 'Failed to merge people' }, 500);
  }
});

/**
 * POST /people/:personId/photos
 *
 * Manually assigns EVERY detected face on the given photos to this person — used when an admin
 * corrects a mistake (a photo was never clustered, or landed under the wrong person) via an
 * "Assign to this person" action in the People admin UI. "The model should learn from that":
 * the person's centroid is updated to incorporate each newly assigned face's real embedding
 * (see assignPhotosToPerson()'s doc comment in faceClustering.ts for the exact drift-safe
 * formula), so the correction improves future automatic clustering too, not just this one photo.
 */
app.post('/:personId/photos', async (c) => {
  try {
    const personId = parseInt(c.req.param('personId'), 10);
    if (!Number.isFinite(personId)) {
      return c.json({ error: 'Invalid person ID' }, 400);
    }

    const { photoIds } = await c.req.json<{ photoIds: string[] }>();
    if (!Array.isArray(photoIds) || photoIds.length === 0 || !photoIds.every((id) => typeof id === 'string')) {
      return c.json({ error: 'photoIds must be a non-empty array of strings' }, 400);
    }

    const { assigned, skipped } = await assignPhotosToPerson(c.env, personId, photoIds);
    return c.json({ assigned, skipped });
  } catch (error) {
    console.error('Error assigning photos to person:', error);
    return c.json({ error: 'Failed to assign photos to person' }, 500);
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
