import { beforeEach, describe, expect, it, vi } from 'vitest';
import mediaRoutes from '../routes/media';
import zipRoutes from '../routes/zip';
import { MockD1Database, type EventRecord, type PhotoRecord, type TestEnv } from './mocks';
import type { User } from '../types';

let currentUser: User | null = null;
let allowEventAuth = true;

vi.mock('../auth', () => {
  return {
    checkEventAuth: async () => allowEventAuth,
    extractUser: async () => currentUser,
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
    slug: 'password-event',
    name: 'Password Event',
    inferred_date: '2024-01-04',
    created_at: '2024-01-04',
    visibility: 'public',
    password_hash: 'hashed',
  },
];

const photos: PhotoRecord[] = [
  {
    id: 'photo-image',
    event_id: 1,
    original_filename: 'public.jpg',
    file_type: 'image/jpeg',
    capture_time: '2024-01-01T10:00:00.000Z',
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
    city: null,
  },
  {
    id: 'photo-video',
    event_id: 2,
    original_filename: 'private.mp4',
    file_type: 'video/mp4',
    capture_time: '2024-01-02T11:11:11.111Z',
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
    city: null,
  },
  {
    id: 'photo-nulltype',
    event_id: 2,
    original_filename: 'private-null.jpg',
    file_type: '',
    capture_time: '2024-01-02T14:14:14.000Z',
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
    city: null,
  },
  {
    id: 'photo-collab',
    event_id: 3,
    original_filename: 'collab.jpg',
    file_type: 'image/jpeg',
    capture_time: '2024-01-03T12:00:00.000Z',
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
    city: null,
  },
  {
    id: 'photo-copy',
    event_id: 1,
    original_filename: 'copy.jpg',
    file_type: 'image/jpeg',
    capture_time: '2024-01-01T13:00:00.000Z',
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
    city: null,
    source_photo_id: 'source-1',
    source_event_slug: 'source-event',
  },
];

function createBucket(missingKeys: Set<string> = new Set()) {
  return {
    get: async (key: string) => {
      if (missingKeys.has(key)) return null;
      return {
        body: 'ok',
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      };
    },
  };
}

function createEnv(db: any, missingKeys: Set<string> = new Set()): TestEnv {
  return {
    DB: db as D1Database,
    PHOTOS_BUCKET: createBucket(missingKeys) as unknown as R2Bucket,
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

describe('Security Route Coverage', () => {
  beforeEach(() => {
    allowEventAuth = true;
    currentUser = null;
  });

  it('covers preview auth denial, private denial, collaborator denial, and event not found', async () => {
    const db = new MockD1Database(events, photos, { 3: ['collab@example.com'] });
    const env = createEnv(db);

    allowEventAuth = false;
    const authDenied = await mediaRoutes.request('http://localhost/media/password-event/preview/photo-image.jpg', {}, env);
    expect(authDenied.status).toBe(401);

    allowEventAuth = true;
    const eventMissing = await mediaRoutes.request('http://localhost/media/missing/preview/photo-image.jpg', {}, env);
    expect(eventMissing.status).toBe(404);

    const privateNoUser = await mediaRoutes.request('http://localhost/media/private-event/preview/photo-video.mp4', {}, env);
    expect(privateNoUser.status).toBe(401);

    currentUser = { id: 'u1', email: 'viewer@example.com', name: 'Viewer' };
    const privateDenied = await mediaRoutes.request('http://localhost/media/private-event/preview/photo-video.mp4', {}, env);
    expect(privateDenied.status).toBe(403);

    const collabDenied = await mediaRoutes.request('http://localhost/media/collab-event/preview/photo-collab.jpg', {}, env);
    expect(collabDenied.status).toBe(403);
  });

  it('covers preview success paths including video and source photo resolution', async () => {
    const db = new MockD1Database(events, photos, { 3: ['collab@example.com'] });

    currentUser = { id: 'admin-1', email: 'admin@example.com', name: 'Admin' };
    const videoEnv = createEnv(db, new Set(['preview/private-event/photo-video.mp4']));
    const videoRes = await mediaRoutes.request('http://localhost/media/private-event/preview/photo-video.mp4', {}, videoEnv);
    expect(videoRes.status).toBe(200);
    expect(videoRes.headers.get('Content-Type')).toBe('video/mp4');

    const sourceEnv = createEnv(db);
    const sourceRes = await mediaRoutes.request('http://localhost/media/public-event/preview/photo-copy.jpg', {}, sourceEnv);
    expect(sourceRes.status).toBe(200);
    expect(sourceRes.headers.get('Content-Type')).toBe('image/jpeg');

    const fallbackTypePreview = await mediaRoutes.request('http://localhost/media/private-event/preview/photo-nulltype.jpg', {}, sourceEnv);
    expect(fallbackTypePreview.status).toBe(200);
    expect(fallbackTypePreview.headers.get('Content-Type')).toBe('image/jpeg');

    const missingEnv = createEnv(db, new Set([
      'preview/public-event/photo-image.jpg',
      'original/public-event/photo-image.jpg',
    ]));
    const missingRes = await mediaRoutes.request('http://localhost/media/public-event/preview/photo-image.jpg', {}, missingEnv);
    expect(missingRes.status).toBe(404);

    const photoMissingRes = await mediaRoutes.request('http://localhost/media/public-event/preview/missing.jpg', {}, sourceEnv);
    expect(photoMissingRes.status).toBe(404);
  });

  it('covers IG endpoint success/fallback/not-found', async () => {
    const db = new MockD1Database(events, photos, { 3: ['collab@example.com'] });
    const env = createEnv(db, new Set(['preview/public-event/photo-image.jpg']));

    const igRes = await mediaRoutes.request('http://localhost/media/public-event/ig/photo-image.jpg', {}, env);
    expect(igRes.status).toBe(200);
    expect(igRes.headers.get('Content-Disposition')).toContain('public-event_');

    const notFound = await mediaRoutes.request('http://localhost/media/public-event/ig/missing.jpg', {}, env);
    expect(notFound.status).toBe(404);

    const missingEvent = await mediaRoutes.request('http://localhost/media/unknown/ig/photo-image.jpg', {}, env);
    expect(missingEvent.status).toBe(404);

    const missingEverywhereEnv = createEnv(db, new Set([
      'preview/public-event/photo-image.jpg',
      'original/public-event/photo-image.jpg',
    ]));
    const noStorage = await mediaRoutes.request('http://localhost/media/public-event/ig/photo-image.jpg', {}, missingEverywhereEnv);
    expect(noStorage.status).toBe(404);

    const directPreviewHit = await mediaRoutes.request('http://localhost/media/public-event/ig/photo-copy.jpg', {}, createEnv(db));
    expect(directPreviewHit.status).toBe(200);

    allowEventAuth = false;
    const authDenied = await mediaRoutes.request('http://localhost/media/password-event/ig/photo-image.jpg', {}, env);
    expect(authDenied.status).toBe(401);
  });

  it('covers non-admin behavior when ADMIN_EMAILS is unset', async () => {
    const db = new MockD1Database(events, photos, { 3: ['collab@example.com'] });
    const env = {
      ...createEnv(db),
      ADMIN_EMAILS: undefined as unknown as string,
    };

    currentUser = { id: 'u-no-admin', email: 'admin@example.com', name: 'Admin Name Only' };

    const privateMedia = await mediaRoutes.request('http://localhost/media/private-event/preview/photo-video.mp4', {}, env);
    expect(privateMedia.status).toBe(403);

    const privateZip = await zipRoutes.request('http://localhost/api/events/private-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-video'] }),
    }, env);
    expect(privateZip.status).toBe(403);
  });

  it('covers original endpoint success, missing storage, and missing photo', async () => {
    const db = new MockD1Database(events, photos, {});
    const adminEnv = createEnv(db);
    currentUser = { id: 'a1', email: 'admin@example.com', name: 'Admin' };

    const originalVideo = await mediaRoutes.request('http://localhost/media/private-event/original/photo-video.mp4', {}, adminEnv);
    expect(originalVideo.status).toBe(200);
    expect(originalVideo.headers.get('Content-Type')).toBe('video/mp4');

    const missingStorageEnv = createEnv(db, new Set(['original/private-event/photo-video.mp4']));
    const missingStorage = await mediaRoutes.request('http://localhost/media/private-event/original/photo-video.mp4', {}, missingStorageEnv);
    expect(missingStorage.status).toBe(404);

    const missingPhoto = await mediaRoutes.request('http://localhost/media/private-event/original/missing.mp4', {}, adminEnv);
    expect(missingPhoto.status).toBe(404);

    const missingEvent = await mediaRoutes.request('http://localhost/media/unknown/original/photo-video.mp4', {}, adminEnv);
    expect(missingEvent.status).toBe(404);

    const fallbackType = await mediaRoutes.request('http://localhost/media/private-event/original/photo-nulltype.jpg', {}, adminEnv);
    expect(fallbackType.status).toBe(200);
    expect(fallbackType.headers.get('Content-Type')).toBe('image/jpeg');

    allowEventAuth = false;
    const authDenied = await mediaRoutes.request('http://localhost/media/password-event/original/photo-image.jpg', {}, adminEnv);
    expect(authDenied.status).toBe(401);
  });

  it('covers media route error handlers', async () => {
    const env = createEnv({
      prepare: () => {
        throw new Error('db-fail');
      },
    });

    const previewError = await mediaRoutes.request('http://localhost/media/public-event/preview/photo-image.jpg', {}, env);
    expect(previewError.status).toBe(500);

    const igError = await mediaRoutes.request('http://localhost/media/public-event/ig/photo-image.jpg', {}, env);
    expect(igError.status).toBe(500);

    const originalError = await mediaRoutes.request('http://localhost/media/public-event/original/photo-image.jpg', {}, env);
    expect(originalError.status).toBe(500);
  });

  it('covers zip auth denial and collaborator denial branches', async () => {
    const db = new MockD1Database(events, photos, { 3: ['collab@example.com'] });
    const env = createEnv(db);

    allowEventAuth = false;
    const authDenied = await zipRoutes.request('http://localhost/api/events/password-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-image'] }),
    }, env);
    expect(authDenied.status).toBe(401);

    allowEventAuth = true;
    const privateNoUser = await zipRoutes.request('http://localhost/api/events/private-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-video'] }),
    }, env);
    expect(privateNoUser.status).toBe(401);

    currentUser = { id: 'u2', email: 'viewer@example.com', name: 'Viewer' };
    const privateDenied = await zipRoutes.request('http://localhost/api/events/private-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-video'] }),
    }, env);
    expect(privateDenied.status).toBe(403);

    const collabDenied = await zipRoutes.request('http://localhost/api/events/collab-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-collab'] }),
    }, env);
    expect(collabDenied.status).toBe(403);

    currentUser = { id: 'admin-zip', email: 'admin@example.com', name: 'Admin' };
    const adminAllowed = await zipRoutes.request('http://localhost/api/events/private-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-video'] }),
    }, env);
    expect(adminAllowed.status).toBe(200);

    currentUser = { id: 'collab-zip', email: 'collab@example.com', name: 'Collab' };
    const collabAllowed = await zipRoutes.request('http://localhost/api/events/collab-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-collab'] }),
    }, env);
    expect(collabAllowed.status).toBe(200);

    const collabMediaAllowed = await mediaRoutes.request('http://localhost/media/collab-event/preview/photo-collab.jpg', {}, env);
    expect(collabMediaAllowed.status).toBe(200);
  });

  it('covers zip request validation and missing event branches', async () => {
    const db = new MockD1Database(events, photos, { 3: ['collab@example.com'] });
    const env = createEnv(db);

    const missingEvent = await zipRoutes.request('http://localhost/api/events/missing/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-image'] }),
    }, env);
    expect(missingEvent.status).toBe(404);

    const emptyIds = await zipRoutes.request('http://localhost/api/events/public-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: [] }),
    }, env);
    expect(emptyIds.status).toBe(400);

    const missingIds = await zipRoutes.request('http://localhost/api/events/public-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }, env);
    expect(missingIds.status).toBe(400);

    const tooMany = await zipRoutes.request('http://localhost/api/events/public-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: Array.from({ length: 51 }, (_, i) => `p-${i}`) }),
    }, env);
    expect(tooMany.status).toBe(400);

    const mismatch = await zipRoutes.request('http://localhost/api/events/public-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['missing-photo'] }),
    }, env);
    expect(mismatch.status).toBe(400);
  });

  it('covers zip success, source resolution, missing storage, and parse errors', async () => {
    const db = new MockD1Database(events, photos, { 3: ['collab@example.com'] });
    const env = createEnv(db, new Set(['original/public-event/photo-image.jpg']));

    const missingStorage = await zipRoutes.request('http://localhost/api/events/public-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-image'] }),
    }, env);
    expect(missingStorage.status).toBe(404);

    const successEnv = createEnv(db);
    const success = await zipRoutes.request('http://localhost/api/events/public-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-copy'] }),
    }, successEnv);
    expect(success.status).toBe(200);
    expect(success.headers.get('Content-Type')).toBe('application/zip');
    expect(success.headers.get('Content-Disposition')).toContain('public-event_');

    const parseError = await zipRoutes.request('http://localhost/api/events/public-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    }, successEnv);
    expect(parseError.status).toBe(500);

    const errorEnv = createEnv({
      prepare: () => {
        throw new Error('db-fail');
      },
    });
    const fatal = await zipRoutes.request('http://localhost/api/events/public-event/zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoIds: ['photo-image'] }),
    }, errorEnv);
    expect(fatal.status).toBe(500);
  });
});
