import { describe, it, expect, beforeEach, vi } from 'vitest';
import publicRoutes from '../routes/public';
import adminRoutes from '../routes/admin';
import favoritesRoutes from '../routes/favorites';
import zipRoutes from '../routes/zip';
import collaboratorsRoutes from '../routes/collaborators';
import mediaRoutes from '../routes/media';
import type { User } from '../types';
import { createEventCookie } from '../cookies';
import {
  MockD1Database,
  createBucket,
  type TestEnv,
  type EventRecord,
  type PhotoRecord,
} from './mocks';

let currentUser: User | null = null;
let currentIsAdmin = false;
let collaboratorAccessBySlug: Record<string, string[]> = {};

vi.mock('../auth', () => {
  return {
    optionalAuth: async (c: any, next: any) => {
      if (currentUser) {
        c.set('user', currentUser);
      }
      await next();
    },
    requireAuth: async (c: any, next: any) => {
      if (!currentUser) {
        return c.json({ error: 'Authentication required' }, 401);
      }
      c.set('user', currentUser);
      await next();
    },
    requireAdmin: async (c: any, next: any) => {
      if (!currentUser) {
        return c.json({ error: 'Authentication required' }, 401);
      }
      if (!currentIsAdmin) {
        return c.json({ error: 'Admin access required' }, 403);
      }
      c.set('user', currentUser);
      await next();
    },
    requireUploadPermission: async (c: any, next: any) => {
      if (!currentUser) {
        return c.json({ error: 'Authentication required' }, 401);
      }
      if (!currentIsAdmin) {
        let slug = c.req.param('slug');
        if (!slug) {
          const match = c.req.path.match(/\/events\/([^/]+)\/uploads/);
          slug = match?.[1] || '';
        }
        if (!slug) {
          const allowedFallback = Object.values(collaboratorAccessBySlug).flat();
          if (!allowedFallback.includes(currentUser.email)) {
            return c.json({ error: 'Access forbidden' }, 403);
          }
          c.set('user', currentUser);
          await next();
          return;
        }

        const collaborator = await c.env.DB.prepare(
          'SELECT 1 FROM event_collaborators ec JOIN events e ON ec.event_id = e.id WHERE e.slug = ? AND ec.user_email = ?'
        ).bind(slug, currentUser.email).first();

        const allowedBySlug = collaboratorAccessBySlug[slug] || [];
        const allowedFallback = Object.values(collaboratorAccessBySlug).flat();
        if (!collaborator && !allowedBySlug.includes(currentUser.email) && !allowedFallback.includes(currentUser.email)) {
          return c.json({ error: 'Access forbidden' }, 403);
        }
      }
      c.set('user', currentUser);
      await next();
    },
    requireEventCapability: () => async (c: any, next: any) => {
      if (!currentUser) {
        return c.json({ error: 'Authentication required' }, 401);
      }
      c.set('user', currentUser);
      await next();
    },
    hasEventCapabilityByEventId: async () => currentIsAdmin,
    getCollaboratorRole: async () => (currentIsAdmin ? 'admin' : 'viewer'),
    extractUser: async () => currentUser,
    checkEventAuth: async (c: any, eventSlug: string, hasPassword: boolean) => {
      if (!hasPassword) {
        return true;
      }

      const cookieHeader = c.req.header('Cookie') || '';
      const cookies = cookieHeader.split(';').map((cookie: string) => cookie.trim());
      const eventCookie = cookies.find((cookie: string) => cookie.startsWith(`ev_${eventSlug}=`));
      return Boolean(eventCookie);
    },
    getUser: (c: any) => c.get('user') || null,
    isAdmin: () => currentIsAdmin,
  };
});

