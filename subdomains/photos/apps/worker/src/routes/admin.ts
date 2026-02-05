import { Hono } from 'hono';
import { ulid } from 'ulid';
import type { Env, CreateEventRequest, StartUploadRequest, CompleteUploadRequest } from '../types';
import { generateSalt, hashPassword, generateUniqueSlug } from '../utils';
import { generateThumbnails } from '../imageProcessing';
import { getCityFromCoordinates } from '../geocoding';

const app = new Hono<{ Bindings: Env }>();

/**
 * Admin authentication middleware
 */
app.use('/*', async (c, next) => {
  // Check for Cloudflare Access JWT (automatically added on free plan)
  const accessJwt = c.req.header('Cf-Access-Jwt-Assertion');
  
  // In development, check for optional shared secret
  if (c.env.ENVIRONMENT === 'development') {
    const adminSecret = c.req.header('X-Admin-Secret');
    if (c.env.ADMIN_SHARED_SECRET && adminSecret !== c.env.ADMIN_SHARED_SECRET) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  } else {
    // In production, check for Cloudflare Access JWT
    if (!accessJwt) {
      return c.json({ error: 'Unauthorized - Admin access required' }, 401);
    }
    // Note: For better security, you could verify the JWT signature here
    // using your Cloudflare Access team domain's public keys
  }
  
  await next();
});

/**
 * POST /events
 * Creates a new event
 */
app.post('/events', async (c) => {
  try {
    const body = await c.req.json<CreateEventRequest>();
    
    if (!body.name) {
      return c.json({ error: 'Name is required' }, 400);
    }
    
    // Generate slug
    const slug = body.slug || await generateUniqueSlug(c.env.DB, body.name);
    
    // Generate password hash if password provided
    let salt = null;
    let hash = null;
    if (body.password) {
      salt = generateSalt();
      hash = await hashPassword(body.password, salt);
    }
    
    // Insert event
    const result = await c.env.DB
      .prepare('INSERT INTO events (slug, name, password_salt, password_hash) VALUES (?, ?, ?, ?)')
      .bind(slug, body.name, salt, hash)
      .run();
    
    if (!result.success) {
      return c.json({ error: 'Failed to create event' }, 500);
    }
    
    // Get created event
    const event = await c.env.DB
      .prepare('SELECT id, slug, name, inferred_date, created_at FROM events WHERE slug = ?')
      .bind(slug)
      .first();
    
    return c.json({ event }, 201);
  } catch (error) {
    console.error('Error creating event:', error);
    return c.json({ error: 'Failed to create event' }, 500);
  }
});

/**
 * POST /events/:slug/uploads/start
 * Starts a multipart upload for a photo
 */
