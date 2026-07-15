import { describe, expect, it } from 'vitest';
import featuresRoutes from '../routes/features';

/**
 * Regression tests for the public homepage/discovery endpoints.
 *
 * A real leak shipped where /api/photos/featured (and most-favorited, and the
 * by-tag listing) only filtered on `password_hash IS NULL`, so photos from
 * private and collaborators_only events surfaced on the public homepage.
 *
 * The mock D1 below is QUERY-AWARE: it applies exactly the WHERE conditions
 * present in the route's SQL string. That means if someone drops the
 * `visibility = 'public'` clause from a route, this mock stops filtering by
 * visibility and the private rows leak through — making these tests fail.
 * (A mock that hard-coded public-only filtering would give false confidence.)
 */

interface Ev {
  id: number;
  slug: string;
  name: string;
  visibility: 'public' | 'private' | 'collaborators_only';
  password_hash: string | null;
}

interface Ph {
  id: string;
  event_id: number;
  is_featured: number;
  favorites_count: number;
  capture_time: string;
}

const events: Ev[] = [
  { id: 1, slug: 'public-open', name: 'Public Open', visibility: 'public', password_hash: null },
  { id: 2, slug: 'private-open', name: 'Private Open', visibility: 'private', password_hash: null },
  { id: 3, slug: 'collab-open', name: 'Collab Open', visibility: 'collaborators_only', password_hash: null },
  { id: 4, slug: 'public-pw', name: 'Public Password', visibility: 'public', password_hash: 'hash' },
];

const photos: Ph[] = [
  { id: 'pub-feat', event_id: 1, is_featured: 1, favorites_count: 5, capture_time: '2024-01-01T00:00:00Z' },
  { id: 'priv-feat', event_id: 2, is_featured: 1, favorites_count: 9, capture_time: '2024-01-02T00:00:00Z' },
  { id: 'collab-feat', event_id: 3, is_featured: 1, favorites_count: 8, capture_time: '2024-01-03T00:00:00Z' },
  { id: 'pubpw-feat', event_id: 4, is_featured: 1, favorites_count: 7, capture_time: '2024-01-04T00:00:00Z' },
];

function queryAwareDb() {
  return {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async all() {
          // Only the photo-listing queries JOIN photos to events.
          if (!query.includes('FROM photos p') || !query.includes('JOIN events e')) {
            return { results: [] };
          }

          const requireFeatured = query.includes('p.is_featured = 1');
          const requirePublic = query.includes("e.visibility = 'public'");
          const requireNoPassword = query.includes('e.password_hash IS NULL');

          const rows = photos
            .map((p) => ({ p, e: events.find((e) => e.id === p.event_id)! }))
            .filter(({ p, e }) => {
              if (requireFeatured && p.is_featured !== 1) return false;
              if (requirePublic && e.visibility !== 'public') return false;
              if (requireNoPassword && e.password_hash !== null) return false;
              return true;
            })
            .map(({ p, e }) => ({ ...p, event_slug: e.slug, event_name: e.name }));

          const limit = Number(boundArgs[boundArgs.length - 1]) || rows.length;
          return { results: rows.slice(0, limit) };
        },
        async first() {
          return null;
        },
        async run() {
          return { success: true };
        },
      };
      return stmt;
    },
  };
}

function makeEnv() {
  return { DB: queryAwareDb() as unknown as D1Database } as any;
}

async function fetchPhotos(path: string): Promise<Array<{ event_slug: string; id: string }>> {
  const res = await featuresRoutes.request(`http://localhost${path}`, {}, makeEnv());
  expect(res.status).toBe(200);
  const body = (await res.json()) as { photos: Array<{ event_slug: string; id: string }> };
  return body.photos;
}

describe('public discovery endpoints do not leak non-public events', () => {
  it('featured photos exclude private, collaborators_only and password-protected events', async () => {
    const result = await fetchPhotos('/api/photos/featured');
    const slugs = result.map((p) => p.event_slug);

    expect(slugs).toContain('public-open');
    expect(slugs).not.toContain('private-open');
    expect(slugs).not.toContain('collab-open');
    expect(slugs).not.toContain('public-pw');
  });

  it('most-favorited photos exclude private, collaborators_only and password-protected events', async () => {
    const result = await fetchPhotos('/api/photos/most-favorited');
    const slugs = result.map((p) => p.event_slug);

    expect(slugs).toContain('public-open');
    expect(slugs).not.toContain('private-open');
    expect(slugs).not.toContain('collab-open');
    expect(slugs).not.toContain('public-pw');
  });
});
