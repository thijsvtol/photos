import { Hono, Context } from 'hono';
import type { Env, User } from '../../types';
import { extractUser, hasEventCapabilityByEventId, isUserAdmin } from '../../auth';

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
        SELECT p.id, p.event_id, p.width, p.height, e.slug
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
      `)
      .bind(photoId)
      .first<{ id: string; event_id: number; width: number | null; height: number | null; slug: string }>();

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

    const formData = await c.req.formData();
    const originalFile = formData.get('original') as File | null;
    const previewFile = formData.get('preview') as File | null;

    if (!originalFile || !previewFile) {
      return c.json({ error: 'Both original and preview files are required' }, 400);
    }

    // Overwrite original in R2
    const originalKey = `original/${photo.slug}/${photo.id}.jpg`;
    await c.env.PHOTOS_BUCKET.put(originalKey, await originalFile.arrayBuffer(), {
      httpMetadata: { contentType: 'image/jpeg' },
    });

    // Overwrite preview in R2
    const previewKey = `preview/${photo.slug}/${photo.id}.jpg`;
    await c.env.PHOTOS_BUCKET.put(previewKey, await previewFile.arrayBuffer(), {
      httpMetadata: { contentType: 'image/jpeg' },
    });

    // Delete stale Instagram export if it exists
    try {
      await c.env.PHOTOS_BUCKET.delete(`ig/${photo.slug}/${photo.id}.jpg`);
    } catch {
      // Ignore if ig version doesn't exist
    }

    // Increment cache_version so clients can bust stale browser/CDN caches
    await c.env.DB
      .prepare('UPDATE photos SET cache_version = cache_version + 1 WHERE id = ?')
      .bind(photoId)
      .run();

    return c.json({ success: true });
  } catch (error) {
    console.error('Error replacing photo:', error);
    return c.json({ error: 'Failed to replace photo' }, 500);
  }
});

/**
 * DELETE /photos/:photoId
 * Delete a photo
 */
app.delete('/:photoId', async (c) => {
  const photoId = c.req.param('photoId');
  
  try {
    // Get photo and event slug for R2 cleanup
    const photo = await c.env.DB
      .prepare(`
        SELECT p.id, p.event_id, e.slug
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
      `)
      .bind(photoId)
      .first<{ id: string; event_id: number; slug: string }>();
    
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
    
    // Delete from R2
    try {
      await Promise.all([
        withRetry(
          () => c.env.PHOTOS_BUCKET.delete(`original/${photo.slug}/${photo.id}.jpg`),
          `R2 delete original jpg for photo ${photo.id}`
        ),
        withRetry(
          () => c.env.PHOTOS_BUCKET.delete(`original/${photo.slug}/${photo.id}.mp4`),
          `R2 delete original mp4 for photo ${photo.id}`
        ),
        withRetry(
          () => c.env.PHOTOS_BUCKET.delete(`preview/${photo.slug}/${photo.id}.jpg`),
          `R2 delete preview for photo ${photo.id}`
        ),
        withRetry(
          () => c.env.PHOTOS_BUCKET.delete(`ig/${photo.slug}/${photo.id}.jpg`),
          `R2 delete instagram for photo ${photo.id}`
        ),
      ]);
    } catch (err) {
      console.error('Failed to delete photo from R2:', err);
      // Continue to delete from database even if R2 fails
    }
    
    // Delete from database
    await withRetry(
      () => c.env.DB
        .prepare('DELETE FROM photos WHERE id = ?')
        .bind(photoId)
        .run(),
      `DB delete photo ${photoId}`
    );
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting photo:', error);
    return c.json({ error: 'Failed to delete photo' }, 500);
  }
});

/**
 * POST /photos/bulk-delete
 * Bulk delete multiple photos
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
    const placeholders = uniquePhotoIds.map(() => '?').join(', ');
    const errors: { photoId: string; error: string }[] = [];

    // One query to fetch all existing photos and their event slugs
    const photoRows = await c.env.DB
      .prepare(`
        SELECT p.id, p.event_id, e.slug
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.id IN (${placeholders})
      `)
      .bind(...uniquePhotoIds)
      .all<{ id: string; event_id: number; slug: string }>();

    const existingPhotos = photoRows.results || [];
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

    // Record IDs that don't exist
    for (const photoId of uniquePhotoIds) {
      if (!existingPhotoIds.has(photoId)) {
        errors.push({ photoId, error: 'Photo not found' });
      }
    }

    // Delete blobs from R2 in concurrent batches for better throughput
    const R2_DELETE_BATCH_SIZE = 25;
    for (let i = 0; i < existingPhotos.length; i += R2_DELETE_BATCH_SIZE) {
      const batch = existingPhotos.slice(i, i + R2_DELETE_BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(async (photo) => {
          await Promise.all([
            withRetry(
              () => c.env.PHOTOS_BUCKET.delete(`original/${photo.slug}/${photo.id}.jpg`),
              `R2 delete original jpg for photo ${photo.id}`
            ),
            withRetry(
              () => c.env.PHOTOS_BUCKET.delete(`original/${photo.slug}/${photo.id}.mp4`),
              `R2 delete original mp4 for photo ${photo.id}`
            ),
            withRetry(
              () => c.env.PHOTOS_BUCKET.delete(`preview/${photo.slug}/${photo.id}.jpg`),
              `R2 delete preview for photo ${photo.id}`
            ),
            withRetry(
              () => c.env.PHOTOS_BUCKET.delete(`ig/${photo.slug}/${photo.id}.jpg`),
              `R2 delete instagram for photo ${photo.id}`
            ),
          ]);
        })
      );

      batchResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          const photo = batch[index];
          console.error(`Failed to delete photo ${photo.id} from R2:`, result.reason);
          // Continue to delete from database even if R2 fails
        }
      });
    }

    // One query to delete all found photos from the database
    let deletedCount = 0;
    if (existingPhotos.length > 0) {
      const deletePlaceholders = existingPhotos.map(() => '?').join(', ');
      await withRetry(
        () => c.env.DB
          .prepare(`DELETE FROM photos WHERE id IN (${deletePlaceholders})`)
          .bind(...existingPhotos.map((p) => p.id))
          .run(),
        `DB bulk delete ${existingPhotos.length} photos`
      );

      deletedCount = existingPhotos.length;
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

export default app;
