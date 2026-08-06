import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { firstNameOf } from '../utils';

type Variables = {
  user: User;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * GET /api/me/photos
 *
 * Powers the Timeline's "Just me" filter toggle (apps/web/src/pages/Timeline.tsx): for the
 * currently logged-in account, looks up whether an admin has linked a person/face cluster
 * (see person_clusters.linked_user_email, set via PUT /api/admin/people/:id) to this
 * account's email, and if so returns every photo containing that person's face.
 *
 * Unlike the admin /api/admin/people/:id endpoint (which returns the admin-entered full
 * name), this only ever exposes the person's FIRST name (see utils.ts's firstNameOf) —
 * the full name an admin gives a person stays admin-only.
 */
app.get('/api/me/photos', requireAuth, async (c) => {
  try {
    const user = c.get('user');

    const person = await c.env.DB
      .prepare(`
        SELECT id, name, face_count
        FROM person_clusters
        WHERE LOWER(linked_user_email) = LOWER(?)
      `)
      .bind(user.email)
      .first<{ id: number; name: string | null; face_count: number }>();

    if (!person) {
      return c.json({ linked: false });
    }

    const photos = await c.env.DB
      .prepare(`
        SELECT DISTINCT p.id, p.original_filename, p.file_type, p.capture_time, p.blur_placeholder,
               p.cache_version, p.width, p.height, e.slug as event_slug, e.name as event_name
        FROM photos p
        JOIN events e ON p.event_id = e.id
        WHERE p.deleted_at IS NULL
          AND p.id IN (
            SELECT photo_id FROM photo_faces WHERE person_id = ?
            UNION
            SELECT photo_id FROM photo_person_tags WHERE person_id = ?
          )
        ORDER BY p.capture_time DESC
      `)
      .bind(person.id, person.id)
      .all();

    return c.json({
      linked: true,
      person: {
        id: person.id,
        displayName: firstNameOf(person.name),
        faceCount: person.face_count,
      },
      photos: photos.results || [],
    });
  } catch (error) {
    console.error('Error fetching my photos:', error);
    return c.json({ error: 'Failed to fetch photos' }, 500);
  }
});

/**
 * GET /api/me/face-embedding-model
 *
 * Streams the face-recognition ONNX model (ArcFace ResNet100, int8-quantized, ~63MB) used
 * client-side by apps/web/src/faceEmbeddingOnnx.ts to compute face-recognition embeddings for
 * EVERY upload (see faceDetectionQueue.ts), not just admin actions — this route previously
 * lived under the admin-only `/api/admin/people/embedding-model` group, which meant any
 * non-admin collaborator's uploads silently got ZERO face detection: the model fetch 403'd
 * (requireAdmin gates the whole /admin/people/* router on the global ADMIN_EMAILS whitelist,
 * completely separate from per-event collaborator upload permission) and that 403 was silently
 * swallowed by faceDetection.ts's best-effort try/catch, so nothing ever surfaced the failure —
 * "Scan Library for Faces" (admin-only) still worked fine, masking that upload-time detection
 * was broken for anyone but a global admin. Moved here (any authenticated user, `requireAuth`)
 * since the model itself isn't sensitive — same non-admin-authenticated pattern as
 * GET /api/me/photos above. Long, immutable cache headers since the model file at this R2 key
 * never changes without a deploy (a version bump would use a new R2 key, not overwrite this
 * one, to avoid ever serving a half-cached mixed version).
 */
app.get('/api/me/face-embedding-model', requireAuth, async (c) => {
  try {
    const object = await c.env.PHOTOS_BUCKET.get('models/arcface-r100-int8.onnx');
    if (!object) {
      return c.json({ error: 'Model not found' }, 404);
    }
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(object.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error fetching embedding model:', error);
    return c.json({ error: 'Failed to fetch embedding model' }, 500);
  }
});

export default app;
