import { Hono } from 'hono';
import type { Env, User } from '../../types';
import { requireAdmin } from '../../auth';
import { logActivity } from '../../activityLog';
import { getClusterData, applyClusteringResults, countUnclusteredFaces, getLegacyFaceStats, resetLegacyFaces, mergeClusters, assignPhotosToPerson, resetAllClusters, resetSingleCluster, learnFromManualTags, getUnattachedPhotos, resetFacesForFacelessTaggedPhotos } from '../../faceClustering';
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
 * REMOVED (2026-08-06) — moved to GET /api/me/face-embedding-model (see apps/worker/src/routes/me.ts's
 * doc comment). This route lived under the admin-only /admin/people/* group, but the model is
 * fetched by the CLIENT for EVERY upload's face detection (faceDetectionQueue.ts runs for any
 * authenticated uploader, not just global admins), so gating it behind `requireAdmin` silently
 * broke face detection for every non-admin collaborator's uploads (the resulting 403 was
 * swallowed by faceDetection.ts's best-effort try/catch, so nothing ever surfaced it).
 */

/**
 * GET /people/unattached-photos
 *
 * Paginated list of photos with NO person attached at all (see getUnattachedPhotos()'s doc
 * comment in faceClustering.ts) — powers the People admin page's "Unattached photos" view, which
 * lets an admin browse/bulk-select these otherwise-easy-to-miss photos and assign them to a
 * person directly (reusing POST /people/:personId/photos, the same "Assign to this person"
 * action already used elsewhere). Cursor-paginated by capture_time, same shape as GET
 * /api/timeline (`?cursor=`/`?limit=`, response's `nextCursor` is null once exhausted).
 */
app.get('/unattached-photos', async (c) => {
  try {
    const cursor = c.req.query('cursor') || null;
    const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 300);
    const result = await getUnattachedPhotos(c.env, cursor, limit);
    return c.json(result);
  } catch (error) {
    console.error('Error fetching unattached photos:', error);
    return c.json({ error: 'Failed to fetch unattached photos' }, 500);
  }
});

/**
 * GET /people
 * List all named + unnamed person clusters with a cover photo + face count.
 * Clusters with only 1 face are hidden by default (mostly noise/one-offs)
 * unless ?includeSingles=1 is passed.
 *
 * ?namedOnly=1 instead returns every NAMED person regardless of face_count (including ones with
 * 0 automatically-detected faces, e.g. a person who so far only exists via manual photo tags) —
 * used by the "Tag people" picker on PhotoDetail, which only ever wants to offer named people
 * (tagging an anonymous, un-reviewed cluster wouldn't mean anything to the person doing the
 * tagging) and needs the complete list, not just ones with enough auto-detected faces to matter
 * for clustering QA.
 */
app.get('/', async (c) => {
  try {
    if (c.req.query('namedOnly') === '1') {
      const people = await c.env.DB
        .prepare(`
          SELECT id, name, face_count
          FROM person_clusters
          WHERE name IS NOT NULL
          ORDER BY name COLLATE NOCASE
        `)
        .all();
      return c.json({ people: people.results || [] });
    }

    const includeSingles = c.req.query('includeSingles') === '1';
    const minFaces = includeSingles ? 1 : 2;

    // `pc.face_count` is a running COUNT of photo_faces ROWS assigned to this person — used
    // internally as the weight for centroid averaging (see mergeClusters()/assignPhotosToPerson()
    // in faceClustering.ts), NOT a count of distinct photos. It can legitimately exceed the real
    // photo count (the same person detected twice in one photo counts twice) and never includes
    // manually-tagged photos (photo_person_tags) at all — both caused the admin-visible "X
    // photos" figure here to disagree with what the person's detail page actually shows. computed
    // `photo_count` below is the real, DISTINCT-photo figure (auto-detected ∪ manually tagged),
    // matching exactly what GET /people/:personId returns, and is what the UI now displays.
    const people = await c.env.DB
      .prepare(`
        SELECT pc.id, pc.name, pc.face_count, pc.created_at, pc.updated_at,
               pc.cover_photo_id, pc.linked_user_email,
               u.name as linked_user_name,
               p.file_type as cover_file_type, p.cache_version as cover_cache_version,
               e.slug as cover_event_slug,
               (
                 SELECT COUNT(*) FROM (
                   SELECT photo_id FROM photo_faces WHERE person_id = pc.id
                   UNION
                   SELECT photo_id FROM photo_person_tags WHERE person_id = pc.id
                 )
               ) as photo_count
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
 * Returns the person's details plus every photo containing their face OR manual tag (see
 * photo_count's doc comment above for why both sources must be combined).
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
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.deleted_at IS NULL
          AND p.id IN (
            SELECT photo_id FROM photo_faces WHERE person_id = ?
            UNION
            SELECT photo_id FROM photo_person_tags WHERE person_id = ?
          )
        ORDER BY p.capture_time DESC
      `)
      .bind(personId, personId)
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

    const changed: string[] = [];
    if (name !== undefined && name !== null) changed.push('name');
    if (coverPhotoId !== undefined && coverPhotoId !== null) changed.push('cover');
    if (linkedUserEmail !== undefined) changed.push(linkedUserEmail ? 'account_linked' : 'account_unlinked');

    await logActivity(c.env, {
      actorEmail: c.get('user')?.email || 'unknown',
      action: 'person_update',
      targetType: 'person',
      targetId: String(personId),
      metadata: { name: name ?? undefined, changed },
    });

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

    await logActivity(c.env, {
      actorEmail: c.get('user')?.email || 'unknown',
      action: 'person_merge',
      targetType: 'person',
      targetId: String(targetPersonId),
      metadata: { mergedCount: sourcePersonIds.length, facesMoved },
    });

    return c.json({ success: true, facesMoved });
  } catch (error) {
    console.error('Error merging people:', error);
    return c.json({ error: 'Failed to merge people' }, 500);
  }
});

