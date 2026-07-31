import Dexie, { Table } from 'dexie';
import type { Photo } from '../types';

/**
 * IndexedDB-backed cache for the Timeline page (persists across app restarts,
 * including the Android app's WebView — IndexedDB is fully supported there).
 *
 * Goal: avoid re-downloading the entire photo library from scratch every time
 * the Timeline is opened, which is slow/wasteful for large (thousands of
 * photos) libraries, especially on mobile networks. Instead:
 *   1. On mount, previously-cached photos render IMMEDIATELY from IndexedDB
 *      (no network wait).
 *   2. In the background, only the newest page is re-fetched from the network
 *      and merged in (upsert by id) — this reliably catches new uploads and
 *      edits to recently-uploaded photos without re-fetching the whole library.
 *   3. Older pages (paged in via scroll, see Timeline.tsx's load-more sentinel)
 *      are merged into the same cache as they're fetched, so subsequent app
 *      opens progressively have more of the library available offline/instantly.
 *
 * This intentionally does not attempt a full field-level "changed since X"
 * delta sync against the worker (the photos table has no generic
 * `updated_at` covering edits, only `uploaded_at` for the upload itself) —
 * that would need a schema/API change. Re-fetching the newest page on every
 * open is a pragmatic, low-risk way to keep the cache reasonably fresh.
 */
class TimelineCacheDatabase extends Dexie {
  photos!: Table<Photo, string>;

  constructor() {
    super('PhotosTimelineCache');
    this.version(1).stores({
      photos: 'id, capture_time',
    });
  }
}

const db = new TimelineCacheDatabase();

/** Returns all cached photos, newest capture_time first (matches /api/timeline's order). */
export async function getCachedTimelinePhotos(): Promise<Photo[]> {
  const photos = await db.photos.toArray();
  return photos.sort((a, b) => (b.capture_time || '').localeCompare(a.capture_time || ''));
}

/** Upserts a page of photos into the cache (adds new, overwrites existing by id). */
export async function cacheTimelinePhotos(photos: Photo[]): Promise<void> {
  if (photos.length === 0) return;
  await db.photos.bulkPut(photos);
}

/** Clears the entire timeline cache (e.g. on logout, to avoid leaking another
 *  user's private photos into a shared device's cache). */
export async function clearTimelineCache(): Promise<void> {
  await db.photos.clear();
}
