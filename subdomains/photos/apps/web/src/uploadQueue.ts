import type { UploadQueueItem } from './types';

// In-memory upload queue management
// Note: This simplified version uses memory instead of IndexedDB
// Files are not persisted across page reloads

const uploadQueue: UploadQueueItem[] = [];

export const addToQueue = async (item: UploadQueueItem): Promise<void> => {
  uploadQueue.push(item);
};

export const updateQueueItem = async (id: string, updates: Partial<UploadQueueItem>): Promise<void> => {
  const index = uploadQueue.findIndex(item => item.id === id);
  if (index !== -1) {
    uploadQueue[index] = { ...uploadQueue[index], ...updates };
  }
};

export const removeFromQueue = async (id: string): Promise<void> => {
  const index = uploadQueue.findIndex(item => item.id === id);
  if (index !== -1) {
    uploadQueue.splice(index, 1);
  }
};

export const getQueueItems = async (eventSlug?: string): Promise<UploadQueueItem[]> => {
  if (eventSlug) {
    return uploadQueue.filter(item => item.eventSlug === eventSlug);
  }
  return [...uploadQueue];
};

export const getPendingUploads = async (eventSlug?: string): Promise<UploadQueueItem[]> => {
  const items = uploadQueue.filter(item => 
    item.status === 'pending' || item.status === 'uploading'
  );
  if (eventSlug) {
    return items.filter(item => item.eventSlug === eventSlug);
  }
  return items;
};

export const clearCompletedUploads = async (eventSlug?: string): Promise<void> => {
  const indices: number[] = [];
  uploadQueue.forEach((item, index) => {
    if (item.status === 'completed' && (!eventSlug || item.eventSlug === eventSlug)) {
      indices.push(index);
    }
  });
  // Remove in reverse order to maintain indices
  indices.reverse().forEach(index => uploadQueue.splice(index, 1));
};

// Expose queue for debugging in development only
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).__uploadQueue = uploadQueue;
}