app.post('/events/:slug/uploads/start', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    const body = await c.req.json<StartUploadRequest>();
    
    if (!body.photoId || !body.filename) {
      return c.json({ error: 'photoId and filename are required' }, 400);
    }
    
    // Verify event exists
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Create multipart upload in R2
    const key = `original/${slug}/${body.photoId}.jpg`;
    const multipartUpload = await c.env.PHOTOS_BUCKET.createMultipartUpload(key);
    
    // Store photo metadata in database
    const captureTime = body.captureTime || new Date().toISOString();
    await c.env.DB
      .prepare(`INSERT INTO photos (
        id, event_id, original_filename, capture_time, width, height,
        iso, aperture, shutter_speed, focal_length, camera_make, camera_model, lens_model,
        latitude, longitude, blur_placeholder
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        body.photoId, event.id, body.filename, captureTime, 
        body.width || null, body.height || null,
        body.iso || null, body.aperture || null, body.shutterSpeed || null,
        body.focalLength || null, body.cameraMake || null, body.cameraModel || null,
        body.lensModel || null, body.latitude || null, body.longitude || null,
        body.blurPlaceholder || null
      )
      .run();
    
    // Update event inferred date if this is the earliest photo
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
      .bind(event.id, event.id)
      .run();
    
    return c.json({
      uploadId: multipartUpload.uploadId,
      key: multipartUpload.key,
    });
  } catch (error) {
    console.error('Error starting upload:', error);
    return c.json({ error: 'Failed to start upload' }, 500);
  }
});

/**
 * PUT /events/:slug/uploads/:photoId/parts/:partNumber
 * Uploads a part directly to R2
 */
app.put('/events/:slug/uploads/:photoId/parts/:partNumber', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId');
  const partNumber = parseInt(c.req.param('partNumber'));
  
  try {
    const uploadId = c.req.header('X-Upload-Id');
    
    if (!uploadId) {
      return c.json({ error: 'X-Upload-Id header is required' }, 400);
    }
    
    if (isNaN(partNumber) || partNumber < 1) {
      return c.json({ error: 'Invalid part number' }, 400);
    }
    
    const key = `original/${slug}/${photoId}.jpg`;
    
    // Get the body as ArrayBuffer
    const body = await c.req.arrayBuffer();
    
    // Resume multipart upload and upload this part
    const upload = c.env.PHOTOS_BUCKET.resumeMultipartUpload(key, uploadId);
    const uploadedPart = await upload.uploadPart(partNumber, body);
    
    return c.json({
      partNumber,
      etag: uploadedPart.etag,
    });
  } catch (error) {
    console.error('Error uploading part:', error);
    return c.json({ error: 'Failed to upload part' }, 500);
  }
});

/**
 * POST /events/:slug/uploads/:photoId/complete
 * Completes a multipart upload
 */
app.post('/events/:slug/uploads/:photoId/complete', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId');
  
  try {
    const body = await c.req.json<CompleteUploadRequest>();
    
    if (!body.uploadId || !body.parts || body.parts.length === 0) {
      return c.json({ error: 'uploadId and parts are required' }, 400);
    }
    
    const key = `original/${slug}/${photoId}.jpg`;
    
    // Complete the multipart upload
    const upload = c.env.PHOTOS_BUCKET.resumeMultipartUpload(key, body.uploadId);
    await upload.complete(body.parts);
    
    // Generate thumbnails asynchronously (don't wait for completion)
    c.executionCtx.waitUntil(generateThumbnails(c.env.PHOTOS_BUCKET, slug, photoId));
    
    return c.json({ success: true, message: 'Upload completed successfully' });
  } catch (error) {
    console.error('Error completing upload:', error);
    return c.json({ error: 'Failed to complete upload' }, 500);
  }
});

/**
 * POST /events/:slug/regenerate-thumbnails
 * Regenerates thumbnails for all photos in an event
 */
app.post('/events/:slug/regenerate-thumbnails', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    // Get all photos for this event
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    const photos = await c.env.DB
      .prepare('SELECT id FROM photos WHERE event_id = ?')
      .bind(event.id)
      .all<{ id: string }>();
    
    if (!photos.results || photos.results.length === 0) {
      return c.json({ message: 'No photos found for this event' }, 200);
    }
    
    // Generate thumbnails for each photo asynchronously
    for (const photo of photos.results) {
      c.executionCtx.waitUntil(generateThumbnails(c.env.PHOTOS_BUCKET, slug, photo.id));
    }
    
    return c.json({ 
      success: true, 
      message: `Regenerating thumbnails for ${photos.results.length} photos`,
      count: photos.results.length
    });
  } catch (error) {
    console.error('Error regenerating thumbnails:', error);
    return c.json({ error: 'Failed to regenerate thumbnails' }, 500);
  }
});

/**
 * POST /events/:slug/tags
 * Add tags to an event
 */
app.post('/events/:slug/tags', async (c) => {
  try {
    const slug = c.req.param('slug');
    const { tagIds } = await c.req.json<{ tagIds: number[] }>();
    
    // Get event ID
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Delete existing tags
    await c.env.DB
      .prepare('DELETE FROM event_tags WHERE event_id = ?')
      .bind(event.id)
      .run();
    
    // Insert new tags
    for (const tagId of tagIds) {
      await c.env.DB
        .prepare('INSERT INTO event_tags (event_id, tag_id) VALUES (?, ?)')
        .bind(event.id, tagId)
        .run();
    }
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error updating event tags:', error);
    return c.json({ error: 'Failed to update tags' }, 500);
  }
});

/**
 * PUT /photos/:photoId/featured
 * Toggle featured status of a photo
 */
app.put('/photos/:photoId/featured', async (c) => {
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
 * PUT /events/:slug/location
 * Set GPS location for all photos in an event that don't have GPS data
 */
app.put('/events/:slug/location', async (c) => {
  try {
    const slug = c.req.param('slug');
    const { latitude, longitude } = await c.req.json<{ latitude: number; longitude: number }>();
    
    if (!latitude || !longitude) {
      return c.json({ error: 'Latitude and longitude are required' }, 400);
    }
    
    // First get the event_id from the slug
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Update photos that don't have GPS coordinates
    const result = await c.env.DB
      .prepare('UPDATE photos SET latitude = ?, longitude = ? WHERE event_id = ? AND (latitude IS NULL OR longitude IS NULL)')
      .bind(latitude, longitude, event.id)
      .run();
    
    return c.json({ success: true, updated_count: result.meta.changes });
  } catch (error) {
    console.error('Error setting event location:', error);
    return c.json({ error: 'Failed to set event location' }, 500);
  }
});

/**
 * POST /events/:slug/tags
 * Set tags for an event (replaces all existing tags)
 */
app.post('/events/:slug/tags', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    const { tagIds } = await c.req.json<{ tagIds: number[] }>();
    
    if (!Array.isArray(tagIds)) {
      return c.json({ error: 'Invalid tagIds format' }, 400);
    }
    
    // Get event ID
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Delete existing tags
    await c.env.DB
      .prepare('DELETE FROM event_tags WHERE event_id = ?')
      .bind(event.id)
      .run();
    
    // Insert new tags
    if (tagIds.length > 0) {
      for (const tagId of tagIds) {
        await c.env.DB
          .prepare('INSERT INTO event_tags (event_id, tag_id) VALUES (?, ?)')
          .bind(event.id, tagId)
          .run();
      }
    }
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error setting event tags:', error);
    return c.json({ error: 'Failed to set event tags' }, 500);
  }
});

/**
 * GET /stats
 * Get overall admin statistics
 */
app.get('/stats', async (c) => {
  try {
    // Get total events
    const eventsResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM events')
      .first<{ count: number }>();
    
    // Get total photos
    const photosResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM photos')
      .first<{ count: number }>();
    
    // Get total favorites
    const favoritesResult = await c.env.DB
      .prepare('SELECT SUM(favorites_count) as total FROM photos')
      .first<{ total: number | null }>();
    
    // Estimate storage (rough calculation: width * height * 3 bytes per pixel / 3 for JPEG compression)
    const storageResult = await c.env.DB
      .prepare('SELECT SUM(COALESCE(width, 0) * COALESCE(height, 0) * 1.0) as pixels FROM photos')
      .first<{ pixels: number | null }>();
    
    const storageBytes = storageResult?.pixels ? (storageResult.pixels * 3 / 3) : 0;
    
    // Get public/private event counts
    const publicEventsResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM events WHERE password_hash IS NULL')
      .first<{ count: number }>();
    
    const privateEventsResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM events WHERE password_hash IS NOT NULL')
      .first<{ count: number }>();
    
    return c.json({
      totalEvents: eventsResult?.count || 0,
      totalPhotos: photosResult?.count || 0,
      totalFavorites: favoritesResult?.total || 0,
      storageBytes: Math.round(storageBytes),
      publicEvents: publicEventsResult?.count || 0,
      privateEvents: privateEventsResult?.count || 0,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return c.json({ error: 'Failed to fetch stats' }, 500);
  }
});

/**
 * GET /events/:slug/stats
 * Get event-specific statistics
 */
app.get('/events/:slug/stats', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    // Get event ID
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Get photo count
    const photoCountResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM photos WHERE event_id = ?')
      .bind(event.id)
      .first<{ count: number }>();
    
    // Get photos with GPS
    const gpsCountResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM photos WHERE event_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL')
      .bind(event.id)
      .first<{ count: number }>();
    
    // Get top favorited photos
    const topFavorites = await c.env.DB
      .prepare('SELECT id, original_filename, favorites_count FROM photos WHERE event_id = ? ORDER BY favorites_count DESC LIMIT 5')
      .bind(event.id)
      .all();
    
    // Get featured photo count
    const featuredCountResult = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM photos WHERE event_id = ? AND is_featured = 1')
      .bind(event.id)
      .first<{ count: number }>();
    
    // Get total favorites for this event
    const totalFavoritesResult = await c.env.DB
      .prepare('SELECT SUM(favorites_count) as total FROM photos WHERE event_id = ?')
      .bind(event.id)
      .first<{ total: number | null }>();
    
    // Get camera models used
    const cameraModels = await c.env.DB
      .prepare('SELECT DISTINCT camera_model, COUNT(*) as count FROM photos WHERE event_id = ? AND camera_model IS NOT NULL GROUP BY camera_model ORDER BY count DESC')
      .bind(event.id)
      .all();
    
    return c.json({
      photoCount: photoCountResult?.count || 0,
      photosWithGPS: gpsCountResult?.count || 0,
      photosWithoutGPS: (photoCountResult?.count || 0) - (gpsCountResult?.count || 0),
      featuredCount: featuredCountResult?.count || 0,
      totalFavorites: totalFavoritesResult?.total || 0,
      topFavorites: topFavorites.results || [],
      cameraModels: cameraModels.results || [],
    });
  } catch (error) {
    console.error('Error fetching event stats:', error);
    return c.json({ error: 'Failed to fetch event stats' }, 500);
  }
});

/**
 * PUT /events/:slug
 * Update event details
 */
app.put('/events/:slug', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    const { name, password, description } = await c.req.json<{
      name?: string;
      password?: string;
      description?: string;
    }>();
    
    // Get event
    const event = await c.env.DB
      .prepare('SELECT id, password_salt FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number; password_salt: string | null }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    
    if (password !== undefined) {
      if (password === '') {
        // Remove password
        updates.push('password_hash = NULL', 'password_salt = NULL');
      } else {
        // Set new password
        const salt = generateSalt();
        const hash = await hashPassword(password, salt);
        updates.push('password_hash = ?', 'password_salt = ?');
        values.push(hash, salt);
      }
    }
    
    if (updates.length === 0) {
      return c.json({ error: 'No updates provided' }, 400);
    }
    
    // Add event ID for WHERE clause
    values.push(event.id);
    
    await c.env.DB
      .prepare(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error updating event:', error);
    return c.json({ error: 'Failed to update event' }, 500);
  }
});

/**
 * DELETE /events/:slug
 * Delete event and all associated photos
 */
app.delete('/events/:slug', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    // Get event and all photos
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Get all photo IDs for R2 cleanup
    const photos = await c.env.DB
      .prepare('SELECT id FROM photos WHERE event_id = ?')
      .bind(event.id)
      .all<{ id: string }>();
    
    // Delete from R2 (original, preview, ig sizes)
    for (const photo of photos.results || []) {
      try {
        await c.env.PHOTOS_BUCKET.delete(`${slug}/original/${photo.id}.jpg`);
        await c.env.PHOTOS_BUCKET.delete(`${slug}/preview/${photo.id}.jpg`);
        await c.env.PHOTOS_BUCKET.delete(`${slug}/ig/${photo.id}.jpg`);
      } catch (err) {
        console.error(`Failed to delete photo ${photo.id} from R2:`, err);
        // Continue even if R2 delete fails
      }
    }
    
    // Delete photos from database (cascade handled by foreign key)
    await c.env.DB
      .prepare('DELETE FROM photos WHERE event_id = ?')
      .bind(event.id)
      .run();
    
    // Delete event tags
    await c.env.DB
      .prepare('DELETE FROM event_tags WHERE event_id = ?')
      .bind(event.id)
      .run();
    
    // Delete event
    await c.env.DB
      .prepare('DELETE FROM events WHERE id = ?')
      .bind(event.id)
      .run();
    
    return c.json({ success: true, deletedPhotos: photos.results?.length || 0 });
  } catch (error) {
    console.error('Error deleting event:', error);
    return c.json({ error: 'Failed to delete event' }, 500);
  }
});

/**
 * DELETE /photos/:photoId
 * Delete a single photo
 */
app.delete('/photos/:photoId', async (c) => {
  const photoId = c.req.param('photoId');
  
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
      return c.json({ error: 'Photo not found' }, 404);
    }
    
    // Delete from R2
    try {
      await c.env.PHOTOS_BUCKET.delete(`${photo.slug}/original/${photo.id}.jpg`);
      await c.env.PHOTOS_BUCKET.delete(`${photo.slug}/preview/${photo.id}.jpg`);
      await c.env.PHOTOS_BUCKET.delete(`${photo.slug}/ig/${photo.id}.jpg`);
    } catch (err) {
      console.error(`Failed to delete photo ${photo.id} from R2:`, err);
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
 * POST /tags
 * Create a new tag
 */
app.post('/tags', async (c) => {
  try {
    const { name, slug, description } = await c.req.json<{
      name: string;
      slug?: string;
      description?: string;
    }>();
    
    if (!name) {
      return c.json({ error: 'Name is required' }, 400);
    }
    
    // Generate slug if not provided
    const tagSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    const result = await c.env.DB
      .prepare('INSERT INTO tags (name, slug, description) VALUES (?, ?, ?) RETURNING *')
      .bind(name, tagSlug, description || null)
      .first();
    
    return c.json({ tag: result });
  } catch (error) {
    console.error('Error creating tag:', error);
    return c.json({ error: 'Failed to create tag' }, 500);
  }
});

/**
 * PUT /tags/:id
 * Update a tag
 */
app.put('/tags/:id', async (c) => {
  const tagId = parseInt(c.req.param('id'));
  
  try {
    const { name, slug, description } = await c.req.json<{
      name?: string;
      slug?: string;
      description?: string;
    }>();
    
    const updates: string[] = [];
    const values: any[] = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    
    if (slug !== undefined) {
      updates.push('slug = ?');
      values.push(slug);
    }
    
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    
    if (updates.length === 0) {
      return c.json({ error: 'No updates provided' }, 400);
    }
    
    values.push(tagId);
    
    await c.env.DB
      .prepare(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error updating tag:', error);
    return c.json({ error: 'Failed to update tag' }, 500);
  }
});

/**
 * DELETE /tags/:id
 * Delete a tag
 */
app.delete('/tags/:id', async (c) => {
  const tagId = parseInt(c.req.param('id'));
  
  try {
    // Delete event_tags associations
    await c.env.DB
      .prepare('DELETE FROM event_tags WHERE tag_id = ?')
      .bind(tagId)
      .run();
    
    // Delete tag
    await c.env.DB
      .prepare('DELETE FROM tags WHERE id = ?')
      .bind(tagId)
      .run();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting tag:', error);
    return c.json({ error: 'Failed to delete tag' }, 500);
  }
});

/**
 * POST /events/:slug/geocode-photos
 * Reverse geocode all photos in an event that have GPS coordinates but no city
 */
app.post('/events/:slug/geocode-photos', async (c) => {
  try {
    const { slug } = c.req.param();
    
    // Get event
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Get photos with GPS but no city
    const photos = await c.env.DB
      .prepare(`
        SELECT id, latitude, longitude
        FROM photos
        WHERE event_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL AND city IS NULL
      `)
      .bind(event.id)
      .all();
    
    if (!photos.results || photos.results.length === 0) {
      return c.json({ message: 'No photos need geocoding', updated: 0 });
    }
    
    let updated = 0;
    
    // Process each photo (with rate limiting)
    for (const photo of photos.results as any[]) {
      const city = await getCityFromCoordinates(photo.latitude, photo.longitude);
      
      if (city) {
        await c.env.DB
          .prepare('UPDATE photos SET city = ? WHERE id = ?')
          .bind(city, photo.id)
          .run();
        updated++;
      }
      
      // Rate limit: 1 request per second for Nominatim
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
    
    return c.json({ 
      success: true, 
      updated,
      total: photos.results.length 
    });
  } catch (error) {
    console.error('Error geocoding photos:', error);
    return c.json({ error: 'Failed to geocode photos' }, 500);
  }
});

export default app;
