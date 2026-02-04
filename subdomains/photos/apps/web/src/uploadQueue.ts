import Dexie, { Table } from 'dexie';
import type { UploadQueueItem } from './types';

class UploadDatabase extends Dexie {
  uploads!: Table<UploadQueueItem, string>;

  constructor() {
    super('PhotosUploadQueue');
    this.version(1).stores({
      uploads: 'id, eventSlug, status',
    });
  }
}

export const db = new UploadDatabase();

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

export const getQueueItems = async (eventSlug?: string): Promise<UploadQueueItem[]> => {
  if (eventSlug) {
    return await db.uploads.where('eventSlug').equals(eventSlug).toArray();
  }
  return await db.uploads.toArray();
};

export const getPendingUploads = async (eventSlug?: string): Promise<UploadQueueItem[]> => {
  const query = db.uploads.where('status').anyOf(['pending', 'uploading']);
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
