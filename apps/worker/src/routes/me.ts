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
        FROM photo_faces f
        JOIN photos p ON f.photo_id = p.id
        JOIN events e ON p.event_id = e.id
        WHERE f.person_id = ? AND p.deleted_at IS NULL
        ORDER BY p.capture_time DESC
      `)
      .bind(person.id)
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

export default app;
