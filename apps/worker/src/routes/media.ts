import { Context, Hono } from 'hono';
import type { Env } from '../types';
import { checkEventAuth, extractUser, getCollaboratorRoleByEventId } from '../auth';
import { isVideoFileType, getStorageExtension, getStorageContentType } from '../fileTypeUtils';
import { createEventSessionToken } from '../cookies';

const app = new Hono<{ Bindings: Env }>();

function isAdminEmail(email: string, adminEmails: string): boolean {
  const admins = (adminEmails || '').split(',').map((entry) => entry.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
}

/**
 * Builds CORS headers so media can be loaded cross-origin into a <canvas>
 * (required by the in-app image editor on native platforms, where the webview
 * origin — e.g. https://localhost — differs from the media domain).
 * Requests are non-credentialed (native uses query-param/Bearer tokens), so a
 * wildcard origin is safe. Using '*' (rather than reflecting Origin) keeps the
 * response cache-safe, since the CDN edge cache does not reliably vary on Origin.
 */
function mediaCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}

/**
 * Parse an HTTP `Range` header (single range only) into an R2 range option.
 * Returns undefined for absent/unsupported/multi-range headers so the caller
 * falls back to serving the full object.
 */
function parseRangeHeader(rangeHeader: string | undefined): R2Range | undefined {
  if (!rangeHeader) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return undefined;
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return undefined;
  if (startStr === '') {
    // Suffix range: last N bytes.
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return undefined;
    return { suffix };
  }
  const offset = Number(startStr);
  if (!Number.isFinite(offset) || offset < 0) return undefined;
  if (endStr === '') return { offset };
  const end = Number(endStr);
  if (!Number.isFinite(end) || end < offset) return undefined;
  return { offset, length: end - offset + 1 };
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

  // Collaborators bypass password gate for their events. Case-insensitive —
  // email casing can differ between how a collaborator was invited and how
  // they log in, and a mismatch must not cause a spurious 403 on media access.
  if (user) {
    const role = await getCollaboratorRoleByEventId(c.env.DB, event.id, user.email);
    if (role) {
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
 * GET /media/:slug/cast-token
 *
 * Mints a portable, event-scoped session token for the currently
 * authenticated caller — regardless of *how* they authenticated (Cloudflare
 * Access cookie, collaborator/admin identity, event password cookie, mobile
 * Bearer token, or plain public visibility).
 *
 * This exists for Google Cast: the receiver page (pages/CastReceiver.tsx)
 * runs in an isolated browser context on the TV with none of the above
 * cookies/headers available, so it can't authenticate media requests on its
 * own. The sender (web/native app, already authenticated) fetches this
 * token once and embeds it as `?est=` in the media URLs it sends to the
 * receiver, which `requireMediaAccess`/`hasEventSessionAccess` below already
 * accept as a valid access proof — identical to the existing password-login
 * flow's `eventSessionToken`, just obtainable without requiring a password.
 */
app.get('/media/:slug/cast-token', async (c) => {
  const slug = c.req.param('slug');

  const event = await c.env.DB
    .prepare('SELECT id, slug, password_hash, visibility FROM events WHERE slug = ?')
    .bind(slug)
    .first<{ id: number; slug: string; password_hash: string | null; visibility: 'public' | 'private' | 'collaborators_only' }>();

  if (!event) {
    return c.json({ error: 'Event not found' }, 404);
  }

  const accessError = await requireMediaAccess(c, event);
  if (accessError) return accessError;

  const token = await createEventSessionToken(slug, c.env.EVENT_COOKIE_SECRET);
  return c.json({ token });
});

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
    const isVideo = isVideoFileType(fileType);
    // Preview is always .jpg for images (including RAW — the client always
    // generates a real JPEG preview for RAW uploads) and .mp4 for video.
    const previewExtension = getStorageExtension(fileType, 'preview');
    // Fallback (when no preview exists yet) serves the ORIGINAL file, which
    // keeps its real extension for RAW uploads (e.g. .cr2) — that fallback
    // is only hit within the brief upload-processing window, and RAW/JPEG
    // originals both still decode fine as their native Content-Type below.
    const originalExtension = getStorageExtension(fileType, 'original');
    const contentType = getStorageContentType(fileType, 'preview');

    // Resolve R2 key: copies point to source event's storage
    const r2Slug = photo.source_event_slug ?? slug;
    const r2PhotoId = photo.source_photo_id ?? photoId;

    // Honor HTTP Range requests for video so the player can seek and buffer
    // incrementally instead of downloading the whole file up front.
    const rangeOption = isVideo ? parseRangeHeader(c.req.header('Range')) : undefined;
    const getOptions = rangeOption ? { range: rangeOption } : undefined;

    // Try to get the preview version first, fall back to original
    let key = `preview/${r2Slug}/${r2PhotoId}.${previewExtension}`;
    let object = await c.env.PHOTOS_BUCKET.get(key, getOptions);

    // Fallback to original if preview doesn't exist
    if (!object) {
      key = `original/${r2Slug}/${r2PhotoId}.${originalExtension}`;
      object = await c.env.PHOTOS_BUCKET.get(key, getOptions);
    }

    if (!object) {
      return c.json({ error: 'Media not found' }, 404);
    }

    const baseHeaders: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000',
      'Accept-Ranges': 'bytes',
      ...mediaCorsHeaders(),
    };

    // Partial content response when a valid range was requested and resolved.
    const objRange = (object as R2ObjectBody).range as
      | { offset?: number; length?: number }
      | undefined;
    const objSize = (object as R2ObjectBody).size;
    if (rangeOption && objRange && typeof objSize === 'number') {
      const start = objRange.offset ?? 0;
      const length = objRange.length ?? objSize - start;
      const end = start + length - 1;
      return new Response(object.body, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${objSize}`,
          'Content-Length': String(length),
        },
      });
    }

    if (typeof objSize === 'number') {
      baseHeaders['Content-Length'] = String(objSize);
    }

    return new Response(object.body, {
      headers: baseHeaders,
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
      .prepare('SELECT capture_time, file_type, source_photo_id, source_event_slug FROM photos WHERE id = ? AND event_id = ?')
      .bind(photoId, event.id)
      .first<{ capture_time: string; file_type: string; source_photo_id: string | null; source_event_slug: string | null }>();
    
    if (!photo) {
      return c.json({ error: 'Photo not found' }, 404);
    }

    // Resolve R2 key: copies point to source event's storage
    const r2Slug = photo.source_event_slug ?? slug;
    const r2PhotoId = photo.source_photo_id ?? photoId;
    
    // Try to get the preview (small) version — always .jpg, including RAW.
    let key = `preview/${r2Slug}/${r2PhotoId}.jpg`;
    let object = await c.env.PHOTOS_BUCKET.get(key);
    
    // If preview version doesn't exist, fall back to original (keeps the
    // real extension for RAW uploads, e.g. .cr2).
    if (!object) {
      key = `original/${r2Slug}/${r2PhotoId}.${getStorageExtension(photo.file_type, 'original')}`;
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
        ...mediaCorsHeaders(),
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
  // Strip whatever extension the client requested with (.jpg, .mp4, or a real
  // RAW extension like .cr2/.nef/...) — photo IDs are ULIDs and never contain
  // a dot, so trimming the final dot-segment is always safe.
  const photoId = photoIdWithExt.replace(/\.[^./]+$/, '');
  
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
    const extension = getStorageExtension(fileType, 'original');
    const contentType = getStorageContentType(fileType, 'original');

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
        ...mediaCorsHeaders(),
      },
    });
  } catch (error) {
    console.error('Error serving original:', error);
    return c.json({ error: 'Failed to serve media' }, 500);
  }
});

export default app;
