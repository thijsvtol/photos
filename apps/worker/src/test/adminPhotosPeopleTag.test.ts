import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same auth-bypass pattern as adminPhotosTrash.test.ts — this test only exercises the route's
// HTTP-layer wiring (permission checks, request validation, response shape), not the actual
// I/O implementations (covered by photoPeopleTags.test.ts).
let currentUser: { id: string; email: string; name?: string } | null = { id: 'u1', email: 'admin@example.com' };
let currentIsAdmin = true;
let currentHasCapability = true;

vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>();
  return {
    ...actual,
    extractUser: async () => currentUser,
    isUserAdmin: () => currentIsAdmin,
    hasEventCapabilityByEventId: async () => currentHasCapability,
  };
});

const setManualPhotoPersonTagsMock = vi.fn();
const getPhotoPeopleMock = vi.fn();

vi.mock('../faceClustering', () => ({
  setManualPhotoPersonTags: (...args: unknown[]) => setManualPhotoPersonTagsMock(...args),
  getPhotoPeople: (...args: unknown[]) => getPhotoPeopleMock(...args),
}));

import photosRouter from '../routes/admin/photos';

interface FakePhoto {
  id: string;
  event_id: number;
}

function createFakeEnv(photos: FakePhoto[]) {
  const db = {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async first<T>() {
          if (query.includes('SELECT event_id FROM photos WHERE id = ?')) {
            const [id] = boundArgs as [string];
            const photo = photos.find((p) => p.id === id);
            return (photo ? { event_id: photo.event_id } : null) as T | null;
          }
          return null as T | null;
        },
        async run() {
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };
  return { DB: db as unknown as D1Database, ADMIN_EMAILS: 'admin@example.com' } as any;
}

beforeEach(() => {
  currentUser = { id: 'u1', email: 'admin@example.com' };
  currentIsAdmin = true;
  currentHasCapability = true;
  setManualPhotoPersonTagsMock.mockReset();
  getPhotoPeopleMock.mockReset();
  getPhotoPeopleMock.mockResolvedValue([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]);
});

describe('PUT /admin/photos/:photoId/people', () => {
  it('replaces the manual tag set and returns the updated combined people list', async () => {
    const photos: FakePhoto[] = [{ id: 'p1', event_id: 1 }];

    const res = await photosRouter.request(
      'http://localhost/p1/people',
      { method: 'PUT', body: JSON.stringify({ personIds: [1, 2] }), headers: { 'Content-Type': 'application/json' } },
      createFakeEnv(photos)
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; people: { id: number; name: string }[] };
    expect(body.success).toBe(true);
    expect(body.people).toEqual([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]);
    expect(setManualPhotoPersonTagsMock).toHaveBeenCalledWith(expect.anything(), 'p1', [1, 2]);
  });

  it('returns 400 when personIds is missing or not an array of numbers', async () => {
    const photos: FakePhoto[] = [{ id: 'p1', event_id: 1 }];

    const res = await photosRouter.request(
      'http://localhost/p1/people',
      { method: 'PUT', body: JSON.stringify({ personIds: ['not-a-number'] }), headers: { 'Content-Type': 'application/json' } },
      createFakeEnv(photos)
    );

    expect(res.status).toBe(400);
    expect(setManualPhotoPersonTagsMock).not.toHaveBeenCalled();
  });

  it('returns 400 when more than 50 people are tagged at once', async () => {
    const photos: FakePhoto[] = [{ id: 'p1', event_id: 1 }];
    const tooMany = Array.from({ length: 51 }, (_, i) => i);

    const res = await photosRouter.request(
      'http://localhost/p1/people',
      { method: 'PUT', body: JSON.stringify({ personIds: tooMany }), headers: { 'Content-Type': 'application/json' } },
      createFakeEnv(photos)
    );

    expect(res.status).toBe(400);
    expect(setManualPhotoPersonTagsMock).not.toHaveBeenCalled();
  });

  it('returns 404 for a photo that does not exist', async () => {
    const res = await photosRouter.request(
      'http://localhost/missing/people',
      { method: 'PUT', body: JSON.stringify({ personIds: [1] }), headers: { 'Content-Type': 'application/json' } },
      createFakeEnv([])
    );

    expect(res.status).toBe(404);
  });

  it('returns 403 when the user lacks image_edit capability for the event', async () => {
    currentIsAdmin = false;
    currentHasCapability = false;
    const photos: FakePhoto[] = [{ id: 'p1', event_id: 1 }];

    const res = await photosRouter.request(
      'http://localhost/p1/people',
      { method: 'PUT', body: JSON.stringify({ personIds: [1] }), headers: { 'Content-Type': 'application/json' } },
      createFakeEnv(photos)
    );

    expect(res.status).toBe(403);
    expect(setManualPhotoPersonTagsMock).not.toHaveBeenCalled();
  });
});
