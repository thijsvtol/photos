import { Context, Hono } from 'hono';
import type { Env } from '../types';
import { checkEventAuth, extractUser } from '../auth';

const app = new Hono<{ Bindings: Env }>();

function isAdminEmail(email: string, adminEmails: string): boolean {
  const admins = (adminEmails || '').split(',').map((entry) => entry.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
}

async function requireMediaAccess(
  c: Context<{ Bindings: Env }>,
  event: { id: number; slug: string; password_hash: string | null; visibility: 'public' | 'private' | 'collaborators_only' }
): Promise<Response | null> {
  // Password gate for protected events.
  const isAuthenticated = await checkEventAuth(c, event.slug, !!event.password_hash);
  if (!isAuthenticated) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  // Visibility gate: private/collaborators-only media requires authenticated user identity.
  if (event.visibility === 'public') {
    return null;
  }

  const user = await extractUser(c as any);
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  if (isAdminEmail(user.email, c.env.ADMIN_EMAILS || '')) {
    return null;
  }

  if (event.visibility === 'private') {
    return c.json({ error: 'Access denied' }, 403);
  }

  const collaborator = await c.env.DB
    .prepare('SELECT role FROM event_collaborators WHERE event_id = ? AND user_email = ?')
    .bind(event.id, user.email)
    .first<{ role: string }>();

  if (!collaborator?.role) {
    return c.json({ error: 'Access denied' }, 403);
  }

  return null;
}

/**
 * GET /media/:slug/preview/:photoId.(jpg|mp4)
 * Serves watermarked preview image or video (requires authentication)
 */
app.get('/media/:slug/preview/:photoId', async (c) => {
  const slug = c.req.param('slug');
  const photoIdWithExt = c.req.param('photoId');
  const photoId = photoIdWithExt.replace(/\.(jpg|mp4)$/, '');
  
  try {
    // Check if event is password protected
    const event = await c.env.DB
      .prepare('SELECT id, slug, password_hash, visibility FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number; slug: string; password_hash: string | null; visibility: 'public' | 'private' | 'collaborators_only' }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    const accessError = await requireMediaAccess(c, event);
    if (accessError) return accessError;
    
    // Get file type from database, plus source photo info for copies
    const photo = await c.env.DB
      .prepare('SELECT file_type, source_photo_id, source_event_slug FROM photos WHERE id = ? AND event_id = ?')
      .bind(photoId, event.id)
      .first<{ file_type: string; source_photo_id: string | null; source_event_slug: string | null }>();
    
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }
    
    const fileType = photo.file_type || 'image/jpeg';
    const isVideo = fileType === 'video/mp4';
    const extension = isVideo ? 'mp4' : 'jpg';
    const contentType = isVideo ? 'video/mp4' : 'image/jpeg';

    // Resolve R2 key: copies point to source event's storage
    const r2Slug = photo.source_event_slug ?? slug;
    const r2PhotoId = photo.source_photo_id ?? photoId;
    
    // Try to get the preview version first, fall back to original
    let key = `preview/${r2Slug}/${r2PhotoId}.${extension}`;
    let object = await c.env.PHOTOS_BUCKET.get(key);
    
    // Fallback to original if preview doesn't exist
    if (!object) {
      key = `original/${r2Slug}/${r2PhotoId}.${extension}`;
      object = await c.env.PHOTOS_BUCKET.get(key);
    }
    
    if (!object) {
      return c.json({ error: 'Media not found' }, 404);
    }
    
    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('[MEDIA] Error serving preview:', error);
    return c.json({ error: 'Failed to serve media' }, 500);
  }
});

/**
 * GET /media/:slug/ig/:photoId.jpg
 * Serves Instagram-ready watermarked image (requires authentication)
 */
app.get('/media/:slug/ig/:photoId', async (c) => {
  const slug = c.req.param('slug');
  const photoId = c.req.param('photoId').replace(/\.jpg$/, '');
  
  try {
    // Check if event is password protected
    const event = await c.env.DB
      .prepare('SELECT id, slug, password_hash, visibility FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number; slug: string; password_hash: string | null; visibility: 'public' | 'private' | 'collaborators_only' }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    const accessError = await requireMediaAccess(c, event);
    if (accessError) return accessError;
    
    // Get photo metadata for filename, plus source photo info for copies
    const photo = await c.env.DB
      .prepare('SELECT capture_time, source_photo_id, source_event_slug FROM photos WHERE id = ? AND event_id = ?')
      .bind(photoId, event.id)
      .first<{ capture_time: string; source_photo_id: string | null; source_event_slug: string | null }>();
    
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    // Resolve R2 key: copies point to source event's storage
    const r2Slug = photo.source_event_slug ?? slug;
    const r2PhotoId = photo.source_photo_id ?? photoId;
    
    // Try to get the preview (small) version
    let key = `preview/${r2Slug}/${r2PhotoId}.jpg`;
    let object = await c.env.PHOTOS_BUCKET.get(key);
    
    // If preview version doesn't exist, fall back to original
    if (!object) {
      key = `original/${r2Slug}/${r2PhotoId}.jpg`;
      object = await c.env.PHOTOS_BUCKET.get(key);
    }
    
    if (!object) {
      return c.json({ error: 'Photo not found' }, 404);
    }
    
    // Generate filename: eventSlug_captureTime_photoId_small.jpg
    const captureTime = photo.capture_time.replace(/[:.]/g, '-');
    const filename = `${slug}_${captureTime}_${photoId}_small.jpg`;
    
    return new Response(object.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('Error serving IG photo:', error);
    return c.json({ error: 'Failed to serve photo' }, 500);
  }
});

/**
 * GET /media/:slug/original/:photoId.(jpg|mp4)
 * Serves original full-resolution image or video (requires authentication)
 * Sets Content-Disposition with renamed filename
 */
app.get('/media/:slug/original/:photoId', async (c) => {
  const slug = c.req.param('slug');
  const photoIdWithExt = c.req.param('photoId');
  const photoId = photoIdWithExt.replace(/\.(jpg|mp4)$/, '');
  
  try {
    // Get event to check if password protected
    const event = await c.env.DB
      .prepare('SELECT id, slug, password_hash, visibility FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number; slug: string; password_hash: string | null; visibility: 'public' | 'private' | 'collaborators_only' }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    const accessError = await requireMediaAccess(c, event);
    if (accessError) return accessError;
    
    const photo = await c.env.DB
      .prepare('SELECT capture_time, file_type, source_photo_id, source_event_slug FROM photos WHERE id = ? AND event_id = ?')
      .bind(photoId, event.id)
      .first<{ capture_time: string; file_type: string; source_photo_id: string | null; source_event_slug: string | null }>();
    
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }
    
    const fileType = photo.file_type || 'image/jpeg';
    const isVideo = fileType === 'video/mp4';
    const extension = isVideo ? 'mp4' : 'jpg';
    const contentType = isVideo ? 'video/mp4' : 'image/jpeg';

    // Resolve R2 key: copies point to source event's storage
    const r2Slug = photo.source_event_slug ?? slug;
    const r2PhotoId = photo.source_photo_id ?? photoId;
    
    // Get from R2
    const key = `original/${r2Slug}/${r2PhotoId}.${extension}`;
    const object = await c.env.PHOTOS_BUCKET.get(key);
    
    if (!object) {
      return c.json({ error: 'Media not found in storage' }, 404);
    }
    
    // Generate filename: eventSlug_captureTime_photoId.ext
    const captureTime = photo.capture_time.replace(/[:.]/g, '-');
    const filename = `${slug}_${captureTime}_${photoId}.${extension}`;
    
    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    console.error('Error serving original:', error);
    return c.json({ error: 'Failed to serve media' }, 500);
  }
});

export default app;
