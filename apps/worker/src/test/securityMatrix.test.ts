import { beforeEach, describe, expect, it, vi } from 'vitest';
import mediaRoutes from '../routes/media';
import publicRoutes from '../routes/public';
import zipRoutes from '../routes/zip';
import type { User } from '../types';
import {
  MockD1Database,
  createBucket,
  type EventRecord,
  type PhotoRecord,
  type TestEnv,
} from './mocks';

let currentUser: User | null = null;
let currentIsAdmin = false;

vi.mock('../auth', () => {
  return {
    optionalAuth: async (c: any, next: any) => {
      if (currentUser) c.set('user', currentUser);
      await next();
    },
    extractUser: async () => currentUser,
    getUser: (c: any) => c.get('user') || null,
    isAdmin: () => currentIsAdmin,
    checkEventAuth: async (_c: any, _eventSlug: string, hasPassword: boolean) => {
      if (!hasPassword) return true;
      return false;
    },
  };
});

const events: EventRecord[] = [
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

const photos: PhotoRecord[] = [
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

describe('Security Regression Matrix', () => {
  beforeEach(() => {
    currentUser = null;
    currentIsAdmin = false;
  });

  it('denies anonymous access to private direct endpoints (media, photo detail, zip)', async () => {
    const db = new MockD1Database(events, photos, { 3: ['collab@example.com'] });
    const env = createEnv(db);

    const mediaRes = await mediaRoutes.request('http://localhost/media/private-event/preview/photo-2.jpg', {}, env);
    expect([401, 403]).toContain(mediaRes.status);

    const photoDetailRes = await publicRoutes.request('http://localhost/api/events/private-event/photos/photo-2', {}, env);
    expect([401, 403]).toContain(photoDetailRes.status);

    const zipRes = await zipRoutes.request('http://localhost/api/events/private-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-2'] }),
    }, env);
    expect([401, 403]).toContain(zipRes.status);
  });

  it('allows collaborator on assigned collaborators-only event and blocks other collaborators-only event', async () => {
    currentUser = { id: 'collab-1', email: 'collab@example.com', name: 'Collab' };
    const db = new MockD1Database(events, photos, { 3: ['collab@example.com'] });
    const env = createEnv(db);

    const allowedMedia = await mediaRoutes.request('http://localhost/media/collab-event/preview/photo-3.jpg', {}, env);
    expect(allowedMedia.status).toBe(200);

    const blockedMedia = await mediaRoutes.request('http://localhost/media/collab-event-2/preview/photo-3.jpg', {}, env);
    expect(blockedMedia.status).toBe(403);

    const allowedZip = await zipRoutes.request('http://localhost/api/events/collab-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-3'] }),
    }, env);
    expect(allowedZip.status).toBe(200);
  });

  it('allows admin access to private media and zip endpoints', async () => {
    currentUser = { id: 'admin-1', email: 'admin@example.com', name: 'Admin' };
    currentIsAdmin = true;

    const db = new MockD1Database(events, photos, {});
    const env = createEnv(db);

    const mediaRes = await mediaRoutes.request('http://localhost/media/private-event/original/photo-2.jpg', {}, env);
    expect(mediaRes.status).toBe(200);

    const zipRes = await zipRoutes.request('http://localhost/api/events/private-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-2'] }),
    }, env);
    expect(zipRes.status).toBe(200);
  });
});
