import Dexie, { Table } from 'dexie';
import type { UploadQueueItem } from './types';

/**
 * IndexedDB-backed upload queue for persistent storage
 * Files and upload state persist across page reloads and browser restarts
 */
class UploadDatabase extends Dexie {
  uploads!: Table<UploadQueueItem, string>;

  constructor() {
    super('PhotosUploadQueue');
    this.version(1).stores({
      uploads: 'id, eventSlug, status',
    });
  }
}

const db = new UploadDatabase();

// Queue management functions
export const addToQueue = async (item: UploadQueueItem): Promise<void> => {
  await db.uploads.add(item);
};

export const updateQueueItem = async (id: string, updates: Partial<UploadQueueItem>): Promise<void> => {
  await db.uploads.update(id, updates);
};

export const removeFromQueue = async (id: string): Promise<void> => {
  await db.uploads.delete(id);
};

export const getQueueItem = async (id: string): Promise<UploadQueueItem | undefined> => {
  return await db.uploads.get(id);
};

export const getQueueItems = async (eventSlug?: string): Promise<UploadQueueItem[]> => {
  if (eventSlug) {
    return await db.uploads.where('eventSlug').equals(eventSlug).toArray();
  }
  return await db.uploads.toArray();
};

export const getPendingUploads = async (eventSlug?: string): Promise<UploadQueueItem[]> => {
  // Include 'failed' items too, so callers (uploadManager.resumeAll(),
  // backgroundSync.uploadBatch()) can automatically retry them on
  // reconnect/app-foreground/reload instead of requiring a manual "Retry"
  // click. Callers are responsible for gating retries (backoff/attempt
  // limits) so a permanently-broken upload isn't hammered forever.
  const query = db.uploads.where('status').anyOf(['pending', 'uploading', 'failed']);
  if (eventSlug) {
    return await query.and(item => item.eventSlug === eventSlug).toArray();
  }
  return await query.toArray();
};

export const clearCompletedUploads = async (eventSlug?: string): Promise<void> => {
  const query = db.uploads.where('status').equals('completed');
  if (eventSlug) {
    const items = await query.and(item => item.eventSlug === eventSlug).toArray();
    await Promise.all(items.map(item => db.uploads.delete(item.id)));
  } else {
    await query.delete();
  }
};

/**
 * One-time migration off the old JS folder-sync pipeline: drops every
 * unfinished queue item, returning how many were removed.
 *
 * Until this release, folder sync read each discovered file fully into memory
 * and stored the resulting `File` blob here BEFORE uploading anything, so a
 * single scan of a camera roll could leave gigabytes of blobs in this store.
 * uploadManager.init() calls getQueueItems(), which deserializes all of them at
 * startup — enough on its own to take the WebView out of memory before the app
 * finishes booting. Folder sync no longer writes here at all (the native engine
 * streams from content:// URIs and keeps its own metadata-only ledger), so
 * these rows are pure dead weight.
 *
 * This deliberately drops unfinished MANUAL uploads too. There is no marker on
 * a queue item saying which pipeline created it, and the trade is one-sided: an
 * over-purge costs a re-pick of files that are still sitting on the device,
 * while an under-purge leaves the startup OOM this release exists to fix.
 * Folder-sync content is never re-uploaded regardless — the native ledger and
 * the server-side hash pre-check both suppress it. Runs exactly once, guarded
 * by a localStorage flag in folderSync.ts.
 */
export const purgeFolderSyncQueueItems = async (): Promise<number> => {
  const stale = await db.uploads.where('status').anyOf(['pending', 'uploading', 'failed']).toArray();
  if (stale.length === 0) return 0;
  await db.uploads.bulkDelete(stale.map(item => item.id));
  return stale.length;
};

// Expose database for debugging in development only
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).__uploadDB = db;
}
