import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same harness as uploadsComplete.test.ts, but with isAdmin() forced TRUE so
// the activity_log branch runs instead of the collaboration_history one. The
// admin feed unions both tables, so exactly one of them must record any given
// upload — logging to both would show the upload twice.
vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>();
  return {
    ...actual,
    requireUploadPermission: async (c: any, next: any) => {
      c.set('user', { id: 'u1', email: 'admin@example.com', name: 'Admin' });
      await next();
    },
    isAdmin: () => true,
  };
});

vi.mock('../features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features')>();
  return {
    ...actual,
    checkFeature: () => true,
  };
});

import { Hono } from 'hono';
import uploadsRouter from '../routes/admin/uploads';

interface FakePhoto {
  id: string;
  file_type: string;
  upload_complete: number;
  preview_complete: number;
}

function createFakeEnv(photos: FakePhoto[], historyRows: unknown[][], activityRows: unknown[][]) {
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
            const photo = photos.find((p) => p.id === id);
            return (photo ? { file_type: photo.file_type } : null) as T | null;
          }
          if (query.includes('SELECT id FROM events WHERE slug = ?')) {
            return { id: 1 } as T;
          }
          if (query.includes('FROM events e')) {
            return { id: 1, name: 'Test Event' } as T;
          }
          return null as T | null;
        },
        async run() {
          if (query.includes('UPDATE photos SET upload_complete = 1 WHERE id = ? AND upload_complete = 0')) {
            const [id] = boundArgs as [string];
            const photo = photos.find((p) => p.id === id);
            if (photo && photo.upload_complete === 0) {
              photo.upload_complete = 1;
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (query.includes('UPDATE photos SET preview_complete = 1 WHERE id = ? AND preview_complete = 0')) {
            const [id] = boundArgs as [string];
            const photo = photos.find((p) => p.id === id);
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
          if (query.includes('INSERT INTO activity_log')) {
            activityRows.push(boundArgs);
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

  return { DB: db, PHOTOS_BUCKET: bucket } as any;
}

function buildApp() {
  const app = new Hono();
  app.route('/events/:slug/uploads', uploadsRouter);
  return app;
}

const completeReq = () =>
  ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId: 'upload-1', parts: [{ partNumber: 1, etag: 'etag-1' }] }),
  }) as const;

describe('admin upload activity logging', () => {
  let photos: FakePhoto[];
  let historyRows: unknown[][];
  let activityRows: unknown[][];
  let env: ReturnType<typeof createFakeEnv>;

  beforeEach(() => {
    photos = [{ id: 'photo-1', file_type: 'image/jpeg', upload_complete: 0, preview_complete: 0 }];
    historyRows = [];
    activityRows = [];
    env = createFakeEnv(photos, historyRows, activityRows);
  });

  it('logs an admin upload to activity_log and NOT to collaboration_history', async () => {
    const res = await buildApp().request('/events/my-event/uploads/photo-1/complete', completeReq(), env);

    expect(res.status).toBe(200);
    expect(activityRows).toHaveLength(1);
    // The two tables are unioned by the admin feed, so an upload in both would
    // render twice.
    expect(historyRows).toHaveLength(0);

    const [eventId, actorEmail, action] = activityRows[0] as [number, string, string];
    expect(eventId).toBe(1);
    expect(actorEmail).toBe('admin@example.com');
    expect(action).toBe('photo_upload');
  });

  it('does not log a duplicate activity entry when /complete is retried', async () => {
    const app = buildApp();

    await app.request('/events/my-event/uploads/photo-1/complete', completeReq(), env);
    // Retry after a lost response — the same firstCompletion guard that
    // protects collaboration_history must protect activity_log too.
    await app.request('/events/my-event/uploads/photo-1/complete', completeReq(), env);

    expect(activityRows).toHaveLength(1);
  });

  it('does not log the preview completion as a separate upload', async () => {
    photos[0].upload_complete = 1;

    const res = await buildApp().request(
      '/events/my-event/uploads/photo-1/complete?preview=true',
      completeReq(),
      env
    );

    expect(res.status).toBe(200);
    expect(photos[0].preview_complete).toBe(1);
    expect(activityRows).toHaveLength(0);
  });
});