const baseEvents: EventRecord[] = [
  {
    id: 1,
    slug: 'public-event',
    name: 'Public Event',
    inferred_date: '2024-01-01',
    created_at: '2024-01-01',
    visibility: 'public',
    password_hash: null,
  },
  {
    id: 2,
    slug: 'private-event',
    name: 'Private Event',
    inferred_date: '2024-01-02',
    created_at: '2024-01-02',
    visibility: 'private',
    password_hash: null,
  },
  {
    id: 3,
    slug: 'collab-event',
    name: 'Collaborator Event',
    inferred_date: '2024-01-03',
    created_at: '2024-01-03',
    visibility: 'collaborators_only',
    password_hash: null,
  },
  {
    id: 4,
    slug: 'collab-event-2',
    name: 'Collaborator Event 2',
    inferred_date: '2024-01-04',
    created_at: '2024-01-04',
    visibility: 'collaborators_only',
    password_hash: null,
  },
];

const basePhotos: PhotoRecord[] = [
  {
    id: 'photo-1',
    event_id: 1,
    original_filename: 'public.jpg',
    file_type: 'image/jpeg',
    capture_time: '2024-01-01T10:00:00Z',
    uploaded_at: '2024-01-01T10:00:00Z',
    uploaded_by: null,
    width: 1000,
    height: 800,
    iso: null,
    aperture: null,
    shutter_speed: null,
    focal_length: null,
    camera_make: null,
    camera_model: null,
    lens_model: null,
    latitude: null,
    longitude: null,
    favorites_count: 0,
    blur_placeholder: null,
    is_featured: 0,
    city: 'Amsterdam',
  },
  {
    id: 'photo-2',
    event_id: 2,
    original_filename: 'private.jpg',
    file_type: 'image/jpeg',
    capture_time: '2024-01-02T10:00:00Z',
    uploaded_at: '2024-01-02T10:00:00Z',
    uploaded_by: null,
    width: 1000,
    height: 800,
    iso: null,
    aperture: null,
    shutter_speed: null,
    focal_length: null,
    camera_make: null,
    camera_model: null,
    lens_model: null,
    latitude: null,
    longitude: null,
    favorites_count: 0,
    blur_placeholder: null,
    is_featured: 0,
    city: 'Rotterdam',
  },
  {
    id: 'photo-3',
    event_id: 3,
    original_filename: 'collab.jpg',
    file_type: 'image/jpeg',
    capture_time: '2024-01-03T10:00:00Z',
    uploaded_at: '2024-01-03T10:00:00Z',
    uploaded_by: null,
    width: 1000,
    height: 800,
    iso: null,
    aperture: null,
    shutter_speed: null,
    focal_length: null,
    camera_make: null,
    camera_model: null,
    lens_model: null,
    latitude: null,
    longitude: null,
    favorites_count: 0,
    blur_placeholder: null,
    is_featured: 0,
    city: 'Utrecht',
  },
];

function createEnv(db: MockD1Database): TestEnv {
  return {
    DB: db as unknown as D1Database,
    PHOTOS_BUCKET: createBucket() as unknown as R2Bucket,
    EVENT_COOKIE_SECRET: 'event-secret',
    ADMIN_EMAILS: 'admin@example.com',
    JWT_SECRET: 'jwt-secret',
    APP_NAME: 'Photos',
    BRAND_NAME: 'Photos',
    COPYRIGHT_HOLDER: 'Photos',
    APP_DOMAIN: 'photos.example.com',
    CONTACT_EMAIL: 'hello@example.com',
    ENVIRONMENT: 'development',
    MAILGUN_API_KEY: 'test-key',
    MAILGUN_DOMAIN: 'example.com',
  };
}

