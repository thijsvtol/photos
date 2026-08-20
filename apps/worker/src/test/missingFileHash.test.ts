import { describe, it, expect, vi } from 'vitest';

// Same auth-bypass pattern as adminPhotosPeopleTag.test.ts — this test only exercises the
// route's HTTP-layer wiring (request/response shape, WHERE guards), not any client-side hashing.
vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>();
  return {
    ...actual,
    extractUser: async () => ({ id: 'u1', email: 'admin@example.com' }),
    isUserAdmin: () => true,
    hasEventCapabilityByEventId: async () => true,
  };
});

vi.mock('../faceClustering', () => ({
  setManualPhotoPersonTags: vi.fn(),
  getPhotoPeople: vi.fn(),
  addManualPhotoPersonTags: vi.fn(),
  removePersonFromPhoto: vi.fn(),
  syncPeopleAcrossDuplicates: vi.fn(),
}));

import photosRouter from '../routes/admin/photos';

interface FakePhoto {
  id: string;
  file_hash: string | null;
  file_type: string;
  event_slug: string;
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
        async all<T>() {
          if (query.includes('FROM photos p') && query.includes('p.file_hash IS NULL')) {
            const hasCursor = query.includes('AND p.id > ?');
            const cursor = hasCursor ? (boundArgs[0] as string) : null;
            const results = photos
              .filter((p) => !p.file_hash)
              .filter((p) => !cursor || p.id > cursor)
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((p) => ({ id: p.id, file_type: p.file_type, cache_version: 1, event_slug: p.event_slug }));
            return { results: results as T[] };
          }
          return { results: [] as T[] };
        },
        async first<T>() {
          return null as T | null;
        },
        async run() {
          if (query.includes('UPDATE photos SET file_hash = ? WHERE id = ? AND file_hash IS NULL')) {
            const [fileHash, id] = boundArgs as [string, string];
            const photo = photos.find((p) => p.id === id);
            if (photo && !photo.file_hash) {
              photo.file_hash = fileHash;
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };
  return { DB: db } as any;
}

describe('GET /admin/photos/missing-file-hash', () => {
  it('returns every media type (photos, RAW AND videos) without a file_hash, paginated', async () => {
    const photos: FakePhoto[] = [
      { id: 'a', file_hash: null, file_type: 'image/jpeg', event_slug: 'evil8' },
      { id: 'b', file_hash: 'already-set', file_type: 'image/jpeg', event_slug: 'evil8' },
      { id: 'c', file_hash: null, file_type: 'video/mp4', event_slug: 'evil8' },
      { id: 'd', file_hash: null, file_type: 'image/jpeg', event_slug: 'tbt' },
    ];
    const env = createFakeEnv(photos);

    const res = await photosRouter.fetch(new Request('http://test/missing-file-hash?limit=50'), env);
    const body = await res.json() as { photos: { id: string }[]; nextCursor: string | null };

    // Video 'c' is now INCLUDED (duplicate videos can be backfilled/detected); only 'b' (already
    // hashed) is skipped.
    expect(body.photos.map((p) => p.id)).toEqual(['a', 'c', 'd']);
    expect(body.nextCursor).toBeNull();
  });
});

describe('PATCH /admin/photos/:photoId/file-hash', () => {
  it('sets file_hash when currently null', async () => {
    const photos: FakePhoto[] = [{ id: 'a', file_hash: null, file_type: 'image/jpeg', event_slug: 'evil8' }];
    const env = createFakeEnv(photos);

    const res = await photosRouter.fetch(
      new Request('http://test/a/file-hash', {
        method: 'PATCH',
        body: JSON.stringify({ fileHash: 'abc123' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env
    );
    const body = await res.json() as { success: boolean; updated: boolean };

    expect(body).toEqual({ success: true, updated: true });
    expect(photos[0].file_hash).toBe('abc123');
  });

  it('never overwrites an already-set file_hash', async () => {
    const photos: FakePhoto[] = [{ id: 'a', file_hash: 'existing', file_type: 'image/jpeg', event_slug: 'evil8' }];
    const env = createFakeEnv(photos);

    const res = await photosRouter.fetch(
      new Request('http://test/a/file-hash', {
        method: 'PATCH',
        body: JSON.stringify({ fileHash: 'new-value' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env
    );
    const body = await res.json() as { success: boolean; updated: boolean };

    expect(body).toEqual({ success: true, updated: false });
    expect(photos[0].file_hash).toBe('existing');
  });

  it('returns 400 when fileHash is missing', async () => {
    const env = createFakeEnv([]);
    const res = await photosRouter.fetch(
      new Request('http://test/a/file-hash', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }),
      env
    );
    expect(res.status).toBe(400);
  });
});
