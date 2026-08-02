import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bypass Cloudflare Access JWT parsing for this route-logic test — permission
// middleware itself is covered by auth.test.ts/accessControl.test.ts. Each
// test controls `currentUser`/`currentIsAdmin` to exercise both the
// admin-bypass and the per-event-capability-check paths.
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

import photosRouter from '../routes/admin/photos';

interface FakePhoto {
  id: string;
  event_id: number;
  slug: string;
  deleted_at: string | null;
  source_photo_id: string | null;
}

function createFakeEnv(photos: FakePhoto[]) {
  const activityInserts: unknown[][] = [];
  const deletedR2Keys: string[] = [];
  const deletedDbIds: string[] = [];
  let deletedAtUpdateCount = 0;

  const db = {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async first<T>() {
          if (query.includes('SELECT id, event_id, deleted_at FROM photos WHERE id = ?')) {
            const [id] = boundArgs as [string];
            const photo = photos.find((p) => p.id === id);
            return (photo ? { id: photo.id, event_id: photo.event_id, deleted_at: photo.deleted_at } : null) as T | null;
          }
          if (query.includes('SELECT id, event_id FROM photos WHERE id = ?')) {
            const [id] = boundArgs as [string];
            const photo = photos.find((p) => p.id === id);
            return (photo ? { id: photo.id, event_id: photo.event_id } : null) as T | null;
          }
          if (query.includes('FROM photos p') && query.includes('JOIN events e') && query.includes('WHERE p.id = ?')) {
            const [id] = boundArgs as [string];
            const photo = photos.find((p) => p.id === id);
            return (photo
              ? { id: photo.id, event_id: photo.event_id, source_photo_id: photo.source_photo_id, slug: photo.slug }
              : null) as T | null;
          }
          return null as T | null;
        },
        async run() {
          if (query.includes("UPDATE photos SET deleted_at = datetime('now')")) {
            const [id] = boundArgs as [string];
            const photo = photos.find((p) => p.id === id);
            if (photo) photo.deleted_at = '2024-06-01 00:00:00';
            deletedAtUpdateCount++;
          }
          if (query.includes('UPDATE photos SET deleted_at = NULL WHERE id = ?')) {
            const [id] = boundArgs as [string];
            const photo = photos.find((p) => p.id === id);
            if (photo) photo.deleted_at = null;
          }
          if (query.includes('DELETE FROM photos WHERE id IN')) {
            deletedDbIds.push(...(boundArgs as string[]));
          }
          if (query.includes('INSERT INTO activity_log')) {
            activityInserts.push(boundArgs);
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };

  const bucket = {
    delete: async (key: string) => {
      deletedR2Keys.push(key);
    },
  };

  return { db, bucket, activityInserts, deletedR2Keys, deletedDbIds, getDeletedAtUpdateCount: () => deletedAtUpdateCount };
}

function makeEnv(fake: ReturnType<typeof createFakeEnv>) {
  return { DB: fake.db as unknown as D1Database, PHOTOS_BUCKET: fake.bucket as unknown as R2Bucket, ADMIN_EMAILS: 'admin@example.com' } as any;
}

beforeEach(() => {
  currentUser = { id: 'u1', email: 'admin@example.com' };
  currentIsAdmin = true;
  currentHasCapability = true;
});

describe('DELETE /photos/:photoId (soft delete / move to Trash)', () => {
  it('sets deleted_at and does NOT touch R2', async () => {
    const photos: FakePhoto[] = [{ id: 'p1', event_id: 1, slug: 'evt', deleted_at: null, source_photo_id: null }];
    const fake = createFakeEnv(photos);

    const res = await photosRouter.request('http://localhost/p1', { method: 'DELETE' }, makeEnv(fake));

    expect(res.status).toBe(200);
    expect(photos[0].deleted_at).not.toBeNull();
    expect(fake.deletedR2Keys).toHaveLength(0);
    expect(fake.getDeletedAtUpdateCount()).toBe(1);
  });

  it('logs a photo_trash activity entry only the first time', async () => {
    const photos: FakePhoto[] = [{ id: 'p1', event_id: 1, slug: 'evt', deleted_at: null, source_photo_id: null }];
    const fake = createFakeEnv(photos);

    await photosRouter.request('http://localhost/p1', { method: 'DELETE' }, makeEnv(fake));
    // Calling delete again on an already-trashed photo must be a no-op
    // (no duplicate activity log entry, no duplicate DB update).
    await photosRouter.request('http://localhost/p1', { method: 'DELETE' }, makeEnv(fake));

    expect(fake.activityInserts).toHaveLength(1);
    expect(fake.getDeletedAtUpdateCount()).toBe(1);
  });

  it('returns 403 when the user lacks photo_delete capability for the event', async () => {
    currentIsAdmin = false;
    currentHasCapability = false;
    const photos: FakePhoto[] = [{ id: 'p1', event_id: 1, slug: 'evt', deleted_at: null, source_photo_id: null }];
    const fake = createFakeEnv(photos);

    const res = await photosRouter.request('http://localhost/p1', { method: 'DELETE' }, makeEnv(fake));

    expect(res.status).toBe(403);
    expect(photos[0].deleted_at).toBeNull();
  });

  it('returns 404 for a photo that does not exist', async () => {
    const fake = createFakeEnv([]);
    const res = await photosRouter.request('http://localhost/missing', { method: 'DELETE' }, makeEnv(fake));
    expect(res.status).toBe(404);
  });
});

describe('PUT /photos/:photoId/restore', () => {
  it('clears deleted_at', async () => {
    const photos: FakePhoto[] = [{ id: 'p1', event_id: 1, slug: 'evt', deleted_at: '2024-06-01 00:00:00', source_photo_id: null }];
    const fake = createFakeEnv(photos);

    const res = await photosRouter.request('http://localhost/p1/restore', { method: 'PUT' }, makeEnv(fake));

    expect(res.status).toBe(200);
    expect(photos[0].deleted_at).toBeNull();
  });
});

describe('DELETE /photos/:photoId/permanent', () => {
  it('deletes R2 objects and the DB row for a non-copied photo', async () => {
    const photos: FakePhoto[] = [{ id: 'p1', event_id: 1, slug: 'evt', deleted_at: '2024-06-01 00:00:00', source_photo_id: null }];
    const fake = createFakeEnv(photos);

    const res = await photosRouter.request('http://localhost/p1/permanent', { method: 'DELETE' }, makeEnv(fake));

    expect(res.status).toBe(200);
    expect(fake.deletedR2Keys.length).toBeGreaterThan(0);
    expect(fake.deletedDbIds).toContain('p1');
  });

  it('does not delete R2 objects for a copied photo (source_photo_id set)', async () => {
    const photos: FakePhoto[] = [{ id: 'copy-1', event_id: 1, slug: 'evt', deleted_at: '2024-06-01 00:00:00', source_photo_id: 'original-1' }];
    const fake = createFakeEnv(photos);

    const res = await photosRouter.request('http://localhost/copy-1/permanent', { method: 'DELETE' }, makeEnv(fake));

    expect(res.status).toBe(200);
    expect(fake.deletedR2Keys).toHaveLength(0);
    expect(fake.deletedDbIds).toContain('copy-1');
  });
});
