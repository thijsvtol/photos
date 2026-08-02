import { describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for Trash/Archive visibility across the public-facing
 * endpoints in routes/public.ts (added alongside the Trash/Archive feature).
 *
 * Soft-deleted (`deleted_at`) and archived (`archived_at`) photos must never
 * appear in normal public listings — a photo moved to Trash should disappear
 * from the event gallery and Timeline immediately, and an archived photo
 * should disappear from the Timeline (though it still shows in its event
 * gallery, which is NOT covered here since that's the intended behavior).
 *
 * Like featuredVisibility.test.ts, the mock D1 below is QUERY-AWARE: it only
 * filters out trashed/archived rows if the actual SQL string contains the
 * `deleted_at IS NULL` / `archived_at IS NULL` clauses. If a future refactor
 * accidentally drops one of those clauses, this mock stops filtering and the
 * corresponding test fails — a mock that hard-coded the filtering would give
 * false confidence instead.
 */

vi.mock('../auth', () => ({
  optionalAuth: async (c: any, next: any) => {
    await next();
  },
  getUser: () => null,
  isAdmin: () => false,
  getCollaboratorRoleByEventId: async () => null,
}));

vi.mock('../cookies', () => ({
  hasEventSessionAccess: async () => true,
}));

import publicRoutes from '../routes/public';

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
  original_filename: string;
  capture_time: string;
  upload_complete: number;
  preview_complete: number;
  deleted_at: string | null;
  archived_at: string | null;
}

const events: Ev[] = [
  { id: 1, slug: 'evt', name: 'Event', visibility: 'public', password_hash: null },
];

const photos: Ph[] = [
  {
    id: 'active-photo', event_id: 1, original_filename: 'active.jpg',
    capture_time: '2024-01-01T00:00:00Z', upload_complete: 1, preview_complete: 1,
    deleted_at: null, archived_at: null,
  },
  {
    id: 'trashed-photo', event_id: 1, original_filename: 'trashed.jpg',
    capture_time: '2024-01-02T00:00:00Z', upload_complete: 1, preview_complete: 1,
    deleted_at: '2024-06-01 00:00:00', archived_at: null,
  },
  {
    id: 'archived-photo', event_id: 1, original_filename: 'archived.jpg',
    capture_time: '2024-01-03T00:00:00Z', upload_complete: 1, preview_complete: 1,
    deleted_at: null, archived_at: '2024-06-01 00:00:00',
  },
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
        async first() {
          if (query.includes('FROM events WHERE slug = ?')) {
            const slug = String(boundArgs[0]);
            const event = events.find((e) => e.slug === slug);
            if (!event) return null;
            return {
              id: event.id,
              password_hash: event.password_hash,
              visibility: event.visibility,
            };
          }
          return null;
        },
        async all() {
          // Cross-event "which events can I see" query (used by /api/timeline
          // and /api/memories) — for this test's purposes just return every
          // event, since access-control filtering is exercised elsewhere
          // (accessControl.test.ts) and isn't what this file is testing.
          if (query.includes('FROM events e') && query.includes('LEFT JOIN event_collaborators')) {
            return { results: events.map((e) => ({ id: e.id, slug: e.slug, name: e.name })) };
          }

          // Single-event photo listing (GET /api/events/:slug/photos)
          if (query.includes('FROM photos p') && query.includes('LEFT JOIN users u')) {
            const eventId = Number(boundArgs[0]);
            const requireNotDeleted = query.includes('p.deleted_at IS NULL');
            const rows = photos.filter((p) => {
              if (p.event_id !== eventId) return false;
              if (requireNotDeleted && p.deleted_at !== null) return false;
              return true;
            });
            return { results: rows };
          }

          // Cross-event timeline photo listing (GET /api/timeline)
          if (query.includes('FROM photos p') && query.includes('WHERE p.event_id IN')) {
            const requireNotDeleted = query.includes('p.deleted_at IS NULL');
            const requireNotArchived = query.includes('p.archived_at IS NULL');
            const rows = photos.filter((p) => {
              if (requireNotDeleted && p.deleted_at !== null) return false;
              if (requireNotArchived && p.archived_at !== null) return false;
              return true;
            });
            return { results: rows };
          }

          return { results: [] };
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

describe('Trash/Archive visibility on public endpoints', () => {
  it('event photo listing excludes trashed photos', async () => {
    const res = await publicRoutes.request('http://localhost/api/events/evt/photos', {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { photos: Array<{ id: string }> };
    const ids = body.photos.map((p) => p.id);

    expect(ids).toContain('active-photo');
    expect(ids).not.toContain('trashed-photo');
  });

  it('timeline excludes both trashed and archived photos', async () => {
    const res = await publicRoutes.request('http://localhost/api/timeline', {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { photos: Array<{ id: string }> };
    const ids = body.photos.map((p) => p.id);

    expect(ids).toContain('active-photo');
    expect(ids).not.toContain('trashed-photo');
    expect(ids).not.toContain('archived-photo');
  });
});
