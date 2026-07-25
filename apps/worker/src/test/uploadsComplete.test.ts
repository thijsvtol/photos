import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bypass permission checks for this route-logic test — the permission
// middleware itself is covered by auth.test.ts and accessControl.test.ts.
// Force isAdmin() to false so the collaborator history-logging branch runs.
vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>();
  return {
    ...actual,
    requireUploadPermission: async (c: any, next: any) => {
      c.set('user', { id: 'u1', email: 'collaborator@example.com', name: 'Collaborator' });
      await next();
    },
    isAdmin: () => false,
  };
});

// Force the collaborators feature on regardless of Mailgun config.
vi.mock('../features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features')>();
  return {
    ...actual,
    checkFeature: () => true,
  };
});

import uploadsRouter from '../routes/admin/uploads';
import { Hono } from 'hono';

interface FakePhoto {
  id: string;
  file_type: string;
  upload_complete: number;
  preview_complete: number;
}

function createFakeEnv(photos: FakePhoto[], historyRows: unknown[][]): { DB: any; PHOTOS_BUCKET: any } {
  const db = {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          boundArgs = args;
          return this;
        },
        async first<T>() {
          if (query.includes('SELECT file_type FROM photos WHERE id = ?')) {
            const [id] = boundArgs as [string];
            const photo = photos.find(p => p.id === id);
            return (photo ? { file_type: photo.file_type } : null) as T | null;
          }
          if (query.includes('FROM events e')) {
            return { id: 1, name: 'Test Event' } as T;
          }
          return null as T | null;
        },
        async run() {
          if (query.includes('UPDATE photos SET upload_complete = 1 WHERE id = ? AND upload_complete = 0')) {
            const [id] = boundArgs as [string];
            const photo = photos.find(p => p.id === id);
            if (photo && photo.upload_complete === 0) {
              photo.upload_complete = 1;
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (query.includes('UPDATE photos SET preview_complete = 1 WHERE id = ? AND preview_complete = 0')) {
            const [id] = boundArgs as [string];
            const photo = photos.find(p => p.id === id);
            if (photo && photo.preview_complete === 0) {
              photo.preview_complete = 1;
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (query.includes('INSERT INTO collaboration_history')) {
            historyRows.push(boundArgs);
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
    },
  };

  const bucket = {
    resumeMultipartUpload: (key: string, uploadId: string) => ({
      complete: async (_parts: unknown) => ({ key, uploadId }),
    }),
  };

  return { DB: db, PHOTOS_BUCKET: bucket };
}

function buildApp() {
  const app = new Hono();
  app.route('/events/:slug/uploads', uploadsRouter);
  return app;
}

describe('POST /events/:slug/uploads/:photoId/complete', () => {
  let photos: FakePhoto[];
  let historyRows: unknown[][];
  let env: ReturnType<typeof createFakeEnv>;

  beforeEach(() => {
    photos = [{ id: 'photo-1', file_type: 'image/jpeg', upload_complete: 0, preview_complete: 0 }];
    historyRows = [];
    env = createFakeEnv(photos, historyRows);
  });

  const completeReq = () =>
    ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: 'upload-1', parts: [{ partNumber: 1, etag: 'etag-1' }] }),
    }) as const;

  it('marks the photo complete and logs one history entry on the first call', async () => {
    const app = buildApp();
    const res = await app.request('/events/my-event/uploads/photo-1/complete', completeReq(), env);

    expect(res.status).toBe(200);
    expect(photos[0].upload_complete).toBe(1);
    expect(historyRows).toHaveLength(1);
  });

  it('does not log a duplicate history entry when /complete is retried', async () => {
    const app = buildApp();

    const first = await app.request('/events/my-event/uploads/photo-1/complete', completeReq(), env);
    expect(first.status).toBe(200);

    // Simulate a retry: the first /complete actually succeeded server-side,
    // but the client never saw the response (e.g. dropped connection), so it
    // retries the whole upload, calling /complete again for the same photo.
    const retry = await app.request('/events/my-event/uploads/photo-1/complete', completeReq(), env);
    expect(retry.status).toBe(200);

    expect(photos[0].upload_complete).toBe(1);
    // Still only one history row — the retry did not duplicate it.
    expect(historyRows).toHaveLength(1);
  });

  it('marks preview_complete on the preview completion call without touching upload_complete or history', async () => {
    // Original already completed; only the preview upload is being completed now.
    photos[0].upload_complete = 1;

    const app = buildApp();
    const res = await app.request(
      '/events/my-event/uploads/photo-1/complete?preview=true',
      completeReq(),
      env
    );

    expect(res.status).toBe(200);
    expect(photos[0].preview_complete).toBe(1);
    expect(photos[0].upload_complete).toBe(1);
    expect(historyRows).toHaveLength(0);
  });

  it('does not error when the preview /complete call is retried', async () => {
    photos[0].upload_complete = 1;

    const app = buildApp();
    const first = await app.request(
      '/events/my-event/uploads/photo-1/complete?preview=true',
      completeReq(),
      env
    );
    expect(first.status).toBe(200);

    const retry = await app.request(
      '/events/my-event/uploads/photo-1/complete?preview=true',
      completeReq(),
      env
    );
    expect(retry.status).toBe(200);
    expect(photos[0].preview_complete).toBe(1);
  });
});
