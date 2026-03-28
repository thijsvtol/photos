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
 * PUT /photos/:photoId/featured
 * Toggle featured status of a photo
 */
app.put('/:photoId/featured', async (c) => {
  try {
    const photoId = c.req.param('photoId');
    const { isFeatured } = await c.req.json<{ isFeatured: boolean }>();
    
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
        SELECT p.id, p.width, p.height, e.slug
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
      `)
      .bind(photoId)
      .first<{ id: string; width: number | null; height: number | null; slug: string }>();

    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

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
        SELECT p.id, e.slug
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.id = ?
      `)
      .bind(photoId)
      .first<{ id: string; slug: string }>();
    
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }
    
    // Delete from R2
    try {
      await c.env.PHOTOS_BUCKET.delete(`original/${photo.slug}/${photo.id}.jpg`);
      await c.env.PHOTOS_BUCKET.delete(`original/${photo.slug}/${photo.id}.mp4`);
      await c.env.PHOTOS_BUCKET.delete(`preview/${photo.slug}/${photo.id}.jpg`);
      await c.env.PHOTOS_BUCKET.delete(`ig/${photo.slug}/${photo.id}.jpg`);
    } catch (err) {
      console.error('Failed to delete photo from R2:', err);
      // Continue to delete from database even if R2 fails
    }
    
    // Delete from database
    await c.env.DB
      .prepare('DELETE FROM photos WHERE id = ?')
      .bind(photoId)
      .run();
    
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
    const { photoIds } = await c.req.json<{ photoIds: string[] }>();
    
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return c.json({ error: 'photoIds array is required' }, 400);
    }
    
    // Limit to 100 photos per request to prevent abuse
    if (photoIds.length > 100) {
      return c.json({ error: 'Cannot delete more than 100 photos at once' }, 400);
    }
    
    let deletedCount = 0;
    const errors: { photoId: string; error: string }[] = [];
    
    for (const photoId of photoIds) {
      try {
        // Get photo and event slug
        const photo = await c.env.DB
          .prepare(`
            SELECT p.id, e.slug
            FROM photos p
            JOIN events e ON p.event_id = e.id
            WHERE p.id = ?
          `)
          .bind(photoId)
          .first<{ id: string; slug: string }>();
        
        if (!photo) {
          errors.push({ photoId, error: 'Photo not found' });
          continue;
        }
        
        // Delete from R2
        try {
          await c.env.PHOTOS_BUCKET.delete(`original/${photo.slug}/${photo.id}.jpg`);
          await c.env.PHOTOS_BUCKET.delete(`preview/${photo.slug}/${photo.id}.jpg`);
          await c.env.PHOTOS_BUCKET.delete(`ig/${photo.slug}/${photo.id}.jpg`);
        } catch (err) {
          console.error(`Failed to delete photo ${photo.id} from R2:`, err);
          // Continue to delete from database even if R2 fails
        }
        
        // Delete from database
        await c.env.DB
          .prepare('DELETE FROM photos WHERE id = ?')
          .bind(photoId)
          .run();
        
        deletedCount++;
      } catch (err) {
        console.error(`Failed to delete photo ${photoId}:`, err);
        errors.push({ photoId, error: 'Delete failed' });
      }
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
