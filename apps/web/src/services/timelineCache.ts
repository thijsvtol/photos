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
    // Database NAME bumped (not just the Dexie version) on 2026-08-09 to force a
    // one-time rebuild.
    //
    // The timeline now returns a photo once even when it sits in several albums
    // (see SINGLE_COPY_CLAUSE in apps/worker/src/routes/public.ts). This cache
    // only ever bulkPut()s and never deletes — unlike eventPhotoCache, which can
    // reconcile because the gallery endpoint returns a complete set, while the
    // timeline is paginated and the client therefore never holds the whole truth.
    // So copies already cached would have kept rendering forever, and the bug
    // would have looked unfixed on exactly the devices that had seen it.
    super('PhotosTimelineCacheV2');
    this.version(1).stores({
      photos: 'id, capture_time',
    });
  }
}

const db = new TimelineCacheDatabase();

// Drop the pre-V2 database. Renaming leaves the old one on disk, and it is not
// harmless: it still holds photos from private/collaborator-only events, and
// clearTimelineCache() below no longer points at it — so a logout would leave
// that content behind on a shared device. Best-effort and non-blocking; a browser
// that refuses the delete just keeps some dead storage.
void Dexie.delete('PhotosTimelineCache').catch(() => { /* nothing to reclaim */ });

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

/** Removes photos from the cache by id — used after a bulk delete on the Timeline so a
 *  just-deleted photo doesn't linger in IndexedDB and reappear on the next open (the normal
 *  load path only upserts the newest page and never otherwise learns about deletions). */
export async function removeTimelineCachePhotos(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.photos.bulkDelete(ids);
}

/** Clears the entire timeline cache (e.g. on logout, to avoid leaking another
 *  user's private photos into a shared device's cache). */
export async function clearTimelineCache(): Promise<void> {
  await db.photos.clear();
}
