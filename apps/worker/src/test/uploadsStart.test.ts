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
import { Hono } from 'hono';

interface FakePhoto {
  id: string;
  eventId: number;
  originalFilename: string;
  file_type: string;
  upload_complete: number;
  preview_complete: number;
}

/**
 * Minimal fake D1 that emulates the real
 * `INSERT ... ON CONFLICT(id) DO UPDATE ... WHERE upload_complete = 0`
 * semantics used by POST /start, so this test would fail against a naive
 * plain INSERT (which throws on a duplicate primary key).
 */
function createFakeEnv(photos: FakePhoto[]): { DB: any; PHOTOS_BUCKET: any } {
  const db = {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          boundArgs = args;
          return this;
        },
        async first<T>() {
          if (query.includes('SELECT id FROM events WHERE slug = ?')) {
            return { id: 1 } as T;
          }
          return null as T | null;
        },
        async run() {
          if (query.includes('INSERT INTO photos')) {
            const [id, eventId, originalFilename, file_type] = boundArgs as [
              string, number, string, string
            ];
            // Bind order (see routes/admin/uploads.ts's INSERT): ... blurPlaceholder,
            // initialPreviewComplete, fileHash — i.e. previewComplete is
            // second-to-last, file_hash is last.
            const previewComplete = boundArgs[boundArgs.length - 2] as number;
            const existing = photos.find(p => p.id === id);
            if (!existing) {
              photos.push({ id, eventId, originalFilename, file_type, upload_complete: 0, preview_complete: previewComplete });
            } else if (existing.upload_complete === 0) {
              // Emulate the ON CONFLICT ... WHERE upload_complete = 0 upsert.
              existing.eventId = eventId;
              existing.originalFilename = originalFilename;
              existing.file_type = file_type;
            }
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
    },
  };

  let multipartUploadCount = 0;
  const bucket = {
    createMultipartUpload: async (key: string) => {
      multipartUploadCount += 1;
      return { uploadId: `upload-${multipartUploadCount}`, key };
    },
  };

  return { DB: db, PHOTOS_BUCKET: bucket };
}

function buildApp() {
  const app = new Hono();
  app.route('/events/:slug/uploads', uploadsRouter);
  return app;
}

describe('POST /events/:slug/uploads/start', () => {
  let photos: FakePhoto[];
  let env: ReturnType<typeof createFakeEnv>;

  beforeEach(() => {
    photos = [];
    env = createFakeEnv(photos);
  });

  it('creates a new photo row on the first call', async () => {
    const app = buildApp();
    const res = await app.request(
      '/events/my-event/uploads/start',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: 'photo-1', filename: 'a.jpg' }),
      },
      env
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.uploadId).toBe('upload-1');
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ id: 'photo-1', upload_complete: 0, preview_complete: 0 });
  });

  it('starts videos as preview_complete since they never get a separate preview file', async () => {
    const app = buildApp();
    const res = await app.request(
      '/events/my-event/uploads/start',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: 'video-1', filename: 'a.mp4', fileType: 'video/mp4' }),
      },
      env
    );

    expect(res.status).toBe(200);
    expect(photos[0]).toMatchObject({ id: 'video-1', preview_complete: 1 });
  });

  it('does not 500 when retried with the same photoId before completion', async () => {
    const app = buildApp();

    const first = await app.request(
      '/events/my-event/uploads/start',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: 'photo-1', filename: 'a.jpg' }),
      },
      env
    );
    expect(first.status).toBe(200);

    // Simulate a retry after a transient failure (e.g. network drop during
    // part upload): the client calls /start again with the same photoId.
    const retry = await app.request(
      '/events/my-event/uploads/start',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: 'photo-1', filename: 'a.jpg' }),
      },
      env
    );

    expect(retry.status).toBe(200);
    const json = await retry.json() as any;
    expect(json.uploadId).toBe('upload-2');
    // Still only one photo row — the retry updated it, it didn't duplicate it.
    expect(photos).toHaveLength(1);
  });

  it('does not overwrite an already-completed photo row on a stray retry', async () => {
    photos.push({
      id: 'photo-1',
      eventId: 1,
      originalFilename: 'original.jpg',
      file_type: 'image/jpeg',
      upload_complete: 1,
      preview_complete: 1,
    });

    const app = buildApp();
    const res = await app.request(
      '/events/my-event/uploads/start',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: 'photo-1', filename: 'renamed.jpg' }),
      },
      env
    );

    expect(res.status).toBe(200);
    expect(photos[0].originalFilename).toBe('original.jpg');
    expect(photos[0].upload_complete).toBe(1);
  });
});
