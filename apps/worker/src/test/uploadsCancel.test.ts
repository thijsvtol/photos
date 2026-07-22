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
  file_type: string;
  upload_complete: number;
}

function createFakeEnv(photos: FakePhoto[]) {
  const deletedIds: string[] = [];
  const abortedKeys: string[] = [];

  const db = {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          boundArgs = args;
          return this;
        },
        async first<T>() {
          if (query.includes('SELECT file_type, upload_complete FROM photos WHERE id = ?')) {
            const [id] = boundArgs as [string];
            const photo = photos.find(p => p.id === id);
            return (photo ? { file_type: photo.file_type, upload_complete: photo.upload_complete } : null) as T | null;
          }
          return null as T | null;
        },
        async run() {
          if (query.includes('DELETE FROM photos WHERE id = ? AND upload_complete = 0')) {
            const [id] = boundArgs as [string];
            const before = photos.length;
            const idx = photos.findIndex(p => p.id === id && p.upload_complete === 0);
            if (idx >= 0) {
              photos.splice(idx, 1);
              deletedIds.push(id);
            }
            return { success: true, meta: { changes: before - photos.length } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
    },
  };

  const bucket = {
    resumeMultipartUpload(key: string, _uploadId: string) {
      return {
        abort: async () => {
          abortedKeys.push(key);
        },
      };
    },
  };

  const env = { DB: db, PHOTOS_BUCKET: bucket };
  const app = new Hono();
  app.route('/events/:slug/uploads', uploadsRouter);
  return { env, app, deletedIds, abortedKeys };
}

describe('POST /events/:slug/uploads/:photoId/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aborts the R2 multipart upload and deletes the photo row when upload_complete is 0', async () => {
    const { env, app, deletedIds, abortedKeys } = createFakeEnv([
      { id: 'photo-1', file_type: 'image/jpeg', upload_complete: 0 },
    ]);

    const res = await app.request(
      '/events/test-event/uploads/photo-1/cancel',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: 'upload-123' }),
      },
      env
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(deletedIds).toEqual(['photo-1']);
    expect(abortedKeys).toEqual(['original/test-event/photo-1.jpg']);
  });

  it('refuses to cancel (and does not delete) an already-completed upload', async () => {
    const { env, app, deletedIds } = createFakeEnv([
      { id: 'photo-2', file_type: 'image/jpeg', upload_complete: 1 },
    ]);

    const res = await app.request(
      '/events/test-event/uploads/photo-2/cancel',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: 'upload-456' }),
      },
      env
    );

    expect(res.status).toBe(400);
    expect(deletedIds).toEqual([]);
  });

  it('succeeds even when no uploadId is known (pending item never reached R2)', async () => {
    const { env, app, deletedIds, abortedKeys } = createFakeEnv([
      { id: 'photo-3', file_type: 'image/jpeg', upload_complete: 0 },
    ]);

    const res = await app.request(
      '/events/test-event/uploads/photo-3/cancel',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env
    );

    expect(res.status).toBe(200);
    expect(deletedIds).toEqual(['photo-3']);
    expect(abortedKeys).toEqual([]);
  });
});
