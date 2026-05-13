import { Context, Hono } from 'hono';
import type { Env } from '../types';
import { checkEventAuth, extractUser } from '../auth';

const app = new Hono<{ Bindings: Env }>();

/**
 * Parse an HTTP Range header and return the start/end byte offsets.
 * Only supports a single byte range (e.g. "bytes=0-1023").
 */
function parseRange(header: string, totalSize: number): { offset: number; length: number; end: number } | null {
  const match = header.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
  if (start > end || start >= totalSize) return null;
  const clampedEnd = Math.min(end, totalSize - 1);
  return { offset: start, length: clampedEnd - start + 1, end: clampedEnd };
}

/**
 * Serve an R2 object with range-request support (HTTP 206) for video streaming.
 */
function serveWithRange(
  request: Request,
  object: R2ObjectBody,
  contentType: string,
  extraHeaders?: Record<string, string>
): Response {
  const totalSize = object.size;
  const rangeHeader = request.headers.get('Range');
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    ...extraHeaders,
  };

  if (rangeHeader) {
    const range = parseRange(rangeHeader, totalSize);
    if (range) {
      headers['Content-Range'] = `bytes ${range.offset}-${range.end}/${totalSize}`;
      headers['Content-Length'] = String(range.length);
      // R2 object was fetched with the range option, so body is already the partial content
      return new Response(object.body, { status: 206, headers });
    }
    // Invalid range → 416
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${totalSize}` },
    });
  }

  headers['Content-Length'] = String(totalSize);
  return new Response(object.body, { status: 200, headers });
}

function isAdminEmail(email: string, adminEmails: string): boolean {
  const admins = (adminEmails || '').split(',').map((entry) => entry.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
}

async function requireMediaAccess(
  c: Context<{ Bindings: Env }>,
  event: { id: number; slug: string; password_hash: string | null; visibility: 'public' | 'private' | 'collaborators_only' }
): Promise<Response | null> {
  // Try to identify the user first (supports Bearer header + query param token)
  const user = await extractUser(c as any);

  // Admins always have full access
  if (user && isAdminEmail(user.email, c.env.ADMIN_EMAILS || '')) {
    return null;
  }

  // Collaborators bypass password gate for their events
  if (user) {
    const collaborator = await c.env.DB
      .prepare('SELECT role FROM event_collaborators WHERE event_id = ? AND user_email = ?')
      .bind(event.id, user.email)
      .first<{ role: string }>();
    if (collaborator?.role) {
      return null;
    }
  }

  // Password gate for non-collaborator users
  if (event.password_hash) {
    const isAuthenticated = await checkEventAuth(c, event.slug, true);
    if (!isAuthenticated) {
      return c.json({ error: 'Authentication required' }, 401);
    }
  }

  // Visibility gate: private/collaborators-only media requires authenticated user identity.
  if (event.visibility === 'public') {
    return null;
  }

  if (!user) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  // Private events are only accessible by admins/collaborators (already handled above)
  return c.json({ error: 'Access denied' }, 403);
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
    
    // Build R2 get options — for videos, support range requests
    const rangeHeader = c.req.header('Range');
    const r2Options: R2GetOptions = {};

    // Try to get the preview version first, fall back to original
    let key = `preview/${r2Slug}/${r2PhotoId}.${extension}`;

    // For range requests we need the object size first (head), then fetch with range
    if (isVideo && rangeHeader) {
      let head = await c.env.PHOTOS_BUCKET.head(key);
      if (!head) {
        key = `original/${r2Slug}/${r2PhotoId}.${extension}`;
        head = await c.env.PHOTOS_BUCKET.head(key);
      }
      if (!head) return c.json({ error: 'Media not found' }, 404);

      const range = parseRange(rangeHeader, head.size);
      if (!range) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${head.size}` },
        });
      }
      r2Options.range = { offset: range.offset, length: range.length };

      const object = await c.env.PHOTOS_BUCKET.get(key, r2Options);
      if (!object) return c.json({ error: 'Media not found' }, 404);

      return serveWithRange(c.req.raw, object, contentType, {
        'Cache-Control': 'public, max-age=31536000',
      });
    }

    // Non-range or image request
    let object = await c.env.PHOTOS_BUCKET.get(key);
    if (!object) {
      key = `original/${r2Slug}/${r2PhotoId}.${extension}`;
      object = await c.env.PHOTOS_BUCKET.get(key);
    }
    if (!object) return c.json({ error: 'Media not found' }, 404);

    if (isVideo) {
      return serveWithRange(c.req.raw, object, contentType, {
        'Cache-Control': 'public, max-age=31536000',
      });
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(object.size),
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
    
    // Generate filename: eventSlug_captureTime_photoId.ext
    const captureTime = photo.capture_time.replace(/[:.]/g, '-');
    const filename = `${slug}_${captureTime}_${photoId}.${extension}`;

    const key = `original/${r2Slug}/${r2PhotoId}.${extension}`;

    // For videos, support range requests for streaming/seeking
    if (isVideo) {
      const rangeHeader = c.req.header('Range');
      if (rangeHeader) {
        const head = await c.env.PHOTOS_BUCKET.head(key);
        if (!head) return c.json({ error: 'Media not found in storage' }, 404);

        const range = parseRange(rangeHeader, head.size);
        if (!range) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${head.size}` },
          });
        }

        const object = await c.env.PHOTOS_BUCKET.get(key, {
          range: { offset: range.offset, length: range.length },
        });
        if (!object) return c.json({ error: 'Media not found in storage' }, 404);

        return serveWithRange(c.req.raw, object, contentType, {
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'public, max-age=31536000',
        });
      }

      // No range header — serve full video with Accept-Ranges advertised
      const object = await c.env.PHOTOS_BUCKET.get(key);
      if (!object) return c.json({ error: 'Media not found in storage' }, 404);

      return serveWithRange(c.req.raw, object, contentType, {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=31536000',
      });
    }

    // Images — full download
    const object = await c.env.PHOTOS_BUCKET.get(key);
    if (!object) return c.json({ error: 'Media not found in storage' }, 404);

    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(object.size),
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
