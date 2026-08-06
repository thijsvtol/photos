import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bypass permission checks for this route-logic test — the permission
// middleware itself is covered by auth.test.ts and accessControl.test.ts.
vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>();
  return {
    ...actual,
    requireUploadPermission: async (c: any, next: any) => {
      c.set('user', { id: 'u1', email: 'collaborator@example.com', name: 'Collaborator' });
      await next();
    },
  };
});

import uploadsRouter from '../routes/admin/uploads';
import { MAX_SQL_IN_CHUNK } from '../utils';
import { Hono } from 'hono';

interface FakePhoto {
  event_id: number;
  file_hash: string | null;
  upload_complete: number;
  deleted_at: string | null;
}

const EVENT_ID = 1;

/**
 * Minimal fake D1 that emulates the chunked `IN (...)` SELECT issued by
 * POST /check-hashes via DB.batch(). Records the bound-parameter count of
 * every statement so the tests can assert the D1 100-parameter cap is
 * respected (see MAX_SQL_IN_CHUNK).
 */
function createFakeEnv(photos: FakePhoto[]) {
  const boundParamCounts: number[] = [];

  const db = {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          if (query.includes('file_hash IN')) boundParamCounts.push(args.length);
          return stmt;
        },
        async first<T>() {
          if (query.includes('SELECT id FROM events WHERE slug = ?')) {
            return (boundArgs[0] === 'missing-event' ? null : { id: EVENT_ID }) as T | null;
          }
          return null as T | null;
        },
        /** Used by DB.batch() below to resolve each chunked statement. */
        async _run() {
          const [eventId, ...hashes] = boundArgs as [number, ...string[]];
          const matched = new Set(
            photos
              .filter(
                (p) =>
                  p.event_id === eventId &&
                  p.deleted_at === null &&
                  p.upload_complete === 1 &&
                  p.file_hash !== null &&
                  hashes.includes(p.file_hash)
              )
              .map((p) => p.file_hash as string)
          );
          return { results: Array.from(matched).map((file_hash) => ({ file_hash })) };
        },
      };
      return stmt;
    },
    async batch<T>(statements: any[]) {
      return Promise.all(statements.map((s) => s._run())) as Promise<T[]>;
    },
  };

  return { env: { DB: db, PHOTOS_BUCKET: {} }, boundParamCounts };
}

function buildApp() {
  const app = new Hono();
  app.route('/events/:slug/uploads', uploadsRouter);
  return app;
}

async function check(env: any, hashes: unknown, slug = 'my-event') {
  const app = buildApp();
  return app.request(
    `/events/${slug}/uploads/check-hashes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes }),
    },
    env
  );
}

/** Deterministic valid 64-char lowercase hex hash for index `n`. */
const hashFor = (n: number) => n.toString(16).padStart(64, '0');

describe('POST /events/:slug/uploads/check-hashes', () => {
  let photos: FakePhoto[];
  let fake: ReturnType<typeof createFakeEnv>;

  beforeEach(() => {
    photos = [];
    fake = createFakeEnv(photos);
  });

  it('returns the subset of hashes the event already has', async () => {
    photos.push(
      { event_id: EVENT_ID, file_hash: hashFor(1), upload_complete: 1, deleted_at: null },
      { event_id: EVENT_ID, file_hash: hashFor(2), upload_complete: 1, deleted_at: null }
    );

    const res = await check(fake.env, [hashFor(1), hashFor(3)]);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.existing).toEqual([hashFor(1)]);
  });

  it('returns an empty list (and never queries) for no hashes', async () => {
    const res = await check(fake.env, []);

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).existing).toEqual([]);
    expect(fake.boundParamCounts).toEqual([]);
  });

  it('rejects a non-array body', async () => {
    const res = await check(fake.env, 'not-an-array');
    expect(res.status).toBe(400);
  });

  it('rejects more than 500 hashes', async () => {
    const res = await check(fake.env, Array.from({ length: 501 }, (_, i) => hashFor(i)));
    expect(res.status).toBe(400);
  });

  it('chunks the IN (...) list so no statement exceeds D1s parameter cap', async () => {
    // 500 hashes is the maximum the endpoint accepts, and by far the most
    // likely way to blow the 100-bound-parameter limit if chunking regressed.
    const hashes = Array.from({ length: 500 }, (_, i) => hashFor(i));
    photos.push({ event_id: EVENT_ID, file_hash: hashFor(499), upload_complete: 1, deleted_at: null });

    const res = await check(fake.env, hashes);

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).existing).toEqual([hashFor(499)]);

    expect(fake.boundParamCounts.length).toBe(Math.ceil(500 / MAX_SQL_IN_CHUNK));
    // +1 for the event_id bound alongside each chunk.
    for (const count of fake.boundParamCounts) {
      expect(count).toBeLessThanOrEqual(MAX_SQL_IN_CHUNK + 1);
      expect(count).toBeLessThan(100);
    }
  });

  it('ignores soft-deleted and incomplete photos so their content is re-uploaded', async () => {
    photos.push(
      { event_id: EVENT_ID, file_hash: hashFor(1), upload_complete: 1, deleted_at: '2026-01-01' },
      { event_id: EVENT_ID, file_hash: hashFor(2), upload_complete: 0, deleted_at: null }
    );

    const res = await check(fake.env, [hashFor(1), hashFor(2)]);

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).existing).toEqual([]);
  });

  it('does not match photos belonging to a different event', async () => {
    photos.push({ event_id: 999, file_hash: hashFor(1), upload_complete: 1, deleted_at: null });

    const res = await check(fake.env, [hashFor(1)]);

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).existing).toEqual([]);
  });

  it('drops malformed hashes instead of widening the IN (...) list with junk', async () => {
    photos.push({ event_id: EVENT_ID, file_hash: hashFor(1), upload_complete: 1, deleted_at: null });

    const res = await check(fake.env, [hashFor(1), 'nope', '', 'ZZZ', 123, null]);

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).existing).toEqual([hashFor(1)]);
    // Only the one valid hash reached the query (plus the event_id bind).
    expect(fake.boundParamCounts).toEqual([2]);
  });

  it('normalises case and de-duplicates before querying', async () => {
    photos.push({ event_id: EVENT_ID, file_hash: hashFor(0xabc), upload_complete: 1, deleted_at: null });
    const upper = hashFor(0xabc).toUpperCase();

    const res = await check(fake.env, [upper, hashFor(0xabc), ` ${upper} `]);

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).existing).toEqual([hashFor(0xabc)]);
    expect(fake.boundParamCounts).toEqual([2]);
  });

  it('404s for an unknown event', async () => {
    const res = await check(fake.env, [hashFor(1)], 'missing-event');
    expect(res.status).toBe(404);
  });
});
