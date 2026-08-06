import { Hono, Context } from 'hono';
import { ulid } from 'ulid';
import type { Env, User } from '../../types';
import { extractUser, hasEventCapabilityByEventId, isUserAdmin } from '../../auth';
import { permanentlyDeletePhotos } from '../../photoDeletion';
import { logActivity } from '../../activityLog';
import { isValidFaceInput } from '../../faceValidation';
import { setManualPhotoPersonTags, getPhotoPeople, addManualPhotoPersonTags, removePersonFromPhoto, syncPeopleAcrossDuplicates } from '../../faceClustering';
import { MAX_SQL_IN_CHUNK, chunkArray } from '../../utils';

// Soft-deleted photos are kept this long before the nightly purge cron
// (see scheduled.ts runTrashPurge) hard-deletes them from R2 + D1.
export const TRASH_RETENTION_DAYS = 30;

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 120;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(
  operation: () => Promise<T>,
  label: string,
  attempts = RETRY_ATTEMPTS
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        break;
      }

      const delayMs = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(`${label} failed (attempt ${attempt}/${attempts}), retrying in ${delayMs}ms`, error);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function requireEventCapabilityById(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  eventId: number,
  capability: 'image_edit' | 'photo_delete' | 'bulk_delete' | 'feature_photo',
  errorMessage: string
) {
  const user = await extractUser(c);
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  c.set('user', user);

  if (isUserAdmin(user, c.env.ADMIN_EMAILS || '')) {
    return null;
  }

  const allowed = await hasEventCapabilityByEventId(c.env.DB, eventId, user.email, capability);
  if (!allowed) {
    return c.json({ error: errorMessage }, 403);
  }

  return null;
}

/**
 * GET /photos/faces-pending
 * Returns a batch of photos that have not yet been checked for faces
 * (`faces_processed_at IS NULL`). Used to gradually BACKFILL the People
 * feature onto photos uploaded before it existed — face detection itself
 * must run client-side (Workers AI has no face-embedding model), so this
 * endpoint only enumerates work; the actual detection happens in the
 * browser (see apps/web/src/faceBackfill.ts) which then POSTs results to
 * POST /photos/:photoId/faces below. Admin-only, since it scans across
 * every event (unlike the per-event upload-time faces endpoint in
 * routes/admin/uploads.ts).
 */
app.get('/faces-pending', async (c) => {
  try {
    const limit = Math.min(parseInt(c.req.query('limit') || '10', 10), 50);

    const rows = await c.env.DB
      .prepare(`
        SELECT p.id, p.file_type, p.cache_version, e.slug as event_slug
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.faces_processed_at IS NULL
          AND p.upload_complete = 1
          AND p.deleted_at IS NULL
          AND p.file_type != 'video/mp4'
          AND p.file_type NOT LIKE 'raw/%'
        ORDER BY p.uploaded_at ASC
        LIMIT ?
      `)
      .bind(limit)
      .all<{ id: string; file_type: string; cache_version: number; event_slug: string }>();

    const remainingRow = await c.env.DB
      .prepare(`
        SELECT COUNT(*) as count FROM photos
        WHERE faces_processed_at IS NULL AND upload_complete = 1 AND deleted_at IS NULL
          AND file_type != 'video/mp4' AND file_type NOT LIKE 'raw/%'
      `)
      .first<{ count: number }>();

    return c.json({ photos: rows.results || [], remaining: remainingRow?.count || 0 });
  } catch (error) {
    console.error('Error fetching faces-pending photos:', error);
    return c.json({ error: 'Failed to fetch faces-pending photos' }, 500);
  }
});

/**
 * POST /photos/:photoId/faces
 * Admin-triggered counterpart to POST /admin/events/:slug/uploads/:photoId/faces
 * (routes/admin/uploads.ts), used specifically for BACKFILLING photos that
 * predate the People feature (see GET /photos/faces-pending above). Stores
 * client-detected faces and marks the photo as checked either way.
 */
