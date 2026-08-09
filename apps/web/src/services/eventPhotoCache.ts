import Dexie, { Table } from 'dexie';
import type { Photo } from '../types';

/**
 * IndexedDB-backed cache for a single event's gallery, mirroring
 * services/timelineCache.ts (same Dexie + bulkPut-upsert pattern).
 *
 * The Timeline already had this; the event gallery did not, and it is the page
 * that needed it most. Opening an event refetched every photo from scratch, and
 * that request had no pagination at all — a 2000+ photo event blocked on one
 * large response before rendering anything. The response itself is now much
 * smaller (see GALLERY_PHOTO_COLUMNS in apps/worker/src/photoColumns.ts), but a
 * cold fetch is still a network round-trip the user waits on every single time.
 *
 * So: render cached photos immediately, then reconcile against the network in
 * the background.
 *
 * Rows are keyed by photo id and indexed by event_slug. The slug is stored
 * alongside each row rather than derived, because the gallery endpoint returns
 * `event_id` and not the slug the caller looked the event up by.
 */
interface CachedEventPhoto extends Photo {
  /** The slug this row was cached under — the index the gallery reads by. */
  cached_event_slug: string;
}

class EventPhotoCacheDatabase extends Dexie {
  photos!: Table<CachedEventPhoto, string>;

  constructor() {
    super('PhotosEventGalleryCache');
    this.version(1).stores({
      photos: 'id, cached_event_slug',
    });
  }
}

const db = new EventPhotoCacheDatabase();

/** Cached photos for one event. Order is left to the caller, which re-sorts by
 *  the user's chosen sort anyway. */
export async function getCachedEventPhotos(eventSlug: string): Promise<Photo[]> {
  const rows = await db.photos.where('cached_event_slug').equals(eventSlug).toArray();
  return rows.map(({ cached_event_slug: _slug, ...photo }) => photo as Photo);
}

/**
 * Replaces the cached set for one event with exactly what the server returned.
 *
 * A plain bulkPut would only ever ADD: a photo deleted, trashed or moved to
 * another event would linger in the cache forever and keep rendering on every
 * open, since nothing would ever contradict it. So this also drops any cached row
 * for this event that is absent from `photos`.
 *
 * Only call this with a COMPLETE server response for the event. The gallery
 * endpoint returns the full set in one request, so that holds — but if it ever
 * gains pagination, this needs to become a merge plus a separate reconcile.
 */
export async function cacheEventPhotos(eventSlug: string, photos: Photo[]): Promise<void> {
  const rows: CachedEventPhoto[] = photos.map((photo) => ({ ...photo, cached_event_slug: eventSlug }));
  const fresh = new Set(photos.map((p) => p.id));

  await db.transaction('rw', db.photos, async () => {
    const existingIds = await db.photos.where('cached_event_slug').equals(eventSlug).primaryKeys();
    const stale = existingIds.filter((id) => !fresh.has(id));
    if (stale.length > 0) await db.photos.bulkDelete(stale);
    if (rows.length > 0) await db.photos.bulkPut(rows);
  });
}

/** Drops one event's cached photos (e.g. the event itself was deleted). */
export async function clearEventPhotoCache(eventSlug: string): Promise<void> {
  await db.photos.where('cached_event_slug').equals(eventSlug).delete();
}

/** Clears every event's cache. Called on logout, alongside clearTimelineCache(),
 *  so a shared device never leaks one account's private photos to the next. */
export async function clearAllEventPhotoCaches(): Promise<void> {
  await db.photos.clear();
}
