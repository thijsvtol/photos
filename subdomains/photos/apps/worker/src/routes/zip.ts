import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { zipSync } from 'fflate';
import type { Env, ZipRequest, Photo } from '../types';
import { getEventSession } from '../cookies';

const app = new Hono<{ Bindings: Env }>();

/**
 * POST /api/events/:slug/zip
 * Creates and streams a ZIP file with selected photos (max 50)
 */
app.post('/api/events/:slug/zip', async (c) => {
  const slug = c.req.param('slug');
  
  // Check authentication
  const isAuthenticated = await getEventSession(c.req.raw, slug, c.env.EVENT_COOKIE_SECRET);
  if (!isAuthenticated) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  
  try {
    const body = await c.req.json<ZipRequest>();
    
    if (!body.photoIds || body.photoIds.length === 0) {
      return c.json({ error: 'photoIds array is required' }, 400);
    }
    
    if (body.photoIds.length > 50) {
      return c.json({ error: 'Maximum 50 photos can be downloaded at once' }, 400);
    }
    
    // Verify event exists
    const event = await c.env.DB
      .prepare('SELECT id, name FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number; name: string }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Get photo metadata
    const placeholders = body.photoIds.map(() => '?').join(',');
    const photos = await c.env.DB
      .prepare(`SELECT id, original_filename, capture_time FROM photos WHERE event_id = ? AND id IN (${placeholders})`)
      .bind(event.id, ...body.photoIds)
      .all<Photo>();
    
    if (!photos.results || photos.results.length !== body.photoIds.length) {
      return c.json({ error: 'Some photos not found or do not belong to this event' }, 400);
    }
    
    // Fetch all photos from R2 and create ZIP
    const zipFiles: Record<string, Uint8Array> = {};
    
    for (const photo of photos.results) {
      const key = `original/${slug}/${photo.id}.jpg`;
      const object = await c.env.PHOTOS_BUCKET.get(key);
      
      if (!object) {
        console.warn(`Photo not found in R2: ${key}`);
        continue;
      }
      
      // Generate a friendly filename
      const captureTime = photo.capture_time.replace(/[:.]/g, '-').replace('T', '_').substring(0, 19);
      const filename = `${slug}_${captureTime}_${photo.id}.jpg`;
      
      // Read the file data
      const arrayBuffer = await object.arrayBuffer();
      zipFiles[filename] = new Uint8Array(arrayBuffer);
    }
    
    // Create ZIP file
    const zipped = zipSync(zipFiles, {
      level: 0, // No compression for faster generation
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