describe('Access control', () => {
  beforeEach(() => {
    currentUser = null;
    currentIsAdmin = false;
    collaboratorAccessBySlug = {};
  });

  it('blocks non-logged-in users from private and collaborators-only events and photos', async () => {
    const db = new MockD1Database(baseEvents, basePhotos, { 3: ['collab@example.com'] });
    const env = createEnv(db);

    const eventsResponse = await publicRoutes.request('http://localhost/api/events', {}, env);
    expect(eventsResponse.status).toBe(200);
    const eventsBody = await eventsResponse.json() as { events: Array<{ slug: string }> };
    const eventSlugs = eventsBody.events.map(event => event.slug);
    expect(eventSlugs).toEqual(['public-event']);

    const privateEventResponse = await publicRoutes.request('http://localhost/api/events/private-event', {}, env);
    expect(privateEventResponse.status).toBe(401);

    const collabEventResponse = await publicRoutes.request('http://localhost/api/events/collab-event', {}, env);
    expect(collabEventResponse.status).toBe(401);

    const privatePhotosResponse = await publicRoutes.request('http://localhost/api/events/private-event/photos', {}, env);
    expect(privatePhotosResponse.status).toBe(401);

    const collabPhotosResponse = await publicRoutes.request('http://localhost/api/events/collab-event/photos', {}, env);
    expect(collabPhotosResponse.status).toBe(401);
  });

  it('limits collaborator access to allowed events and photos', async () => {
    currentUser = { id: 'user-1', email: 'collab@example.com', name: 'Collaborator' };
    const db = new MockD1Database(baseEvents, basePhotos, { 3: ['collab@example.com'] });
    const env = createEnv(db);

    const eventsResponse = await publicRoutes.request('http://localhost/api/events', {}, env);
    expect(eventsResponse.status).toBe(200);
    const eventsBody = await eventsResponse.json() as { events: Array<{ slug: string }> };
    const eventSlugs = eventsBody.events.map((event: any) => event.slug).sort();
    expect(eventSlugs).toEqual(['collab-event', 'public-event']);

    const collabPhotosResponse = await publicRoutes.request('http://localhost/api/events/collab-event/photos', {}, env);
    expect(collabPhotosResponse.status).toBe(200);

    const blockedCollabPhotosResponse = await publicRoutes.request('http://localhost/api/events/collab-event-2/photos', {}, env);
    expect(blockedCollabPhotosResponse.status).toBe(403);

    const privatePhotosResponse = await publicRoutes.request('http://localhost/api/events/private-event/photos', {}, env);
    expect(privatePhotosResponse.status).toBe(403);
  });

  it('allows admins to view all events', async () => {
    currentUser = { id: 'admin-1', email: 'admin@example.com', name: 'Admin' };
    currentIsAdmin = true;

    const db = new MockD1Database(baseEvents, basePhotos, { 1: ['collab@example.com'] });
    const env = createEnv(db);

    const eventsResponse = await publicRoutes.request('http://localhost/api/events', {}, env);
    expect(eventsResponse.status).toBe(200);
    const eventsBody = await eventsResponse.json() as { events: Array<{ slug: string }> };
    const eventSlugs = eventsBody.events.map((event: any) => event.slug).sort();
    expect(eventSlugs).toEqual(['collab-event', 'collab-event-2', 'private-event', 'public-event']);
  });

  it('requires authentication to add favorites', async () => {
    const db = new MockD1Database(baseEvents, basePhotos, {});
    const env = createEnv(db);

    const noAuthResponse = await favoritesRoutes.request('http://localhost/api/favorites/photo-1', {
      method: 'POST',
    }, env);
    expect(noAuthResponse.status).toBe(401);

    currentUser = { id: 'user-2', email: 'user@example.com', name: 'User' };
    const authResponse = await favoritesRoutes.request('http://localhost/api/favorites/photo-1', {
      method: 'POST',
    }, env);
    expect(authResponse.status).toBe(200);
    const authBody = await authResponse.json() as { success: boolean };
    expect(authBody.success).toBe(true);
  });

  it('returns 404 for unknown events and photos', async () => {
    const db = new MockD1Database(baseEvents, basePhotos, {});
    const env = createEnv(db);

    const missingEventResponse = await publicRoutes.request('http://localhost/api/events/missing-event', {}, env);
    expect(missingEventResponse.status).toBe(404);

    const missingPhotoResponse = await publicRoutes.request('http://localhost/api/events/public-event/photos/missing-photo', {}, env);
    expect(missingPhotoResponse.status).toBe(404);
  });

  it('returns 403 for collaborators-only event detail when user lacks access', async () => {
    currentUser = { id: 'user-3', email: 'outsider@example.com', name: 'Outsider' };
    const db = new MockD1Database(baseEvents, basePhotos, { 3: ['collab@example.com'] });
    const env = createEnv(db);

    const eventResponse = await publicRoutes.request('http://localhost/api/events/collab-event', {}, env);
    expect(eventResponse.status).toBe(403);
  });

  it('returns 403 for private events when user is not admin', async () => {
    currentUser = { id: 'user-5', email: 'viewer@example.com', name: 'Viewer' };
    const db = new MockD1Database(baseEvents, basePhotos, {});
    const env = createEnv(db);

    const eventResponse = await publicRoutes.request('http://localhost/api/events/private-event', {}, env);
    expect(eventResponse.status).toBe(403);

    const photosResponse = await publicRoutes.request('http://localhost/api/events/private-event/photos', {}, env);
    expect(photosResponse.status).toBe(403);
  });

  it('requires event password session for protected events', async () => {
    const protectedEvent: EventRecord = {
      id: 5,
      slug: 'protected-event',
      name: 'Protected Event',
      inferred_date: '2024-01-05',
      created_at: '2024-01-05',
      visibility: 'public',
      password_hash: 'hash',
    };

    const protectedPhoto: PhotoRecord = {
      id: 'photo-5',
      event_id: 5,
      original_filename: 'protected.jpg',
      file_type: 'image/jpeg',
      capture_time: '2024-01-05T10:00:00Z',
      uploaded_at: '2024-01-05T10:00:00Z',
      uploaded_by: null,
      width: 1000,
      height: 800,
      iso: null,
      aperture: null,
      shutter_speed: null,
      focal_length: null,
      camera_make: null,
      camera_model: null,
      lens_model: null,
      latitude: null,
      longitude: null,
      favorites_count: 0,
      blur_placeholder: null,
      is_featured: 0,
      city: 'Haarlem',
    };

    const db = new MockD1Database([...baseEvents, protectedEvent], [...basePhotos, protectedPhoto], {});
    const env = createEnv(db);

    const noSessionResponse = await publicRoutes.request('http://localhost/api/events/protected-event/photos', {}, env);
    expect(noSessionResponse.status).toBe(401);

    const cookie = await createEventCookie('protected-event', env.EVENT_COOKIE_SECRET);
    const cookieHeader = cookie.split(';')[0];
    const sessionResponse = await publicRoutes.request('http://localhost/api/events/protected-event/photos', {
      headers: {
        Cookie: cookieHeader,
      },
    }, env);
    expect(sessionResponse.status).toBe(200);
  });

  it('requires password even for collaborators-only events', async () => {
    const protectedCollabEvent: EventRecord = {
      id: 6,
      slug: 'protected-collab',
      name: 'Protected Collaborator Event',
      inferred_date: '2024-01-06',
      created_at: '2024-01-06',
      visibility: 'collaborators_only',
      password_hash: 'hash',
    };

    const protectedCollabPhoto: PhotoRecord = {
      id: 'photo-6',
      event_id: 6,
      original_filename: 'protected-collab.jpg',
      file_type: 'image/jpeg',
      capture_time: '2024-01-06T10:00:00Z',
      uploaded_at: '2024-01-06T10:00:00Z',
      uploaded_by: null,
      width: 1000,
      height: 800,
      iso: null,
      aperture: null,
      shutter_speed: null,
      focal_length: null,
      camera_make: null,
      camera_model: null,
      lens_model: null,
      latitude: null,
      longitude: null,
      favorites_count: 0,
      blur_placeholder: null,
      is_featured: 0,
      city: 'Leiden',
    };

    currentUser = { id: 'user-6', email: 'collab2@example.com', name: 'Collaborator 2' };
    const db = new MockD1Database(
      [...baseEvents, protectedCollabEvent],
      [...basePhotos, protectedCollabPhoto],
      { 6: ['collab2@example.com'] }
    );
    const env = createEnv(db);

    const noSessionResponse = await publicRoutes.request('http://localhost/api/events/protected-collab/photos', {}, env);
    expect(noSessionResponse.status).toBe(401);

    const cookie = await createEventCookie('protected-collab', env.EVENT_COOKIE_SECRET);
    const cookieHeader = cookie.split(';')[0];
    const sessionResponse = await publicRoutes.request('http://localhost/api/events/protected-collab/photos', {
      headers: {
        Cookie: cookieHeader,
      },
    }, env);
    expect(sessionResponse.status).toBe(200);
  });

  it('blocks non-admin access to admin routes', async () => {
    const db = new MockD1Database(baseEvents, basePhotos, {});
    const env = createEnv(db);

    const noAuthResponse = await adminRoutes.request('http://localhost/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Test Event' }),
    }, env);
    expect(noAuthResponse.status).toBe(401);

    currentUser = { id: 'user-7', email: 'user7@example.com', name: 'User' };
    const notAdminResponse = await adminRoutes.request('http://localhost/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Test Event' }),
    }, env);
    expect(notAdminResponse.status).toBe(403);
  });

  it('requires authentication to remove favorites', async () => {
    const db = new MockD1Database(baseEvents, basePhotos, {});
    const env = createEnv(db);

    const noAuthResponse = await favoritesRoutes.request('http://localhost/api/favorites/photo-1', {
      method: 'DELETE',
    }, env);
    expect(noAuthResponse.status).toBe(401);
  });

  it('rejects adding favorites for missing photos', async () => {
    currentUser = { id: 'user-4', email: 'user4@example.com', name: 'User' };
    const db = new MockD1Database(baseEvents, basePhotos, {});
    const env = createEnv(db);

    const response = await favoritesRoutes.request('http://localhost/api/favorites/missing-photo', {
      method: 'POST',
    }, env);
    expect(response.status).toBe(404);
  });

  it('blocks ZIP download when password session is missing', async () => {
    const protectedEvent: EventRecord = {
      id: 7,
      slug: 'zip-protected',
      name: 'Zip Protected',
      inferred_date: '2024-01-07',
      created_at: '2024-01-07',
      visibility: 'public',
      password_hash: 'hash',
    };

    const protectedPhoto: PhotoRecord = {
      id: 'photo-7',
      event_id: 7,
      original_filename: 'zip.jpg',
      file_type: 'image/jpeg',
      capture_time: '2024-01-07T10:00:00Z',
      uploaded_at: '2024-01-07T10:00:00Z',
      uploaded_by: null,
      width: 1000,
      height: 800,
      iso: null,
      aperture: null,
      shutter_speed: null,
      focal_length: null,
      camera_make: null,
      camera_model: null,
      lens_model: null,
      latitude: null,
      longitude: null,
      favorites_count: 0,
      blur_placeholder: null,
      is_featured: 0,
      city: 'Delft',
    };

    const db = new MockD1Database([...baseEvents, protectedEvent], [...basePhotos, protectedPhoto], {});
    const env = createEnv(db);

    const response = await zipRoutes.request('http://localhost/api/events/zip-protected/zip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ photoIds: ['photo-7'] }),
    }, env);
    expect(response.status).toBe(401);
  });

  it('validates ZIP request payloads', async () => {
    const db = new MockD1Database(baseEvents, basePhotos, {});
    const env = createEnv(db);

    const emptyResponse = await zipRoutes.request('http://localhost/api/events/public-event/zip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ photoIds: [] }),
    }, env);
    expect(emptyResponse.status).toBe(400);

    const tooMany = Array.from({ length: 51 }, (_, index) => `photo-${index}`);
    const tooManyResponse = await zipRoutes.request('http://localhost/api/events/public-event/zip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ photoIds: tooMany }),
    }, env);
    expect(tooManyResponse.status).toBe(400);
  });

  it('rejects ZIP requests when photoIds do not belong to the event', async () => {
    const db = new MockD1Database(baseEvents, basePhotos, {});
    const env = createEnv(db);

    const response = await zipRoutes.request('http://localhost/api/events/public-event/zip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ photoIds: ['photo-2'] }),
    }, env);
    expect(response.status).toBe(400);
  });

  it('returns 404 when ZIP photos are missing in storage', async () => {
    const db = new MockD1Database(baseEvents, basePhotos, {});
    const missingKey = 'original/public-event/photo-1.jpg';
    const env = {
      ...createEnv(db),
      PHOTOS_BUCKET: createBucket(new Set([missingKey])) as unknown as R2Bucket,
    };

    const response = await zipRoutes.request('http://localhost/api/events/public-event/zip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ photoIds: ['photo-1'] }),
    }, env);
    expect(response.status).toBe(404);
  });

  it('allows ZIP download when photos are valid and accessible', async () => {
    const db = new MockD1Database(baseEvents, basePhotos, {});
    const env = createEnv(db);

    const response = await zipRoutes.request('http://localhost/api/events/public-event/zip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ photoIds: ['photo-1'] }),
    }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/zip');
  });

  it('logs collaboration history on invite and removal', async () => {
    currentUser = { id: 'admin-3', email: 'admin@example.com', name: 'Admin' };
    currentIsAdmin = true;
    const collaborators = { 1: ['collab@example.com'] };
    const db = new MockD1Database(baseEvents, basePhotos, collaborators);
    const env = createEnv(db);

    const inviteResponse = await collaboratorsRoutes.request('http://localhost/api/events/public-event/collaborators', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'new@example.com' }),
    }, env);
    expect(inviteResponse.status).toBe(200);
    expect(db.runLog.some(entry => entry.query.includes('INSERT INTO collaboration_history'))).toBe(true);

    const removeResponse = await collaboratorsRoutes.request('http://localhost/api/events/public-event/collaborators/collab@example.com', {
      method: 'DELETE',
    }, env);
    expect(removeResponse.status).toBe(200);
    const historyEntries = db.runLog.filter(entry => entry.query.includes('INSERT INTO collaboration_history'));
    expect(historyEntries.length).toBeGreaterThanOrEqual(2);
  });

  it('blocks direct media access to private event photos when requester is not admin', async () => {
    const db = new MockD1Database(baseEvents, basePhotos, {});
    const env = createEnv(db);

    const anonymousResponse = await mediaRoutes.request('http://localhost/media/private-event/preview/photo-2.jpg', {}, env);
    expect(anonymousResponse.status).toBe(401);

    currentUser = { id: 'user-10', email: 'viewer@example.com', name: 'Viewer' };
    const nonAdminResponse = await mediaRoutes.request('http://localhost/media/private-event/preview/photo-2.jpg', {}, env);
    expect(nonAdminResponse.status).toBe(403);
  });

  it('blocks direct media access to collaborators-only photos unless requester is collaborator or admin', async () => {
    const db = new MockD1Database(baseEvents, basePhotos, { 3: ['collab@example.com'] });
    const env = createEnv(db);

    currentUser = { id: 'user-11', email: 'outsider@example.com', name: 'Outsider' };
    const outsiderResponse = await mediaRoutes.request('http://localhost/media/collab-event/preview/photo-3.jpg', {}, env);
    expect(outsiderResponse.status).toBe(403);

    currentUser = { id: 'user-12', email: 'collab@example.com', name: 'Collaborator' };
    const collaboratorResponse = await mediaRoutes.request('http://localhost/media/collab-event/preview/photo-3.jpg', {}, env);
    expect(collaboratorResponse.status).toBe(200);
  });

  it('allows direct media access to private event photos for admins', async () => {
    currentUser = { id: 'admin-10', email: 'admin@example.com', name: 'Admin' };
    const db = new MockD1Database(baseEvents, basePhotos, {});
    const env = createEnv(db);

    const response = await mediaRoutes.request('http://localhost/media/private-event/original/photo-2.jpg', {}, env);
    expect(response.status).toBe(200);
  });
});
