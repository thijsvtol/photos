import { describe, expect, it, vi } from 'vitest';

/**
 * Tests for the `people` filter added to GET /api/search and GET /api/events/:slug/photos
 * (routes/public.ts) — requires a photo to contain EVERY given person (AND, not OR), combining
 * both automatically-detected faces (photo_faces) and manually-tagged photos
 * (photo_person_tags), same union used elsewhere in this feature (e.g. getPhotoPeople() in
 * apps/worker/src/faceClustering.ts).
 */

vi.mock('../auth', () => ({
  optionalAuth: async (c: any, next: any) => {
    await next();
  },
  getUser: () => null,
  isAdmin: () => false,
  getCollaboratorRoleByEventId: async () => null,
  hasEventSessionAccess: async () => true,
}));

vi.mock('../aiEnrichment', () => ({
  embedSearchQuery: async () => null,
  cosineSimilarity: () => 0,
}));

import publicRoutes from '../routes/public';

interface FakeFace {
  photo_id: string;
  person_id: number;
}
interface FakeTag {
  photo_id: string;
  person_id: number;
}
interface FakePhoto {
  id: string;
  event_id: number;
  original_filename: string;
}

function makeEnv(photos: FakePhoto[], faces: FakeFace[], tags: FakeTag[]) {
  const events = [{ id: 1, slug: 'evt', name: 'Event', visibility: 'public', password_hash: null }];

  const db = {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async all() {
          if (query.includes('FROM events e') && query.includes('LEFT JOIN event_collaborators')) {
            return { results: events };
          }
          if (query.includes('FROM photo_faces') && query.includes('UNION') && query.includes('GROUP BY photo_id') && !query.includes('FROM photos p')) {
            // Replicates: photos where COUNT(DISTINCT person_id) across faces+tags == N.
            const n = boundArgs[boundArgs.length - 1] as number;
            const half = (boundArgs.length - 1) / 2;
            const personIds = boundArgs.slice(0, half) as number[];
            const pairs = [
              ...faces.filter((f) => personIds.includes(f.person_id)),
              ...tags.filter((t) => personIds.includes(t.person_id)),
            ];
            const byPhoto = new Map<string, Set<number>>();
            for (const p of pairs) {
              if (!byPhoto.has(p.photo_id)) byPhoto.set(p.photo_id, new Set());
              byPhoto.get(p.photo_id)!.add(p.person_id);
            }
            const matching = [...byPhoto.entries()].filter(([, ids]) => ids.size === n).map(([photoId]) => ({ photo_id: photoId }));
            return { results: matching };
          }
          if (query.includes('FROM photos p') && query.includes('WHERE p.id IN')) {
            // People-only search path (no text query) in /api/search.
            const idCount = query.match(/WHERE p\.id IN \(([^)]*)\)/)?.[1].split(',').length || 0;
            const ids = boundArgs.slice(0, idCount) as string[];
            const results = photos.filter((p) => ids.includes(p.id)).map((p) => ({
              id: p.id, event_id: p.event_id, original_filename: p.original_filename,
              file_type: 'image/jpeg', capture_time: '2024-01-01T00:00:00Z', width: 100, height: 100,
              blur_placeholder: null, cache_version: 1, ai_caption: null, embedding: null,
            }));
            return { results };
          }
          if (query.includes('FROM photos p') && query.includes('LEFT JOIN users u') && query.includes('WHERE p.event_id = ?')) {
            // GET /api/events/:slug/photos
            const [eventId] = boundArgs as [number];
            let results = photos.filter((p) => p.event_id === eventId);
            if (query.includes('AND p.id IN')) {
              const n = boundArgs[boundArgs.length - 1] as number;
              const half = (boundArgs.length - 2) / 2;
              const personIds = boundArgs.slice(1, 1 + half) as number[];
              const pairs = [
                ...faces.filter((f) => personIds.includes(f.person_id)),
                ...tags.filter((t) => personIds.includes(t.person_id)),
              ];
              const byPhoto = new Map<string, Set<number>>();
              for (const p of pairs) {
                if (!byPhoto.has(p.photo_id)) byPhoto.set(p.photo_id, new Set());
                byPhoto.get(p.photo_id)!.add(p.person_id);
              }
              const matchingIds = new Set([...byPhoto.entries()].filter(([, ids]) => ids.size === n).map(([photoId]) => photoId));
              results = results.filter((p) => matchingIds.has(p.id));
            }
            return {
              results: results.map((p) => ({
                id: p.id, original_filename: p.original_filename, file_type: 'image/jpeg',
                capture_time: '2024-01-01T00:00:00Z', width: 100, height: 100, blur_placeholder: null,
                cache_version: 1, uploader_name: null,
              })),
            };
          }
          if (query.includes('photos_fts MATCH ?')) {
            return { results: [] };
          }
          return { results: [] };
        },
        async first() {
          if (query.includes('SELECT id, password_hash, visibility FROM events')) {
            return events[0];
          }
          return null;
        },
        async run() {
          return { success: true };
        },
      };
      return stmt;
    },
  };

  return { DB: db as unknown as D1Database } as any;
}

