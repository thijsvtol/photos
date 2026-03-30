import { Hono, Context } from 'hono';
import { ulid } from 'ulid';
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

/**
 * POST /photos/bulk-copy
 * Copy multiple photos to a target event
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

    // Check that the user has upload permission in the target event
    if (!isGlobalAdmin) {
      // Use a broader check: if user is editor/admin collaborator they can upload
      const targetCollaborator = await c.env.DB
        .prepare(`SELECT role FROM collaborators WHERE event_id = ? AND user_email = ?`)
        .bind(targetEvent.id, user.email)
        .first<{ role: string }>();

      const allowedRoles = ['uploader', 'editor', 'admin'];
      if (!targetCollaborator || !allowedRoles.includes(targetCollaborator.role)) {
        return c.json({ error: 'Upload permission required for the target event' }, 403);
      }
    }

    const uniquePhotoIds = Array.from(new Set(photoIds));
    const placeholders = uniquePhotoIds.map(() => '?').join(', ');

    // Fetch source photos with their event slugs
    const photoRows = await c.env.DB
      .prepare(`
        SELECT p.id, p.event_id, p.original_filename, p.file_type, p.capture_time,
               p.width, p.height, p.iso, p.aperture, p.shutter_speed, p.focal_length,
               p.camera_make, p.camera_model, p.lens_model, p.latitude, p.longitude,
               p.city, p.blur_placeholder, e.slug as event_slug
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.id IN (${placeholders})
      `)
      .bind(...uniquePhotoIds)
      .all<{
        id: string; event_id: number; original_filename: string; file_type: string;
        capture_time: string; width: number | null; height: number | null;
        iso: number | null; aperture: string | null; shutter_speed: string | null;
        focal_length: string | null; camera_make: string | null; camera_model: string | null;
        lens_model: string | null; latitude: number | null; longitude: number | null;
        city: string | null; blur_placeholder: string | null; event_slug: string;
      }>();

    const sourcePhotos = photoRows.results || [];

    if (sourcePhotos.length === 0) {
      return c.json({ error: 'No valid photos found' }, 404);
    }

    const errors: { photoId: string; error: string }[] = [];
    let copiedCount = 0;

    const COPY_BATCH_SIZE = 10;
    for (let i = 0; i < sourcePhotos.length; i += COPY_BATCH_SIZE) {
      const batch = sourcePhotos.slice(i, i + COPY_BATCH_SIZE);

      await Promise.all(batch.map(async (photo) => {
        try {
          const newPhotoId = ulid();
          const isVideo = photo.file_type === 'video/mp4';
          const extension = isVideo ? 'mp4' : 'jpg';

          const sourceOriginalKey = `original/${photo.event_slug}/${photo.id}.${extension}`;
          const destOriginalKey = `original/${targetEvent.slug}/${newPhotoId}.${extension}`;

          const sourcePreviewKey = `preview/${photo.event_slug}/${photo.id}.jpg`;
          const destPreviewKey = `preview/${targetEvent.slug}/${newPhotoId}.jpg`;

          // Copy original file
          const sourceOriginal = await c.env.PHOTOS_BUCKET.get(sourceOriginalKey);
          if (!sourceOriginal) {
            errors.push({ photoId: photo.id, error: 'Source original file not found in storage' });
            return;
          }

          await withRetry(
            () => c.env.PHOTOS_BUCKET.put(destOriginalKey, sourceOriginal.body, {
              httpMetadata: { contentType: photo.file_type },
            }),
            `R2 copy original for photo ${photo.id}`
          );

          // Copy preview file if it exists
          const sourcePreview = await c.env.PHOTOS_BUCKET.get(sourcePreviewKey);
          if (sourcePreview) {
            await withRetry(
              () => c.env.PHOTOS_BUCKET.put(destPreviewKey, sourcePreview.body, {
                httpMetadata: { contentType: 'image/jpeg' },
              }),
              `R2 copy preview for photo ${photo.id}`
            );
          }

          // Insert new photo record in the target event
          await withRetry(
            () => c.env.DB
              .prepare(`INSERT INTO photos (
                id, event_id, original_filename, file_type, capture_time,
                width, height, iso, aperture, shutter_speed, focal_length,
                camera_make, camera_model, lens_model, latitude, longitude,
                city, blur_placeholder, uploaded_by
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .bind(
                newPhotoId, targetEvent.id, photo.original_filename, photo.file_type,
                photo.capture_time, photo.width, photo.height, photo.iso, photo.aperture,
                photo.shutter_speed, photo.focal_length, photo.camera_make, photo.camera_model,
                photo.lens_model, photo.latitude, photo.longitude, photo.city,
                photo.blur_placeholder, user.name?.trim() ? user.name.trim().split(' ')[0] : null
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

export default app;
