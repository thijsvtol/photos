import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bypass the permission middleware (covered by auth.test.ts) so this exercises just the
// PUT /:photoId/poster route logic.
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
import { Hono } from 'hono';

/** Fake env: DB returns the given photo for the poster's file_type lookup; records the UPDATE.
 *  PHOTOS_BUCKET records the put(). */
function createFakeEnv(photo: { file_type: string } | null) {
  const puts: Array<{ key: string; contentType?: string; bytes: number }> = [];
  const runs: Array<{ query: string; args: unknown[] }> = [];
  const env = {
    DB: {
      prepare(query: string) {
        let boundArgs: unknown[] = [];
        return {
          bind(...args: unknown[]) {
            boundArgs = args;
            return this;
          },
          async first<T>() {
            if (query.includes('FROM photos p') && query.includes('JOIN events e')) {
              return photo as T | null;
            }
            return null as T | null;
          },
          async run() {
            runs.push({ query, args: boundArgs });
            return { meta: { changes: 1 } };
          },
        };
      },
    },
    PHOTOS_BUCKET: {
      async put(key: string, body: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
        puts.push({ key, contentType: opts?.httpMetadata?.contentType, bytes: body.byteLength });
      },
    },
  };
  return { env, puts, runs };
}

function makeApp() {
  const app = new Hono();
  app.route('/events/:slug/uploads', uploadsRouter);
  return app;
}

const posterBody = () => new Uint8Array([1, 2, 3, 4]);

describe('PUT /events/:slug/uploads/:photoId/poster', () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });

  it('stores the poster and marks video_poster_status done, bumping cache_version', async () => {
    const { env, puts, runs } = createFakeEnv({ file_type: 'video/mp4' });

    const res = await app.request(
      'http://localhost/events/ev1/uploads/vid123/poster',
      { method: 'PUT', body: posterBody() },
      env as any
    );

    expect(res.status).toBe(200);
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe('poster/ev1/vid123.jpg');
    expect(puts[0].contentType).toBe('image/jpeg');
    // Marks done + bumps cache_version in one UPDATE.
    const update = runs.find((r) => r.query.includes('UPDATE photos SET video_poster_status'));
    expect(update).toBeTruthy();
    expect(update!.query).toContain('cache_version = cache_version + 1');
    expect(update!.args).toEqual(['vid123']);
  });

  it('404s when the photo does not exist', async () => {
    const { env, puts } = createFakeEnv(null);
    const res = await app.request(
      'http://localhost/events/ev1/uploads/missing/poster',
      { method: 'PUT', body: posterBody() },
      env as any
    );
    expect(res.status).toBe(404);
    expect(puts).toHaveLength(0);
  });

  it('400s for a non-video photo', async () => {
    const { env, puts } = createFakeEnv({ file_type: 'image/jpeg' });
    const res = await app.request(
      'http://localhost/events/ev1/uploads/img1/poster',
      { method: 'PUT', body: posterBody() },
      env as any
    );
    expect(res.status).toBe(400);
    expect(puts).toHaveLength(0);
  });

  it('400s on an empty body', async () => {
    const { env, puts } = createFakeEnv({ file_type: 'video/mp4' });
    const res = await app.request(
      'http://localhost/events/ev1/uploads/vid123/poster',
      { method: 'PUT', body: new Uint8Array([]) },
      env as any
    );
    expect(res.status).toBe(400);
    expect(puts).toHaveLength(0);
  });
});
