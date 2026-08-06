import { describe, expect, it, vi } from 'vitest';

/**
 * Regression test for a real production bug (2026-08-06): GET /api/search's people-only path
 * used to bind BOTH the people-filtered photo id chunk AND the full accessible-event id list in
 * the SAME prepared statement (`WHERE p.id IN (...) AND p.event_id IN (...)`). D1 caps bound
 * parameters at 100 per statement — for an admin (who can see every event: this app had 37 at
 * the time) combined with even a single 80-id photo chunk, that's 117 params, over the limit.
 * The resulting D1 error was swallowed by the route's outer try/catch into a generic 500, which
 * the frontend then silently rendered as "no results" — a person with 319 photos (4 chunks)
 * reliably hit this on at least one chunk. Fixed by dropping the event-id IN() clause from this
 * query entirely and filtering event access in JS against the already-fetched event map instead.
 */

vi.mock('../aiEnrichment', () => ({
  embedSearchQuery: async () => null,
  cosineSimilarity: () => 0,
}));

import publicRoutes from '../routes/public';

const mockUser = { id: 'admin-1', email: 'admin@example.com' };
vi.mock('../auth', () => ({
  optionalAuth: async (c: any, next: any) => {
    await next();
  },
  getUser: () => mockUser,
  isAdmin: () => true,
  getCollaboratorRoleByEventId: async () => null,
  hasEventSessionAccess: async () => true,
}));

describe('GET /api/search people filter — D1 bound-parameter safety', () => {
  it('never binds more than 100 parameters in a single statement, even for an admin with many accessible events and a person with many matching photos', async () => {
    // Simulate an admin who can see every event (37, matching the real production count at the
    // time of the bug) and a person who appears in 319 photos (319 matching this app's real
    // production numbers for the reported bug) — enough to require multiple photo-id chunks.
    const EVENT_COUNT = 37;
    const MATCHING_PHOTO_COUNT = 319;

    const events = Array.from({ length: EVENT_COUNT }, (_, i) => ({
      id: i + 1,
      slug: `event-${i + 1}`,
      name: `Event ${i + 1}`,
      visibility: 'private',
    }));
    const matchingPhotoIds = Array.from({ length: MATCHING_PHOTO_COUNT }, (_, i) => `photo-${i}`);

    let maxBoundParamsSeen = 0;

    const db = {
      prepare(query: string) {
        let boundArgs: unknown[] = [];
        const stmt = {
          bind(...args: unknown[]) {
            boundArgs = args;
            maxBoundParamsSeen = Math.max(maxBoundParamsSeen, args.length);
            return stmt;
          },
          async all() {
            if (query.includes('FROM events e') && query.includes('LEFT JOIN event_collaborators')) {
              return { results: events };
            }
            if (query.includes('FROM photo_faces') && query.includes('UNION') && query.includes('GROUP BY photo_id')) {
              // Person-match resolution — everyone in matchingPhotoIds matches the sole person.
              return { results: matchingPhotoIds.map((photo_id) => ({ photo_id })) };
            }
            if (query.includes('FROM photos p') && query.includes('WHERE p.id IN')) {
              const idCount = query.match(/WHERE p\.id IN \(([^)]*)\)/)?.[1].split(',').length || 0;
              const ids = boundArgs.slice(0, idCount) as string[];
              const results = ids
                .filter((id) => matchingPhotoIds.includes(id))
                .map((id) => ({
                  id, event_id: 1, original_filename: `${id}.jpg`, file_type: 'image/jpeg',
                  capture_time: '2024-01-01T00:00:00Z', width: 100, height: 100,
                  blur_placeholder: null, cache_version: 1, ai_caption: null, embedding: null,
                }));
              return { results };
            }
            return { results: [] };
          },
          async first() {
            return null;
          },
        };
        return stmt;
      },
    };

    const res = await publicRoutes.fetch(
      new Request('http://test/api/search?people=1'),
      { DB: db } as any
    );
    const body = await res.json() as { photos: unknown[] };

    // D1's actual cap is 100 bound parameters per statement.
    expect(maxBoundParamsSeen).toBeLessThanOrEqual(100);
    // And the fix must not have silently dropped any real results in the process.
    expect(body.photos.length).toBeGreaterThan(0);
  });
});