app.post('/:photoId/faces', async (c) => {
  const photoId = c.req.param('photoId');

  try {
    const photo = await c.env.DB.prepare('SELECT id FROM photos WHERE id = ?').bind(photoId).first<{ id: string }>();
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const { faces } = await c.req.json<{
      faces: Array<{ embedding: number[]; bbox: { x: number; y: number; width: number; height: number } }>;
    }>();

    if (!Array.isArray(faces)) {
      return c.json({ error: 'faces array is required' }, 400);
    }
    if (faces.length > 50) {
      return c.json({ error: 'Cannot report more than 50 faces per photo' }, 400);
    }
    if (!faces.every(isValidFaceInput)) {
      return c.json({ error: 'Each face requires a 128-number embedding and a numeric bbox' }, 400);
    }

    await c.env.DB.prepare('DELETE FROM photo_faces WHERE photo_id = ?').bind(photoId).run();

    if (faces.length > 0) {
      const statements = faces.map((face) => {
        const embeddingBlob = new Float32Array(face.embedding).buffer;
        return c.env.DB
          .prepare(`
            INSERT INTO photo_faces (photo_id, embedding, bbox_x, bbox_y, bbox_width, bbox_height)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .bind(photoId, embeddingBlob, face.bbox.x, face.bbox.y, face.bbox.width, face.bbox.height);
      });
      await c.env.DB.batch(statements);
    }

    await c.env.DB.prepare("UPDATE photos SET faces_processed_at = datetime('now') WHERE id = ?").bind(photoId).run();

    return c.json({ success: true, count: faces.length });
  } catch (error) {
    console.error('Error saving backfilled photo faces:', error);
    return c.json({ error: 'Failed to save photo faces' }, 500);
  }
});

/**
 * GET /photos/missing-file-hash
 *
 * Paginated list of photos (images/RAW only — matching computeFileHash()'s own scope in
 * imageUtils.ts, which skips video to avoid reading large files fully into memory) that have no
 * `file_hash` yet, so the client can backfill it: download each original, hash it, then PATCH
 * the result back via PATCH /:photoId/file-hash. Two situations produce a NULL file_hash here:
 * (1) photos uploaded before the file_hash column/feature existed at all, and (2) — the bug
 * fixed 2026-08-06 — EVERY photo ever uploaded via the native Android app's background-sync
 * upload path (backgroundSync.ts), which never computed or sent a hash at all until that fix,
 * meaning `file_hash` was NULL for the vast majority of this app's production photos regardless
 * of age. Cursor-paginated by id (ULIDs sort lexicographically ≈ chronologically, but the exact
 * order doesn't matter here — this is just a stable, index-friendly pagination key).
 */
app.get('/missing-file-hash', async (c) => {
  try {
    const cursor = c.req.query('cursor') || null;
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);

    const cursorClause = cursor ? 'AND p.id > ?' : '';
    const bindings: (string | number)[] = cursor ? [cursor, limit + 1] : [limit + 1];

    const { results } = await c.env.DB
      .prepare(`
        SELECT p.id, p.file_type, p.cache_version, e.slug as event_slug
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.deleted_at IS NULL
          AND p.upload_complete = 1
          AND p.file_hash IS NULL
          AND p.file_type NOT IN ('video/mp4')
          ${cursorClause}
        ORDER BY p.id ASC
        LIMIT ?
      `)
      .bind(...bindings)
      .all<{ id: string; file_type: string; cache_version: number | null; event_slug: string }>();

    const rows = results || [];
    const photos = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const nextCursor = hasMore && photos.length > 0 ? photos[photos.length - 1].id : null;

    return c.json({ photos, nextCursor });
  } catch (error) {
    console.error('Error fetching photos missing file_hash:', error);
    return c.json({ error: 'Failed to fetch photos missing file_hash' }, 500);
  }
});

/**
 * PATCH /photos/:photoId/file-hash
 *
 * Sets a single photo's `file_hash`, computed client-side (see GET /missing-file-hash's doc
 * comment above) — used by the one-time "Backfill file hashes" admin action to retroactively
 * populate the column for photos uploaded before it existed, or before the background-sync
 * hashing bug was fixed. Never overwrites an already-set hash (WHERE guard), so this is safe to
 * re-run/retry without risking clobbering a legitimate value with a stale/incorrect one.
 */
app.patch('/:photoId/file-hash', async (c) => {
  try {
    const photoId = c.req.param('photoId');
    const { fileHash } = await c.req.json<{ fileHash?: string }>();
    if (!fileHash || typeof fileHash !== 'string') {
      return c.json({ error: 'fileHash is required' }, 400);
    }

    const result = await c.env.DB
      .prepare('UPDATE photos SET file_hash = ? WHERE id = ? AND file_hash IS NULL')
      .bind(fileHash, photoId)
      .run();

    return c.json({ success: true, updated: (result.meta.changes ?? 0) > 0 });
  } catch (error) {
    console.error('Error setting photo file_hash:', error);
    return c.json({ error: 'Failed to set photo file_hash' }, 500);
  }
});

/**
 * GET /photos/duplicates
 * Groups all non-trashed photos that share the same file_hash (exact-content
 * duplicates, computed client-side at upload time — see uploadManager.ts's
 * computeFileHash — and stored per-photo regardless of which event they were
 * uploaded to). Only groups with more than one photo are returned. Admin-only
 * (this route sits under /api/admin/photos, gated by requireAdmin).
 */
app.get('/duplicates', async (c) => {
  try {
    const rows = await c.env.DB
      .prepare(`
        SELECT p.id, p.file_hash, p.original_filename, p.file_type, p.capture_time,
               p.blur_placeholder, p.cache_version, p.width, p.height,
               e.slug as event_slug, e.name as event_name
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.deleted_at IS NULL
          AND p.file_hash IS NOT NULL
          AND p.file_hash IN (
            SELECT file_hash FROM photos
            WHERE deleted_at IS NULL AND file_hash IS NOT NULL
            GROUP BY file_hash
            HAVING COUNT(*) > 1
          )
        ORDER BY p.file_hash, p.capture_time ASC
      `)
      .all<{
        id: string; file_hash: string; original_filename: string; file_type: string;
        capture_time: string; blur_placeholder: string | null; cache_version: number;
        width: number | null; height: number | null; event_slug: string; event_name: string;
      }>();

    const groupsByHash = new Map<string, typeof rows.results>();
    for (const row of (rows.results || [])) {
      const list = groupsByHash.get(row.file_hash) || [];
      list.push(row);
      groupsByHash.set(row.file_hash, list);
    }

    const groups = Array.from(groupsByHash.entries()).map(([fileHash, photos]) => ({ fileHash, photos }));

    return c.json({ groups });
  } catch (error) {
    console.error('Error fetching duplicate photos:', error);
    return c.json({ error: 'Failed to fetch duplicate photos' }, 500);
  }
});

/**
 * POST /photos/duplicates/sync-people
 *
 * See syncPeopleAcrossDuplicates()'s doc comment in faceClustering.ts — copies people already
 * identified (via face detection or manual tag) on any photo to every OTHER exact-content
 * duplicate of it (same file_hash, regardless of which event each copy was uploaded to), so
 * tagging one copy doesn't have to be redone by hand for every other event it was also shared
 * into. Manual-tag-only (never touches photo_faces/centroids); safe to re-run repeatedly.
 */
app.post('/duplicates/sync-people', async (c) => {
  try {
    const result = await syncPeopleAcrossDuplicates(c.env);
    return c.json({ success: true, ...result });
  } catch (error) {
    console.error('Error syncing people across duplicates:', error);
    return c.json({ error: 'Failed to sync people across duplicates' }, 500);
  }
});

/**
 * PUT /photos/:photoId/people
 * Replaces the full set of manually-tagged people on a photo (see setManualPhotoPersonTags()'s
 * doc comment in faceClustering.ts — this never touches automatically-detected faces, only the
 * separate photo_person_tags table). Lets an admin/editor tag multiple people on a single photo
 * even when face detection missed someone (turned away, occluded, etc.) or grouped faces
 * imperfectly. Same permission level as image editing (`image_edit`), since this is a similar
 * "correct/annotate this photo" action.
 */
app.put('/:photoId/people', async (c) => {
  try {
    const photoId = c.req.param('photoId');

    const photo = await c.env.DB
      .prepare('SELECT event_id FROM photos WHERE id = ?')
      .bind(photoId)
      .first<{ event_id: number }>();

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const permissionError = await requireEventCapabilityById(
      c,
      photo.event_id,
      'image_edit',
      'Edit permission required for this event'
    );
    if (permissionError) return permissionError;

    const { personIds } = await c.req.json<{ personIds: number[] }>();
    if (!Array.isArray(personIds) || !personIds.every((id) => Number.isFinite(id))) {
      return c.json({ error: 'personIds must be an array of numbers' }, 400);
    }
    if (personIds.length > 50) {
      return c.json({ error: 'Cannot tag more than 50 people on a single photo' }, 400);
    }

    await setManualPhotoPersonTags(c.env, photoId, personIds);
    const people = await getPhotoPeople(c.env, photoId);

    await logActivity(c.env, {
      eventId: photo.event_id,
      actorEmail: c.get('user')?.email || 'unknown',
      action: 'person_tag_add',
      targetType: 'photo',
      targetId: photoId,
      metadata: { personCount: personIds.length },
    });

    return c.json({ success: true, people });
  } catch (error) {
    console.error('Error updating photo people tags:', error);
    return c.json({ error: 'Failed to update photo people tags' }, 500);
  }
});

/**
 * DELETE /photos/:photoId/people/:personId
 * Unattaches a single person from a single photo — see removePersonFromPhoto()'s doc comment
 * in faceClustering.ts for why this must undo BOTH a manual tag AND any automatically-detected
 * face assignment (getPhotoPeople() shows the union of the two, so removing only one would
 * leave the person still visibly attached). Same permission level as the other people-tagging
 * routes (`image_edit`).
 */
app.delete('/:photoId/people/:personId', async (c) => {
  try {
    const photoId = c.req.param('photoId');
    const personId = parseInt(c.req.param('personId'), 10);
    if (!Number.isFinite(personId)) {
      return c.json({ error: 'Invalid person ID' }, 400);
    }

    const photo = await c.env.DB
      .prepare('SELECT event_id FROM photos WHERE id = ?')
      .bind(photoId)
      .first<{ event_id: number }>();

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const permissionError = await requireEventCapabilityById(
      c,
      photo.event_id,
      'image_edit',
      'Edit permission required for this event'
    );
    if (permissionError) return permissionError;

    await removePersonFromPhoto(c.env, photoId, personId);
    const people = await getPhotoPeople(c.env, photoId);

    await logActivity(c.env, {
      eventId: photo.event_id,
      actorEmail: c.get('user')?.email || 'unknown',
      action: 'person_tag_remove',
      targetType: 'photo',
      targetId: photoId,
      metadata: { personId },
    });

    return c.json({ success: true, people });
  } catch (error) {
    console.error('Error removing person from photo:', error);
    return c.json({ error: 'Failed to remove person from photo' }, 500);
  }
});

/**
 * PUT /photos/:photoId/featured
 * Toggle featured status of a photo
 */
app.put('/:photoId/featured', async (c) => {
  try {
    const photoId = c.req.param('photoId');
    const { isFeatured } = await c.req.json<{ isFeatured: boolean }>();

    const photo = await c.env.DB
      .prepare('SELECT event_id FROM photos WHERE id = ?')
      .bind(photoId)
      .first<{ event_id: number }>();

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const permissionError = await requireEventCapabilityById(
      c,
      photo.event_id,
      'feature_photo',
      'Feature permission required for this event'
    );
    if (permissionError) return permissionError;
    
    await c.env.DB
      .prepare('UPDATE photos SET is_featured = ? WHERE id = ?')
      .bind(isFeatured ? 1 : 0, photoId)
      .run();

    await logActivity(c.env, {
      eventId: photo.event_id,
      actorEmail: c.get('user')?.email || 'unknown',
      action: 'photo_featured',
      targetType: 'photo',
      targetId: photoId,
      metadata: { featured: !!isFeatured },
    });

    return c.json({ success: true, is_featured: isFeatured });
  } catch (error) {
    console.error('Error updating featured status:', error);
    return c.json({ error: 'Failed to update featured status' }, 500);
  }
});

/**
 * PUT /photos/:photoId/replace
 * Replace a photo's original and preview images (admin-only, for image editing)
 */
app.put('/:photoId/replace', async (c) => {
  const photoId = c.req.param('photoId');

  try {
    // Get photo and event slug for R2 key construction
    const photo = await c.env.DB
      .prepare(`
        SELECT p.id, p.event_id, p.width, p.height, p.file_type, e.slug
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
      `)
      .bind(photoId)
      .first<{ id: string; event_id: number; width: number | null; height: number | null; file_type: string | null; slug: string }>();

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const permissionError = await requireEventCapabilityById(
      c,
      photo.event_id,
      'image_edit',
      'Edit permission required for this event'
    );
    if (permissionError) return permissionError;

    // Use the correct extension/content-type so edited videos land on the same
    // R2 keys the media routes read from (.mp4), not a stale .jpg key.
    const isVideo = photo.file_type === 'video/mp4';
    const extension = isVideo ? 'mp4' : 'jpg';
    const contentType = isVideo ? 'video/mp4' : 'image/jpeg';
    const originalKey = `original/${photo.slug}/${photo.id}.${extension}`;
    const previewKey = `preview/${photo.slug}/${photo.id}.${extension}`;

    const bumpCacheVersion = () =>
      c.env.DB
        .prepare('UPDATE photos SET cache_version = cache_version + 1 WHERE id = ?')
        .bind(photoId)
        .run();
    const deleteStaleIg = async () => {
      try {
        await c.env.PHOTOS_BUCKET.delete(`ig/${photo.slug}/${photo.id}.jpg`);
      } catch {
        // Ignore if ig version doesn't exist
      }
    };
    // Both the raw-body and legacy multipart paths end in a successful replace,
    // so log from one place rather than duplicating the call at each return.
    const logReplace = (target: string) =>
      logActivity(c.env, {
        eventId: photo.event_id,
        actorEmail: c.get('user')?.email || 'unknown',
        action: 'photo_replace',
        targetType: 'photo',
        targetId: photoId,
        metadata: { target },
      });

    const reqContentType = c.req.header('Content-Type') || '';

    // Raw-body path (?target=original|preview): the native Android WebView does
    // not reliably serialize multipart FormData with Blobs, so the app sends each
    // image as a raw application/octet-stream body — mirroring the chunked upload
    // flow that already works on native. Web uses the same path.
    if (!reqContentType.includes('multipart/form-data')) {
      const target = c.req.query('target');
      if (target !== 'original' && target !== 'preview') {
        return c.json({ error: 'Invalid or missing target (expected original|preview)' }, 400);
      }

      const body = await c.req.arrayBuffer();
      if (!body || body.byteLength === 0) {
        return c.json({ error: 'Empty request body' }, 400);
      }

      if (target === 'original') {
        await c.env.PHOTOS_BUCKET.put(originalKey, body, { httpMetadata: { contentType } });
        await deleteStaleIg();
      } else {
        await c.env.PHOTOS_BUCKET.put(previewKey, body, { httpMetadata: { contentType } });
      }

      // Bump cache version on each write; a couple of extra increments only make
      // caches refresh, which is the desired behaviour after an edit.
      await bumpCacheVersion();

      await logReplace(target);

      return c.json({ success: true });
    }

    // Legacy multipart path (kept for backward compatibility with older clients).
    const formData = await c.req.formData();
    const originalFile = formData.get('original') as File | null;
    const previewFile = formData.get('preview') as File | null;

    if (!originalFile || !previewFile) {
      return c.json({ error: 'Both original and preview files are required' }, 400);
    }

    // Overwrite original in R2
    await c.env.PHOTOS_BUCKET.put(originalKey, await originalFile.arrayBuffer(), {
      httpMetadata: { contentType },
    });

    // Overwrite preview in R2
    await c.env.PHOTOS_BUCKET.put(previewKey, await previewFile.arrayBuffer(), {
      httpMetadata: { contentType },
    });

    await deleteStaleIg();
    await bumpCacheVersion();

    await logReplace('multipart');

    return c.json({ success: true });
  } catch (error) {
    console.error('Error replacing photo:', error);
    return c.json({ error: 'Failed to replace photo' }, 500);
  }
});

/**
 * DELETE /photos/:photoId
 * Move a photo to Trash (soft delete). The photo is hidden from all normal
 * views immediately but its R2 files + DB row are kept until either an
 * admin empties the trash (POST /photos/trash/empty or DELETE
 * /photos/:photoId/permanent) or the nightly purge cron removes it after
 * TRASH_RETENTION_DAYS (see scheduled.ts runTrashPurge).
 */
app.delete('/:photoId', async (c) => {
  const photoId = c.req.param('photoId');

  try {
    const photo = await c.env.DB
      .prepare('SELECT id, event_id, deleted_at FROM photos WHERE id = ?')
      .bind(photoId)
      .first<{ id: string; event_id: number; deleted_at: string | null }>();

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const permissionError = await requireEventCapabilityById(
      c,
      photo.event_id,
      'photo_delete',
      'Delete permission required for this event'
    );
    if (permissionError) return permissionError;

    if (!photo.deleted_at) {
      await withRetry(
        () => c.env.DB
          .prepare("UPDATE photos SET deleted_at = datetime('now') WHERE id = ?")
          .bind(photoId)
          .run(),
        `DB soft-delete photo ${photoId}`
      );

      const user = c.get('user');
      await logActivity(c.env, {
        eventId: photo.event_id,
        actorEmail: user?.email || 'unknown',
        action: 'photo_trash',
        targetType: 'photo',
        targetId: photoId,
      });
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting photo:', error);
    return c.json({ error: 'Failed to delete photo' }, 500);
  }
});

/**
 * PUT /photos/:photoId/restore
 * Restore a photo out of Trash.
 */
app.put('/:photoId/restore', async (c) => {
  const photoId = c.req.param('photoId');

  try {
    const photo = await c.env.DB
      .prepare('SELECT id, event_id FROM photos WHERE id = ?')
      .bind(photoId)
      .first<{ id: string; event_id: number }>();

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const permissionError = await requireEventCapabilityById(
      c,
      photo.event_id,
      'photo_delete',
      'Delete permission required for this event'
    );
    if (permissionError) return permissionError;

    await c.env.DB
      .prepare('UPDATE photos SET deleted_at = NULL WHERE id = ?')
      .bind(photoId)
      .run();

    await logActivity(c.env, {
      eventId: photo.event_id,
      actorEmail: c.get('user')?.email || 'unknown',
      action: 'photo_restore',
      targetType: 'photo',
      targetId: photoId,
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('Error restoring photo:', error);
    return c.json({ error: 'Failed to restore photo' }, 500);
  }
});

/**
 * DELETE /photos/:photoId/permanent
 * Permanently delete a single (already-trashed) photo right away, instead
 * of waiting for the retention window — R2 files + DB row are removed.
 */
app.delete('/:photoId/permanent', async (c) => {
  const photoId = c.req.param('photoId');

  try {
    const photo = await c.env.DB
      .prepare(`
        SELECT p.id, p.event_id, p.source_photo_id, e.slug
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
      `)
      .bind(photoId)
      .first<{ id: string; event_id: number; source_photo_id: string | null; slug: string }>();

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const permissionError = await requireEventCapabilityById(
      c,
      photo.event_id,
      'photo_delete',
      'Delete permission required for this event'
    );
    if (permissionError) return permissionError;

    await permanentlyDeletePhotos(c.env, [photo]);

    await logActivity(c.env, {
      eventId: photo.event_id,
      actorEmail: c.get('user')?.email || 'unknown',
      action: 'photo_delete_permanent',
      targetType: 'photo',
      targetId: photoId,
      metadata: { count: 1 },
    });

    return c.json({ success: true });
  } catch (error) {
    console.error('Error permanently deleting photo:', error);
    return c.json({ error: 'Failed to permanently delete photo' }, 500);
  }
});

/**
 * PUT /photos/:photoId/archive
 * Toggle archived status: archived photos are hidden from the Timeline
 * (main library feed) but remain visible in their event's gallery, same as
 * Google Photos' "Archive" (vs. Trash, which hides everywhere).
 */
app.put('/:photoId/archive', async (c) => {
  try {
    const photoId = c.req.param('photoId');
    const { isArchived } = await c.req.json<{ isArchived: boolean }>();

    const photo = await c.env.DB
      .prepare('SELECT event_id FROM photos WHERE id = ?')
      .bind(photoId)
      .first<{ event_id: number }>();

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    const permissionError = await requireEventCapabilityById(
      c,
      photo.event_id,
      'photo_delete',
      'Delete permission required for this event'
    );
    if (permissionError) return permissionError;

    await c.env.DB
      .prepare("UPDATE photos SET archived_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE id = ?")
      .bind(isArchived ? 1 : 0, photoId)
      .run();

    await logActivity(c.env, {
      eventId: photo.event_id,
      actorEmail: c.get('user')?.email || 'unknown',
      action: 'photo_archive',
      targetType: 'photo',
      targetId: photoId,
      metadata: { archived: !!isArchived },
    });

    return c.json({ success: true, is_archived: isArchived });
  } catch (error) {
    console.error('Error updating archived status:', error);
    return c.json({ error: 'Failed to update archived status' }, 500);
  }
});

/**
 * GET /photos/trash
 * List all soft-deleted photos (admin-only — this route sits under
 * /api/admin/photos which requireAdmin already gates, see routes/admin.ts).
 */
app.get('/trash', async (c) => {
  try {
    const photos = await c.env.DB
      .prepare(`
        SELECT p.id, p.event_id, p.original_filename, p.file_type, p.capture_time,
               p.blur_placeholder, p.cache_version, p.deleted_at,
               e.slug as event_slug, e.name as event_name
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.deleted_at IS NOT NULL
        ORDER BY p.deleted_at DESC
      `)
      .all();

    return c.json({ photos: photos.results || [], retentionDays: TRASH_RETENTION_DAYS });
  } catch (error) {
    console.error('Error fetching trash:', error);
    return c.json({ error: 'Failed to fetch trash' }, 500);
  }
});

/**
 * POST /photos/trash/empty
 * Permanently delete every currently-trashed photo right away (admin-only).
 */
app.post('/trash/empty', async (c) => {
  try {
    const photos = await c.env.DB
      .prepare(`
        SELECT p.id, p.source_photo_id, e.slug
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.deleted_at IS NOT NULL
      `)
      .all<{ id: string; source_photo_id: string | null; slug: string }>();

    const toDelete = photos.results || [];
    await permanentlyDeletePhotos(c.env, toDelete);

    // One row for the whole sweep — emptying the trash is a single decision,
    // and per-photo entries would bury everything else in the feed. The
    // photos span multiple events, so this entry isn't tied to one.
    if (toDelete.length > 0) {
      await logActivity(c.env, {
        actorEmail: c.get('user')?.email || 'unknown',
        action: 'photo_delete_permanent',
        targetType: 'trash',
        metadata: { count: toDelete.length, source: 'empty_trash' },
      });
    }

    return c.json({ success: true, deletedCount: toDelete.length });
  } catch (error) {
    console.error('Error emptying trash:', error);
    return c.json({ error: 'Failed to empty trash' }, 500);
  }
});

/**
 * POST /photos/bulk-delete
 * Bulk move multiple photos to Trash (soft delete — see DELETE /:photoId).
 */
app.post('/bulk-delete', async (c) => {
  try {
    const user = await extractUser(c);
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    c.set('user', user);
    const isGlobalAdmin = isUserAdmin(user, c.env.ADMIN_EMAILS || '');

    const { photoIds } = await c.req.json<{ photoIds: string[] }>();
    
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return c.json({ error: 'photoIds array is required' }, 400);
    }
    
    // Limit to 500 photos per request to prevent abuse
    if (photoIds.length > 500) {
      return c.json({ error: 'Cannot delete more than 500 photos at once' }, 400);
    }
    
    // De-duplicate incoming IDs so we don't do repeated work
    const uniquePhotoIds = Array.from(new Set(photoIds));
    const errors: { photoId: string; error: string }[] = [];

    // Fetch all existing (not already trashed) photos, chunked to stay under
    // D1's 100 bound-parameter-per-query limit for large selections.
    const photoSelectStatements = chunkArray(uniquePhotoIds, MAX_SQL_IN_CHUNK).map((chunk) => {
      const chunkPlaceholders = chunk.map(() => '?').join(', ');
      return c.env.DB
        .prepare(`
          SELECT p.id, p.event_id
          FROM photos p
          WHERE p.id IN (${chunkPlaceholders}) AND p.deleted_at IS NULL
        `)
        .bind(...chunk);
    });

    const photoRowBatches = await c.env.DB.batch<{ id: string; event_id: number }>(photoSelectStatements);

    const existingPhotos = photoRowBatches.flatMap((batch) => batch.results || []);
    const existingPhotoIds = new Set(existingPhotos.map((p) => p.id));

    if (!isGlobalAdmin && existingPhotos.length > 0) {
      const eventIds = Array.from(new Set(existingPhotos.map((photo) => photo.event_id)));
      const permissionChecks = await Promise.all(
        eventIds.map((eventId) => hasEventCapabilityByEventId(c.env.DB, eventId, user.email, 'bulk_delete'))
      );

      if (permissionChecks.some((allowed) => !allowed)) {
        return c.json({ error: 'Bulk delete permission required for one or more events' }, 403);
      }
    }

    // Record IDs that don't exist (or are already trashed)
    for (const photoId of uniquePhotoIds) {
      if (!existingPhotoIds.has(photoId)) {
        errors.push({ photoId, error: 'Photo not found' });
      }
    }

    // Soft-delete all found photos, chunked for the same reason as the SELECT above.
    let deletedCount = 0;
    if (existingPhotos.length > 0) {
      const updateStatements = chunkArray(existingPhotos.map((p) => p.id), MAX_SQL_IN_CHUNK).map((chunk) => {
        const chunkPlaceholders = chunk.map(() => '?').join(', ');
        return c.env.DB
          .prepare(`UPDATE photos SET deleted_at = datetime('now') WHERE id IN (${chunkPlaceholders})`)
          .bind(...chunk);
      });

      await withRetry(
        () => c.env.DB.batch(updateStatements),
        `DB bulk soft-delete ${existingPhotos.length} photos`
      );

      deletedCount = existingPhotos.length;

      // A single row for the whole selection, not one per photo — a 500-photo
      // bulk delete would otherwise flood the feed. Attribute it to the event
      // only when the selection came from one.
      const eventIds = Array.from(new Set(existingPhotos.map((p) => p.event_id)));
      await logActivity(c.env, {
        eventId: eventIds.length === 1 ? eventIds[0] : null,
        actorEmail: user.email,
        action: 'photo_bulk_delete',
        targetType: 'photo',
        metadata: { count: deletedCount, eventCount: eventIds.length },
      });
    }

    return c.json({
      success: true,
      deletedCount,
      totalRequested: photoIds.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error in bulk delete:', error);
    return c.json({ error: 'Failed to process bulk delete' }, 500);
  }
});

/**
 * POST /photos/bulk-tag-people
 * Adds one or more people as manually-tagged across multiple selected photos at once (the
 * EventGallery multi-select "Tag people" action) — e.g. tagging everyone in a group photo, or
 * tagging one person across a whole batch of photos from an event. ADDS only (never removes
 * existing tags on any of the selected photos, even ones tagged individually before) — see
 * addManualPhotoPersonTags()'s doc comment in faceClustering.ts for why this is deliberately
 * additive rather than a bulk version of the single-photo replace-the-whole-set endpoint.
 * Same permission level as image editing (`image_edit`), same per-event capability-check
 * pattern as bulk-delete above (global admins bypass; others need the capability on every
 * event any selected photo belongs to).
 */
app.post('/bulk-tag-people', async (c) => {
  try {
    const user = await extractUser(c);
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    c.set('user', user);
    const isGlobalAdmin = isUserAdmin(user, c.env.ADMIN_EMAILS || '');

    const { photoIds, personIds } = await c.req.json<{ photoIds: string[]; personIds: number[] }>();

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return c.json({ error: 'photoIds array is required' }, 400);
    }
    if (photoIds.length > 500) {
      return c.json({ error: 'Cannot tag more than 500 photos at once' }, 400);
    }
    if (!Array.isArray(personIds) || personIds.length === 0 || !personIds.every((id) => Number.isFinite(id))) {
      return c.json({ error: 'personIds must be a non-empty array of numbers' }, 400);
    }
    if (personIds.length > 50) {
      return c.json({ error: 'Cannot tag more than 50 people at once' }, 400);
    }

    const uniquePhotoIds = Array.from(new Set(photoIds));

    const photoSelectStatements = chunkArray(uniquePhotoIds, MAX_SQL_IN_CHUNK).map((idsChunk) => {
      const placeholders = idsChunk.map(() => '?').join(', ');
      return c.env.DB
        .prepare(`SELECT p.id, p.event_id FROM photos p WHERE p.id IN (${placeholders}) AND p.deleted_at IS NULL`)
        .bind(...idsChunk);
    });
    const photoRowBatches = await c.env.DB.batch<{ id: string; event_id: number }>(photoSelectStatements);
    const existingPhotos = photoRowBatches.flatMap((batch) => batch.results || []);

    if (existingPhotos.length === 0) {
      return c.json({ error: 'None of the given photos were found' }, 404);
    }

    if (!isGlobalAdmin) {
      const eventIds = Array.from(new Set(existingPhotos.map((photo) => photo.event_id)));
      const permissionChecks = await Promise.all(
        eventIds.map((eventId) => hasEventCapabilityByEventId(c.env.DB, eventId, user.email, 'image_edit'))
      );
      if (permissionChecks.some((allowed) => !allowed)) {
        return c.json({ error: 'Edit permission required for one or more events' }, 403);
      }
    }

    await addManualPhotoPersonTags(c.env, existingPhotos.map((p) => p.id), personIds);

    const taggedEventIds = Array.from(new Set(existingPhotos.map((p) => p.event_id)));
    await logActivity(c.env, {
      eventId: taggedEventIds.length === 1 ? taggedEventIds[0] : null,
      actorEmail: user.email,
      action: 'person_tag_add',
      targetType: 'photo',
      metadata: { photoCount: existingPhotos.length, personCount: personIds.length, bulk: true },
    });

    return c.json({ success: true, taggedPhotoCount: existingPhotos.length });
  } catch (error) {
    console.error('Error in bulk tag people:', error);
    return c.json({ error: 'Failed to tag people on selected photos' }, 500);
  }
});

/**
 * POST /photos/bulk-copy
 * Copy multiple photos to a target event (DB-only, no R2 duplication).
 * Copied photo records point back to the source photo's R2 files via
 * source_photo_id and source_event_slug.
 */
app.post('/bulk-copy', async (c) => {
  try {
    const user = await extractUser(c);
    if (!user) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    c.set('user', user);
    const isGlobalAdmin = isUserAdmin(user, c.env.ADMIN_EMAILS || '');

    const { photoIds, targetEventSlug } = await c.req.json<{ photoIds: string[]; targetEventSlug: string }>();

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return c.json({ error: 'photoIds array is required' }, 400);
    }

    if (!targetEventSlug || typeof targetEventSlug !== 'string') {
      return c.json({ error: 'targetEventSlug is required' }, 400);
    }

    if (photoIds.length > 500) {
      return c.json({ error: 'Cannot copy more than 500 photos at once' }, 400);
    }

    // Verify target event exists
    const targetEvent = await c.env.DB
      .prepare('SELECT id, slug FROM events WHERE slug = ?')
      .bind(targetEventSlug)
      .first<{ id: number; slug: string }>();

    if (!targetEvent) {
      return c.json({ error: 'Target event not found' }, 404);
    }

    // Check that the user has upload permission in the target event.
    // Case-insensitive — email casing can differ between how a collaborator
    // was invited and how they log in, and a mismatch must not cause a
    // spurious 403 here (see getCollaboratorRole() for rationale).
    if (!isGlobalAdmin) {
      const hasUploadPermission = await hasEventCapabilityByEventId(c.env.DB, targetEvent.id, user.email, 'upload');
      if (!hasUploadPermission) {
        return c.json({ error: 'Upload permission required for the target event' }, 403);
      }
    }

    const uniquePhotoIds = Array.from(new Set(photoIds));

    // Fetch source photos, chunked to stay under D1's 100 bound-parameter-per-
    // query limit for large selections. If a source photo is itself a copy,
    // resolve to the root source so we don't create chains of references.
    const photoSelectStatements = chunkArray(uniquePhotoIds, MAX_SQL_IN_CHUNK).map((chunk) => {
      const chunkPlaceholders = chunk.map(() => '?').join(', ');
      return c.env.DB
        .prepare(`
          SELECT p.id, p.event_id, p.original_filename, p.file_type, p.capture_time,
                 p.width, p.height, p.iso, p.aperture, p.shutter_speed, p.focal_length,
                 p.camera_make, p.camera_model, p.lens_model, p.latitude, p.longitude,
                 p.city, p.blur_placeholder,
                 p.source_photo_id, p.source_event_slug,
                 e.slug as event_slug
          FROM photos p
          JOIN events e ON p.event_id = e.id
          WHERE p.id IN (${chunkPlaceholders})
        `)
        .bind(...chunk);
    });

    const photoRowBatches = await c.env.DB.batch<{
      id: string; event_id: number; original_filename: string; file_type: string;
      capture_time: string; width: number | null; height: number | null;
      iso: number | null; aperture: string | null; shutter_speed: string | null;
      focal_length: string | null; camera_make: string | null; camera_model: string | null;
      lens_model: string | null; latitude: number | null; longitude: number | null;
      city: string | null; blur_placeholder: string | null;
      source_photo_id: string | null; source_event_slug: string | null;
      event_slug: string;
    }>(photoSelectStatements);

    const sourcePhotos = photoRowBatches.flatMap((batch) => batch.results || []);

    if (sourcePhotos.length === 0) {
      return c.json({ error: 'No valid photos found' }, 404);
    }

    const errors: { photoId: string; error: string }[] = [];
    let copiedCount = 0;
    // `uploaded_by` must store the copier's EMAIL, not their display name — see
    // uploads/start's own doc comment for why (public.ts's `LEFT JOIN users u ON
    // p.uploaded_by = u.email` and the new-upload-notification "exclude the uploader"
    // logic both key off email; a name here can never match either, silently breaking
    // "Uploaded by" display and notification exclusion for every copied photo).
    const uploaderEmail = user.email;

    const COPY_BATCH_SIZE = 25;
    for (let i = 0; i < sourcePhotos.length; i += COPY_BATCH_SIZE) {
      const batch = sourcePhotos.slice(i, i + COPY_BATCH_SIZE);

      await Promise.all(batch.map(async (photo) => {
        try {
          const newPhotoId = ulid();

          // If the source photo is itself a copy, chain through to the root source
          // so we never build multi-level pointer chains.
          const rootPhotoId = photo.source_photo_id ?? photo.id;
          const rootEventSlug = photo.source_event_slug ?? photo.event_slug;

          await withRetry(
            () => c.env.DB
              .prepare(`INSERT INTO photos (
                id, event_id, original_filename, file_type, capture_time,
                width, height, iso, aperture, shutter_speed, focal_length,
                camera_make, camera_model, lens_model, latitude, longitude,
                city, blur_placeholder, uploaded_by,
                source_photo_id, source_event_slug
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .bind(
                newPhotoId, targetEvent.id, photo.original_filename, photo.file_type,
                photo.capture_time, photo.width, photo.height, photo.iso, photo.aperture,
                photo.shutter_speed, photo.focal_length, photo.camera_make, photo.camera_model,
                photo.lens_model, photo.latitude, photo.longitude, photo.city,
                photo.blur_placeholder, uploaderEmail,
                rootPhotoId, rootEventSlug
              )
              .run(),
            `DB insert copied photo ${newPhotoId}`
          );

          copiedCount++;
        } catch (err) {
          console.error(`Failed to copy photo ${photo.id}:`, err);
          errors.push({ photoId: photo.id, error: 'Failed to copy photo' });
        }
      }));
    }

    // Update inferred_date on target event based on earliest photo
    if (copiedCount > 0) {
      await c.env.DB
        .prepare(`
          UPDATE events
          SET inferred_date = (
            SELECT DATE(MIN(capture_time))
            FROM photos
            WHERE event_id = ?
          )
          WHERE id = ?
        `)
        .bind(targetEvent.id, targetEvent.id)
        .run();

      await logActivity(c.env, {
        eventId: targetEvent.id,
        actorEmail: user.email,
        action: 'photo_bulk_copy',
        targetType: 'event',
        targetId: String(targetEvent.id),
        metadata: { count: copiedCount, targetSlug: targetEvent.slug },
      });
    }

    return c.json({
      success: true,
      copiedCount,
      totalRequested: photoIds.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error in bulk copy:', error);
    return c.json({ error: 'Failed to process bulk copy' }, 500);
  }
});

/**
 * PATCH /photos/bulk-location
 * Set/override the GPS location for a specific set of photos, picked by the
 * caller (e.g. via multi-select in the gallery). Admin-only: every route
 * under /admin/photos/* is already gated by the `requireAdmin` middleware
 * mounted in routes/admin.ts (the only exceptions there are `/uploads/` and
 * per-event `/stats` paths, neither of which apply to this path), so no
 * additional per-event capability check is needed here — unlike bulk-delete/
 * bulk-copy, which are reachable by non-admin collaborators with the right
 * capability and so check that explicitly.
 *
 * Distinct from PUT /admin/events/:slug/location (events.ts), which only
 * back-fills photos that are missing GPS data across an entire event; this
 * lets an admin target specific photos and always overwrite their location.
 */
app.patch('/bulk-location', async (c) => {
  try {
    const { photoIds, latitude, longitude } = await c.req.json<{
      photoIds: string[];
      latitude: number;
      longitude: number;
    }>();

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return c.json({ error: 'photoIds array is required' }, 400);
    }

    if (photoIds.length > 500) {
      return c.json({ error: 'Cannot update more than 500 photos at once' }, 400);
    }

    if (
      typeof latitude !== 'number' || typeof longitude !== 'number' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    ) {
      return c.json({ error: 'Valid latitude (-90 to 90) and longitude (-180 to 180) are required' }, 400);
    }

    const uniquePhotoIds = Array.from(new Set(photoIds));

    // D1 caps bound parameters at 100 per statement, so a single UPDATE with
    // up to 500 IDs (+ 2 for lat/lng) would exceed the limit and 500 the
    // request once a selection got past ~98 photos. Chunk into a batch of
    // statements instead — D1 runs a batch as one implicit transaction, so
    // this stays atomic while keeping each statement under the limit.
    const statements = chunkArray(uniquePhotoIds, MAX_SQL_IN_CHUNK).map((chunk) => {
      const chunkPlaceholders = chunk.map(() => '?').join(', ');
      return c.env.DB
        .prepare(`UPDATE photos SET latitude = ?, longitude = ? WHERE id IN (${chunkPlaceholders})`)
        .bind(latitude, longitude, ...chunk);
    });

    const results = await withRetry(
      () => c.env.DB.batch(statements),
      `DB bulk-update location for ${uniquePhotoIds.length} photos`
    );

    const updatedCount = results.reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0);

    if (updatedCount > 0) {
      await logActivity(c.env, {
        actorEmail: c.get('user')?.email || 'unknown',
        action: 'photo_location_edit',
        targetType: 'photo',
        metadata: { count: updatedCount, latitude, longitude },
      });
    }

    return c.json({ success: true, updatedCount, totalRequested: photoIds.length });
  } catch (error) {
    console.error('Error bulk-updating photo location:', error);
    return c.json({ error: 'Failed to update photo locations' }, 500);
  }
});

export default app;
