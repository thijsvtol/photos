import { Hono } from 'hono';
import { zipSync } from 'fflate';
import type { Env, ZipRequest, Photo } from '../types';
import { checkEventAuth } from '../auth';

const app = new Hono<{ Bindings: Env }>();

/**
 * Generate a friendly filename for a photo in a ZIP
 */
function generatePhotoFilename(slug: string, captureTime: string, photoId: string): string {
  // Remove special characters and limit length
  const cleanTime = captureTime.replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
  return `${slug}_${cleanTime}_${photoId}.jpg`;
}

/**
 * POST /api/events/:slug/zip
 * Creates and streams a ZIP file with selected photos (max 50)
 * 
 * Note: Uses synchronous ZIP generation (zipSync) which loads all photos into memory.
 * For 50 large photos (e.g., 10MB each), this could use ~500MB of memory.
 * Cloudflare Workers have a 128MB memory limit, so actual limit may be lower.
 * Current 50-photo limit should work for typical photo sizes (2-5MB each).
 * 
 * For larger batches or photos, consider:
 * - Implementing streaming ZIP generation
 * - Using Cloudflare Durable Objects for higher memory limits
 * - Offloading to external service (AWS Lambda, etc.)
 */
app.post('/api/events/:slug/zip', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    // Get event to check if password protected
    const event = await c.env.DB
      .prepare('SELECT id, name, password_hash FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number; name: string; password_hash: string | null }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Check authentication (supports both cookies and Bearer tokens)
    const isAuthenticated = await checkEventAuth(c, slug, !!event.password_hash);
    if (!isAuthenticated) {
      return c.json({ error: 'Authentication required' }, 401);
    }
    
    const body = await c.req.json<ZipRequest>();
    
    if (!body.photoIds || body.photoIds.length === 0) {
      return c.json({ error: 'photoIds array is required' }, 400);
    }
    
    if (body.photoIds.length > 50) {
      return c.json({ error: 'Maximum 50 photos can be downloaded at once' }, 400);
    }
    
    // Get photo metadata, including source info for copied photos
    const placeholders = body.photoIds.map(() => '?').join(',');
    const photos = await c.env.DB
      .prepare(`SELECT id, original_filename, capture_time, source_photo_id, source_event_slug FROM photos WHERE event_id = ? AND id IN (${placeholders})`)
      .bind(event.id, ...body.photoIds)
      .all<Photo>();
    
    if (!photos.results || photos.results.length !== body.photoIds.length) {
      return c.json({ error: 'Some photos not found or do not belong to this event' }, 400);
    }
    
    // Fetch all photos from R2 and create ZIP
    const zipFiles: Record<string, Uint8Array> = {};
    const missingPhotos: string[] = [];
    
    for (const photo of photos.results) {
      // For copied photos, resolve the key to the source event's storage
      const r2Slug = photo.source_event_slug ?? slug;
      const r2PhotoId = photo.source_photo_id ?? photo.id;
      const key = `original/${r2Slug}/${r2PhotoId}.jpg`;
      const object = await c.env.PHOTOS_BUCKET.get(key);
      
      if (!object) {
        console.warn(`Photo not found in R2: ${key}`);
        missingPhotos.push(photo.id);
        continue;
      }
      
      // Generate a friendly filename
      const filename = generatePhotoFilename(slug, photo.capture_time, photo.id);
      
      // Read the file data
      const arrayBuffer = await object.arrayBuffer();
      zipFiles[filename] = new Uint8Array(arrayBuffer);
    }
    
    // If photos are missing, return error
    if (missingPhotos.length > 0) {
      return c.json({ 
        error: 'Some photos not found in storage',
        missingPhotos 
      }, 404);
    }
    
    // Create ZIP file with light compression (level 1)
    // Balances file size and generation speed
    const zipped = zipSync(zipFiles, {
      level: 1,
    });
    
    // Generate ZIP filename
    const timestamp = new Date().toISOString().split('T')[0];
    const zipFilename = `${slug}_${timestamp}.zip`;
    
    // Return ZIP file
    return new Response(zipped, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFilename}"`,
        'Content-Length': zipped.length.toString(),
      },
    });
  } catch (error) {
    console.error('Error generating ZIP:', error);
    return c.json({ error: 'Failed to generate ZIP' }, 500);
  }
});

export default app;
