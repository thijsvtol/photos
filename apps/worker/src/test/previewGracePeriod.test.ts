import { describe, expect, it } from 'vitest';
import publicRoutes from '../routes/public';

/**
 * Regression test for a "major bug": photos whose original upload succeeded
 * (upload_complete = 1) but whose preview upload never finished (transient
 * network error, retries exhausted, or the tab/app closed mid-upload) must
 * not stay invisible in the gallery forever. See PREVIEW_READY_CLAUSE in
 * routes/public.ts — after a short grace period, photos are shown even
 * without a completed preview (media.ts already falls back to serving the
 * original file when no preview exists in R2).
 *
 * The mock D1 below is QUERY-AWARE: it evaluates the actual WHERE clause
 * text from the route (including the grace-period fallback), so removing
 * that fallback from the SQL would make this test fail.
 */

interface Ph {
  id: string;
  event_id: number;
  upload_complete: number;
  preview_complete: number;
  uploaded_at: string; // 'YYYY-MM-DD HH:MM:SS', matching SQLite datetime('now')
  capture_time: string;
}

const NOW = new Date();
/** Format a point in time N minutes ago as a SQLite `datetime('now')`-style string. */
const sqlDatetimeMinutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

const photos: Ph[] = [
  // Original done, preview done — always visible.
  { id: 'ready', event_id: 1, upload_complete: 1, preview_complete: 1, uploaded_at: sqlDatetimeMinutesAgo(1), capture_time: '2024-01-01' },
  // Original done, preview still pending, uploaded seconds ago — hidden (preview upload may still be in flight).
  { id: 'just-uploaded-no-preview', event_id: 1, upload_complete: 1, preview_complete: 0, uploaded_at: sqlDatetimeMinutesAgo(1), capture_time: '2024-01-02' },
  // Original done, preview never finished, uploaded long ago — must fall back to visible.
  { id: 'stuck-preview', event_id: 1, upload_complete: 1, preview_complete: 0, uploaded_at: sqlDatetimeMinutesAgo(60), capture_time: '2024-01-03' },
  // Original itself still in progress — always hidden regardless of preview/age.
  { id: 'original-in-progress', event_id: 1, upload_complete: 0, preview_complete: 0, uploaded_at: sqlDatetimeMinutesAgo(60), capture_time: '2024-01-04' },
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
          if (query.includes('FROM events WHERE slug')) {
            return { id: 1, password_hash: null, visibility: 'public' };
          }
          return null;
        },
        async all() {
          if (!query.includes('FROM photos p')) return { results: [] };

          const eventId = boundArgs[0];
          const requireUploadComplete = query.includes('p.upload_complete = 1');
          const requirePreviewReady = query.includes('p.preview_complete = 1 OR p.uploaded_at <=');

          const graceMatch = query.match(/'-(\d+) minutes'/);
          const graceMinutes = graceMatch ? Number(graceMatch[1]) : 0;
          const cutoff = new Date(NOW.getTime() - graceMinutes * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

          const rows = photos.filter((p) => {
            if (p.event_id !== eventId) return false;
            if (requireUploadComplete && p.upload_complete !== 1) return false;
            if (requirePreviewReady && !(p.preview_complete === 1 || p.uploaded_at <= cutoff)) return false;
            return true;
          });

          return { results: rows };
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

describe('GET /api/events/:slug/photos preview grace period', () => {
  it('shows ready photos, hides freshly-uploaded ones without a preview, and falls back to visible once stuck long enough', async () => {
    const res = await publicRoutes.request('http://localhost/api/events/evt/photos', {}, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { photos: Array<{ id: string }> };
    const ids = body.photos.map((p) => p.id);

    expect(ids).toContain('ready');
    expect(ids).toContain('stuck-preview');
    expect(ids).not.toContain('just-uploaded-no-preview');
    expect(ids).not.toContain('original-in-progress');
  });
});
