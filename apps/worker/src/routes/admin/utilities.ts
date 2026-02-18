import { Hono } from 'hono';
import type { Env, User } from '../../types';
import { requireAdmin } from '../../auth';
import { getCityFromCoordinates } from '../../geocoding';

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Apply admin authentication
app.use('/*', requireAdmin);

/**
 * POST /regenerate-thumbnails
 * Note: Thumbnail generation is now done client-side during upload
 * This endpoint is kept for backwards compatibility but does nothing
 */
app.post('/regenerate-thumbnails', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    // Get event
    const event = await c.env.DB
      .prepare('SELECT id FROM events WHERE slug = ?')
      .bind(slug)
      .first();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    return c.json({ 
      message: 'Thumbnail generation is now handled client-side during upload. This endpoint is deprecated.',
      regenerated: 0 
    });
  } catch (error) {
    console.error('Error in regenerate-thumbnails:', error);
    return c.json({ error: 'Failed to regenerate thumbnails' }, 500);
  }
});

/**
 * POST /geocode-photos
 * Reverse geocode all photos in an event that have GPS coordinates but no city
 */
app.post('/geocode-photos', async (c) => {
  try {
    const slug = c.req.param('slug');
    
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
        ORDER BY latitude, longitude
      `)
      .bind(event.id)
      .all();
    
    if (!photos.results || photos.results.length === 0) {
      return c.json({ message: 'No photos need geocoding', updated: 0 });
    }
    
    let updated = 0;
    let lastLat: number | null = null;
    let lastLon: number | null = null;
    let lastCity: string | null = null;
    
    // Helper function to calculate distance between two points in km
    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371; // Earth's radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };
    
    // Process each photo (with smart caching and rate limiting)
    for (const photo of photos.results as any[]) {
      let city: string | null = null;
      
      // Check if coordinates are close to the last processed location (within 5km)
      if (lastLat !== null && lastLon !== null && lastCity !== null) {
        const distance = getDistance(lastLat, lastLon, photo.latitude, photo.longitude);
        if (distance < 5) {
          // Reuse the same city
          city = lastCity;
          console.log(`Reusing city "${city}" for photo ${photo.id} (${distance.toFixed(2)}km away)`);
        }
      }
      
      // If not close enough or no cached city, fetch from API
      if (!city) {
        city = await getCityFromCoordinates(photo.latitude, photo.longitude);
        
        if (city) {
          // Update cache
          lastLat = photo.latitude;
          lastLon = photo.longitude;
          lastCity = city;
          console.log(`Fetched new city "${city}" for photo ${photo.id}`);
        }
        
        // Rate limit: 1 request per second for Nominatim
        await new Promise(resolve => setTimeout(resolve, 1100));
      }
      
      // Update photo with city
      if (city) {
        await c.env.DB
          .prepare('UPDATE photos SET city = ? WHERE id = ?')
          .bind(city, photo.id)
          .run();
        updated++;
      }
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

/**
 * GET /events/:slug/stats
 * Get detailed statistics for a specific event
 */
app.get('/stats', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    // Get event
    const event = await c.env.DB
      .prepare('SELECT id, name, slug, created_at FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number; name: string; slug: string; created_at: string }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    // Get photo count
    const photoCount = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM photos WHERE event_id = ?')
      .bind(event.id)
      .first<{ count: number }>();
    
    // Get photos with GPS
    const photosWithGPS = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM photos WHERE event_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL')
      .bind(event.id)
      .first<{ count: number }>();
    
    // Get photos without GPS
    const photosWithoutGPS = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM photos WHERE event_id = ? AND (latitude IS NULL OR longitude IS NULL)')
      .bind(event.id)
      .first<{ count: number }>();
    
    // Get featured photos count
    const featuredCount = await c.env.DB
      .prepare('SELECT COUNT(*) as count FROM photos WHERE event_id = ? AND is_featured = 1')
      .bind(event.id)
      .first<{ count: number }>();
    
    // Get total favorites for this event
    const favoritesCount = await c.env.DB
      .prepare('SELECT SUM(favorites_count) as total FROM photos WHERE event_id = ?')
      .bind(event.id)
      .first<{ total: number | null }>();
    
    // Get top favorited photos
    const topFavorites = await c.env.DB
      .prepare(`
        SELECT id, original_filename, favorites_count
        FROM photos
        WHERE event_id = ? AND favorites_count > 0
        ORDER BY favorites_count DESC
        LIMIT 10
      `)
      .bind(event.id)
      .all();
    
    // Get camera models
    const cameraModels = await c.env.DB
      .prepare(`
        SELECT 
          camera_model,
          COUNT(*) as count
        FROM photos
        WHERE event_id = ? AND camera_model IS NOT NULL
        GROUP BY camera_model
        ORDER BY count DESC
      `)
      .bind(event.id)
      .all();
    
    return c.json({
      photoCount: photoCount?.count || 0,
      photosWithGPS: photosWithGPS?.count || 0,
      photosWithoutGPS: photosWithoutGPS?.count || 0,
      featuredCount: featuredCount?.count || 0,
      totalFavorites: favoritesCount?.total || 0,
      topFavorites: topFavorites.results,
      cameraModels: cameraModels.results,
    });
  } catch (error) {
    console.error('Error getting event stats:', error);
    return c.json({ error: 'Failed to get event stats' }, 500);
  }
});

export default app;