/**
 * POST /people/learn-from-tags
 * See learnFromManualTags()'s doc comment in faceClustering.ts — lets manual photo tagging
 * (photo_person_tags) directly improve future automatic clustering by assigning any now-
 * unambiguous still-unclustered detected face to the person a photo was manually tagged with,
 * without requiring a full "Rebuild All (Deep)" pass. Safe to run repeatedly (a no-op once no
 * qualifying tag/face pairs remain).
 */
app.post('/learn-from-tags', async (c) => {
  try {
    const result = await learnFromManualTags(c.env);
    return c.json({ success: true, ...result });
  } catch (error) {
    console.error('Error learning from manual tags:', error);
    return c.json({ error: 'Failed to learn from manual tags' }, 500);
  }
});

/**
 * POST /people/rescan-faceless-tagged-photos
 * See resetFacesForFacelessTaggedPhotos()'s doc comment in faceClustering.ts — resets
 * `faces_processed_at` for manually-tagged photos that were scanned but found zero faces (an
 * older backfill-quality bug meant these may have been checked against a downscaled preview
 * rather than the full original), so the next "Scan Library for Faces" pass re-detects them
 * with the fixed, full-resolution logic. Safe to run repeatedly.
 */
app.post('/rescan-faceless-tagged-photos', async (c) => {
  try {
    const result = await resetFacesForFacelessTaggedPhotos(c.env);
    return c.json({ success: true, ...result });
  } catch (error) {
    console.error('Error resetting faceless tagged photos:', error);
    return c.json({ error: 'Failed to reset faceless tagged photos' }, 500);
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

    // Capture the name first — it's gone after the delete, and "deleted a
    // person" without one is useless in the feed.
    const person = await c.env.DB
      .prepare('SELECT name FROM person_clusters WHERE id = ?')
      .bind(personId)
      .first<{ name: string | null }>();

    await c.env.DB.prepare('DELETE FROM person_clusters WHERE id = ?').bind(personId).run();

    await logActivity(c.env, {
      actorEmail: c.get('user')?.email || 'unknown',
      action: 'person_delete',
      targetType: 'person',
      targetId: String(personId),
      metadata: { name: person?.name ?? undefined },
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting person:', error);
    return c.json({ error: 'Failed to delete person' }, 500);
  }
});

/**
 * POST /people/:personId/reset-cluster
 * Unassigns this person's auto-detected faces (photo_faces) and clears its centroid/face_count,
 * WITHOUT deleting the person record itself — the name, linked account, and cover photo are all
 * kept, so future automatic clustering re-accumulates under the same identity instead of
 * starting over as an unnamed cluster. See resetSingleCluster()'s doc comment in
 * faceClustering.ts for how this differs from the destructive DELETE above.
 */
app.post('/:personId/reset-cluster', async (c) => {
  try {
    const personId = parseInt(c.req.param('personId'), 10);
    if (!Number.isFinite(personId)) {
      return c.json({ error: 'Invalid person ID' }, 400);
    }

    const result = await resetSingleCluster(c.env, personId);
    return c.json({ success: true, ...result });
  } catch (error) {
    console.error('Error resetting person cluster:', error);
    return c.json({ error: 'Failed to reset person cluster' }, 500);
  }
});

export default app;
