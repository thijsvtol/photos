import { Hono } from 'hono';
import type { Env, User } from '../../types';
import { requireAdmin } from '../../auth';
import { logActivity } from '../../activityLog';

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Albums are cross-event collections curated by admins (parallel to per-event
// galleries) — admin-only, same pattern as tags.ts.
app.use('/*', requireAdmin);

/**
 * GET /albums
 * List all albums with photo count + cover photo info.
 */
app.get('/', async (c) => {
  try {
    const albums = await c.env.DB
      .prepare(`
        SELECT a.id, a.name, a.description, a.cover_photo_id, a.created_by, a.created_at, a.updated_at,
               (SELECT COUNT(*) FROM album_photos ap WHERE ap.album_id = a.id) as photo_count,
               p.file_type as cover_file_type, p.cache_version as cover_cache_version,
               e.slug as cover_event_slug
        FROM albums a
        LEFT JOIN photos p ON a.cover_photo_id = p.id
        LEFT JOIN events e ON p.event_id = e.id
        ORDER BY a.updated_at DESC
      `)
      .all();

    return c.json({ albums: albums.results || [] });
  } catch (error) {
    console.error('Error fetching albums:', error);
    return c.json({ error: 'Failed to fetch albums' }, 500);
  }
});

/**
 * POST /albums
 * Create a new album.
 */
app.post('/', async (c) => {
  try {
    const { name, description } = await c.req.json<{ name: string; description?: string }>();

    if (!name || typeof name !== 'string' || !name.trim()) {
      return c.json({ error: 'Name is required' }, 400);
    }

    const user = c.get('user');
    const result = await c.env.DB
      .prepare('INSERT INTO albums (name, description, created_by) VALUES (?, ?, ?) RETURNING *')
      .bind(name.trim(), description?.trim() || null, user.email)
      .first<{ id: number }>();

    if (result) {
      await logActivity(c.env, {
        actorEmail: user.email,
        action: 'album_create',
        targetType: 'album',
        targetId: String(result.id),
        metadata: { name: name.trim() },
      });
    }

    return c.json({ album: result });
  } catch (error) {
    console.error('Error creating album:', error);
    return c.json({ error: 'Failed to create album' }, 500);
  }
});

/**
 * GET /albums/:albumId
 * Returns album details plus its photos (ordered by position).
 */
app.get('/:albumId', async (c) => {
  try {
    const albumId = parseInt(c.req.param('albumId'), 10);
    if (!Number.isFinite(albumId)) {
      return c.json({ error: 'Invalid album ID' }, 400);
    }

    const album = await c.env.DB
      .prepare('SELECT * FROM albums WHERE id = ?')
      .bind(albumId)
      .first();

    if (!album) {
      return c.json({ error: 'Album not found' }, 404);
    }

    const photos = await c.env.DB
      .prepare(`
        SELECT p.id, p.original_filename, p.file_type, p.capture_time, p.blur_placeholder,
               p.cache_version, p.width, p.height, e.slug as event_slug, e.name as event_name,
               ap.position
        FROM album_photos ap
        JOIN photos p ON ap.photo_id = p.id
        JOIN events e ON p.event_id = e.id
        WHERE ap.album_id = ? AND p.deleted_at IS NULL
        ORDER BY ap.position ASC, ap.added_at ASC
      `)
      .bind(albumId)
      .all();

    return c.json({ album, photos: photos.results || [] });
  } catch (error) {
    console.error('Error fetching album:', error);
    return c.json({ error: 'Failed to fetch album' }, 500);
  }
});

/**
 * PUT /albums/:albumId
 * Update album name/description/cover photo.
 */
app.put('/:albumId', async (c) => {
  try {
    const albumId = parseInt(c.req.param('albumId'), 10);
    if (!Number.isFinite(albumId)) {
      return c.json({ error: 'Invalid album ID' }, 400);
    }

    const { name, description, coverPhotoId } = await c.req.json<{
      name?: string;
      description?: string;
      coverPhotoId?: string | null;
    }>();

    const existing = await c.env.DB.prepare('SELECT id FROM albums WHERE id = ?').bind(albumId).first();
    if (!existing) {
      return c.json({ error: 'Album not found' }, 404);
    }

    await c.env.DB
      .prepare(`
        UPDATE albums SET
          name = COALESCE(?, name),
          description = ?,
          cover_photo_id = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `)
      .bind(name?.trim() || null, description?.trim() ?? null, coverPhotoId ?? null, albumId)
      .run();

    return c.json({ success: true });
  } catch (error) {
    console.error('Error updating album:', error);
    return c.json({ error: 'Failed to update album' }, 500);
  }
});

/**
 * DELETE /albums/:albumId
 * Deletes the album (photos themselves are untouched — album_photos rows
 * cascade-delete via the FK).
 */
app.delete('/:albumId', async (c) => {
  try {
    const albumId = parseInt(c.req.param('albumId'), 10);
    if (!Number.isFinite(albumId)) {
      return c.json({ error: 'Invalid album ID' }, 400);
    }

    await c.env.DB.prepare('DELETE FROM albums WHERE id = ?').bind(albumId).run();
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting album:', error);
    return c.json({ error: 'Failed to delete album' }, 500);
  }
});

/**
 * POST /albums/:albumId/photos
 * Add one or more photos to an album (appended after the current max position).
 */
app.post('/:albumId/photos', async (c) => {
  try {
    const albumId = parseInt(c.req.param('albumId'), 10);
    if (!Number.isFinite(albumId)) {
      return c.json({ error: 'Invalid album ID' }, 400);
    }

    const { photoIds } = await c.req.json<{ photoIds: string[] }>();
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return c.json({ error: 'photoIds array is required' }, 400);
    }
    if (photoIds.length > 500) {
      return c.json({ error: 'Cannot add more than 500 photos at once' }, 400);
    }

    const album = await c.env.DB.prepare('SELECT id, cover_photo_id FROM albums WHERE id = ?').bind(albumId).first<{ id: number; cover_photo_id: string | null }>();
    if (!album) {
      return c.json({ error: 'Album not found' }, 404);
    }

    const maxPositionRow = await c.env.DB
      .prepare('SELECT COALESCE(MAX(position), -1) as maxPos FROM album_photos WHERE album_id = ?')
      .bind(albumId)
      .first<{ maxPos: number }>();
    let nextPosition = (maxPositionRow?.maxPos ?? -1) + 1;

    const uniqueIds = Array.from(new Set(photoIds));
    const statements = uniqueIds.map((photoId) =>
      c.env.DB
        .prepare('INSERT OR IGNORE INTO album_photos (album_id, photo_id, position) VALUES (?, ?, ?)')
        .bind(albumId, photoId, nextPosition++)
    );
    await c.env.DB.batch(statements);

    // Set a cover photo automatically if the album doesn't have one yet.
    if (!album.cover_photo_id) {
      await c.env.DB
        .prepare('UPDATE albums SET cover_photo_id = ? WHERE id = ? AND cover_photo_id IS NULL')
        .bind(uniqueIds[0], albumId)
        .run();
    }

    return c.json({ success: true, addedCount: uniqueIds.length });
  } catch (error) {
    console.error('Error adding photos to album:', error);
    return c.json({ error: 'Failed to add photos to album' }, 500);
  }
});

/**
 * DELETE /albums/:albumId/photos/:photoId
 * Remove a single photo from an album (does not delete the photo itself).
 */
app.delete('/:albumId/photos/:photoId', async (c) => {
  try {
    const albumId = parseInt(c.req.param('albumId'), 10);
    const photoId = c.req.param('photoId');
    if (!Number.isFinite(albumId)) {
      return c.json({ error: 'Invalid album ID' }, 400);
    }

    await c.env.DB
      .prepare('DELETE FROM album_photos WHERE album_id = ? AND photo_id = ?')
      .bind(albumId, photoId)
      .run();

    return c.json({ success: true });
  } catch (error) {
    console.error('Error removing photo from album:', error);
    return c.json({ error: 'Failed to remove photo from album' }, 500);
  }
});

export default app;
