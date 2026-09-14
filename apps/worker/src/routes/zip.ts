import { Context, Hono } from 'hono';
import { Zip, ZipPassThrough } from 'fflate';
import type { Env, ZipRequest, Photo } from '../types';
import { checkEventAuth, extractUser, getCollaboratorRoleByEventId } from '../auth';
import { getStorageExtension } from '../fileTypeUtils';

const app = new Hono<{ Bindings: Env }>();

function isAdminEmail(email: string, adminEmails: string): boolean {
  const admins = (adminEmails || '').split(',').map((entry) => entry.trim().toLowerCase());
  return admins.includes(email.toLowerCase());
}

async function requireZipAccess(
  c: Context<{ Bindings: Env }>,
  event: { id: number; slug: string; password_hash: string | null; visibility: 'public' | 'private' | 'collaborators_only' }
): Promise<Response | null> {
  const isAuthenticated = await checkEventAuth(c, event.slug, !!event.password_hash);
  if (!isAuthenticated) {
    return c.json({ error: 'Authentication required' }, 401);
  }

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

  // Case-insensitive — email casing can differ between how a collaborator
  // was invited and how they log in, and a mismatch must not cause a
  // spurious 403 when downloading their event's ZIP.
  const role = await getCollaboratorRoleByEventId(c.env.DB, event.id, user.email);

  if (!role) {
    return c.json({ error: 'Access denied' }, 403);
  }

  return null;
}

/**
 * Generate a friendly filename for a photo in a ZIP
 */
function generatePhotoFilename(slug: string, captureTime: string, photoId: string, extension: string): string {
  // Remove special characters and limit length
  const cleanTime = captureTime.replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
  return `${slug}_${cleanTime}_${photoId}.${extension}`;
}

/**
 * POST /api/events/:slug/zip
 * Creates and streams a ZIP file with selected photos (max 50)
 *
 * Photos are streamed from R2 straight into the ZIP output stream (fflate's
 * streaming Zip/ZipPassThrough) instead of being buffered fully in memory and
 * synchronously deflated. This keeps both CPU time and memory usage roughly
 * constant regardless of batch size, avoiding the Worker resource-limit
 * errors that synchronous whole-buffer zipping ran into for larger/heavier
 * batches. Entries are stored (no compression) since photos/videos are
 * already compressed formats, so deflating them again only burns CPU.
 */
app.post('/api/events/:slug/zip', async (c) => {
  const slug = c.req.param('slug');
  
  try {
    // Get event to check if password protected
    const event = await c.env.DB
      .prepare('SELECT id, name, slug, password_hash, visibility FROM events WHERE slug = ?')
      .bind(slug)
      .first<{ id: number; name: string; slug: string; password_hash: string | null; visibility: 'public' | 'private' | 'collaborators_only' }>();
    
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    
    const accessError = await requireZipAccess(c, event);
    if (accessError) return accessError;
    
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
      .prepare(`SELECT id, original_filename, capture_time, file_type, source_photo_id, source_event_slug FROM photos WHERE event_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`)
      .bind(event.id, ...body.photoIds)
      .all<Photo>();
    
    if (!photos.results || photos.results.length !== body.photoIds.length) {
      return c.json({ error: 'Some photos not found or do not belong to this event' }, 400);
    }
    
    // Resolve R2 keys up front and verify existence with cheap HEAD requests
    // (no body fetch) so we can still return a clean 404 before any streaming
    // response has started.
    const entries = photos.results.map((photo) => {
      const r2Slug = photo.source_event_slug ?? slug;
      const r2PhotoId = photo.source_photo_id ?? photo.id;
      const extension = getStorageExtension(photo.file_type, 'original');
      return {
        photo,
        key: `original/${r2Slug}/${r2PhotoId}.${extension}`,
        filename: generatePhotoFilename(slug, photo.capture_time, photo.id, extension),
      };
    });
    
    const missingPhotos: string[] = [];
    for (const entry of entries) {
      const head = await c.env.PHOTOS_BUCKET.head(entry.key);
      if (!head) {
        console.warn(`Photo not found in R2: ${entry.key}`);
        missingPhotos.push(entry.photo.id);
      }
    }
    
    if (missingPhotos.length > 0) {
      return c.json({ 
        error: 'Some photos not found in storage',
        missingPhotos 
      }, 404);
    }
    
    const bucket = c.env.PHOTOS_BUCKET;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const zip = new Zip((err, chunk, final) => {
          if (err) {
            controller.error(err);
            return;
          }
          if (chunk) controller.enqueue(chunk);
          if (final) controller.close();
        });
        
        try {
          for (const entry of entries) {
            const object = await bucket.get(entry.key);
            if (!object) {
              throw new Error(`Photo not found in storage: ${entry.photo.id}`);
            }
            
            const zipEntry = new ZipPassThrough(entry.filename);
            zip.add(zipEntry);
            
            const reader = object.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) {
                zipEntry.push(new Uint8Array(0), true);
                break;
              }
              zipEntry.push(value, false);
            }
          }
          
          zip.end();
        } catch (err) {
          zip.terminate();
          controller.error(err);
        }
      },
    });
    
    // Generate ZIP filename
    const timestamp = new Date().toISOString().split('T')[0];
    const zipFilename = `${slug}_${timestamp}.zip`;
    
    // Return streamed ZIP file (size isn't known upfront, so no Content-Length)
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFilename}"`,
      },
    });
  } catch (error) {
    console.error('Error generating ZIP:', error);
    return c.json({ error: 'Failed to generate ZIP' }, 500);
  }
});

export default app;
