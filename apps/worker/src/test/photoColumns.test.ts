import { describe, expect, it } from 'vitest';
import { GALLERY_PHOTO_COLUMNS, PHOTO_COLUMNS_WITH_BLUR } from '../photoColumns';

/**
 * Guards the payload-size fix from 2026-08-09.
 *
 * The gallery/featured routes used `SELECT p.*`, which shipped every column of
 * every row — including the `embedding` BLOB (a Float32Array for AI search) and
 * the `ai_*` columns, none of which the client declares or reads. On a 2000+ photo
 * event that made the response large enough to visibly slow the WebView down
 * before a single photo rendered.
 *
 * These tests exist because `SELECT p.*` is the tempting thing to write, and a
 * future column (embeddings get bigger, not smaller) would silently re-inflate the
 * response with nothing failing.
 */
describe('GALLERY_PHOTO_COLUMNS', () => {
  const columns = GALLERY_PHOTO_COLUMNS.split(',').map((c) => c.trim());

  it('never selects the AI columns the client does not read', () => {
    for (const banned of ['p.embedding', 'p.ai_caption', 'p.ai_tags', 'p.ai_processed_at']) {
      expect(columns).not.toContain(banned);
    }
  });

  it('never selects server-side bookkeeping the client does not read', () => {
    for (const banned of [
      'p.upload_complete', 'p.preview_complete', 'p.faces_processed_at',
      'p.notified_at', 'p.video_transcode_status',
      'p.source_photo_id', 'p.source_event_slug',
    ]) {
      expect(columns).not.toContain(banned);
    }
  });

  it('is not a wildcard', () => {
    expect(GALLERY_PHOTO_COLUMNS).not.toContain('*');
  });

  it('keeps the columns the gallery genuinely needs', () => {
    // file_hash/phash drive duplicate grouping in EventGallery.tsx;
    // cache_version busts media URLs after an edit/transcode.
    for (const required of [
      'p.id', 'p.event_id', 'p.original_filename', 'p.file_type', 'p.capture_time',
      'p.width', 'p.height', 'p.cache_version',
      'p.is_featured', 'p.favorites_count', 'p.file_hash', 'p.phash',
    ]) {
      expect(columns).toContain(required);
    }
  });

  it('includes blur_placeholder so gallery tiles blur up', () => {
    // Re-added by product decision (accepting the slower open on large events —
    // it was 81% of a 4102-photo response at ~1470 bytes/row). If that cost needs
    // revisiting, swap to a compact placeholder (thumbhash), don't drop the blur.
    expect(columns).toContain('p.blur_placeholder');
  });

  it('still offers a blur-bearing variant for short lists', () => {
    // featured / most-favorited are LIMIT ~20, where the blur-up is nearly free.
    expect(PHOTO_COLUMNS_WITH_BLUR).toContain('p.blur_placeholder');
    // ...and it must otherwise stay in step with the gallery list.
    for (const column of columns) expect(PHOTO_COLUMNS_WITH_BLUR).toContain(column);
  });

  it('qualifies every column with the photos alias, so it can join without ambiguity', () => {
    // These queries JOIN users/events, which have their own id/name columns.
    for (const column of columns) {
      expect(column.startsWith('p.')).toBe(true);
    }
  });
});