describe('GET /api/search people filter', () => {
  it('requires ALL given people to be in the photo (AND, not OR)', async () => {
    const photos = [
      { id: 'both', event_id: 1, original_filename: 'both.jpg' },
      { id: 'only-1', event_id: 1, original_filename: 'only1.jpg' },
      { id: 'only-2', event_id: 1, original_filename: 'only2.jpg' },
    ];
    const faces = [
      { photo_id: 'both', person_id: 1 },
      { photo_id: 'both', person_id: 2 },
      { photo_id: 'only-1', person_id: 1 },
      { photo_id: 'only-2', person_id: 2 },
    ];
    const env = makeEnv(photos, faces, []);

    const res = await publicRoutes.request('http://localhost/api/search?people=1,2', {}, env);
    const body = await res.json() as { photos: Array<{ id: string }> };

    expect(res.status).toBe(200);
    expect(body.photos.map((p) => p.id)).toEqual(['both']);
  });

  it('combines automatically-detected faces AND manual tags for the same person', async () => {
    const photos = [{ id: 'tagged-only', event_id: 1, original_filename: 'x.jpg' }];
    const tags = [{ photo_id: 'tagged-only', person_id: 5 }];
    const env = makeEnv(photos, [], tags);

    const res = await publicRoutes.request('http://localhost/api/search?people=5', {}, env);
    const body = await res.json() as { photos: Array<{ id: string }> };

    expect(body.photos.map((p) => p.id)).toEqual(['tagged-only']);
  });

  it('returns empty results when no photo matches all given people', async () => {
    const env = makeEnv([], [], []);
    const res = await publicRoutes.request('http://localhost/api/search?people=1,2', {}, env);
    const body = await res.json() as { photos: unknown[] };
    expect(body.photos).toEqual([]);
  });

  it('returns empty results with no query and no people filter (unchanged existing behavior)', async () => {
    const env = makeEnv([], [], []);
    const res = await publicRoutes.request('http://localhost/api/search', {}, env);
    const body = await res.json() as { photos: unknown[] };
    expect(body.photos).toEqual([]);
  });
});

describe('GET /api/events/:slug/photos people filter', () => {
  it('requires ALL given people to be in the photo, scoped to this event', async () => {
    const photos = [
      { id: 'both', event_id: 1, original_filename: 'both.jpg' },
      { id: 'only-1', event_id: 1, original_filename: 'only1.jpg' },
    ];
    const faces = [
      { photo_id: 'both', person_id: 1 },
      { photo_id: 'both', person_id: 2 },
      { photo_id: 'only-1', person_id: 1 },
    ];
    const env = makeEnv(photos, faces, []);

    const res = await publicRoutes.request('http://localhost/api/events/evt/photos?people=1,2', {}, env);
    const body = await res.json() as { photos: Array<{ id: string }> };

    expect(res.status).toBe(200);
    expect(body.photos.map((p) => p.id)).toEqual(['both']);
  });

  it('returns every photo when no people filter is given (unchanged existing behavior)', async () => {
    const photos = [
      { id: 'a', event_id: 1, original_filename: 'a.jpg' },
      { id: 'b', event_id: 1, original_filename: 'b.jpg' },
    ];
    const env = makeEnv(photos, [], []);

    const res = await publicRoutes.request('http://localhost/api/events/evt/photos', {}, env);
    const body = await res.json() as { photos: Array<{ id: string }> };

    expect(body.photos.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });
});
