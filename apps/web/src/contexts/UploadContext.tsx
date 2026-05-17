import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { uploadManager } from '../services/uploadManager';
import type { UploadQueueItem } from '../types';

interface UploadContextValue {
  /** All queue items across all events */
  queueItems: UploadQueueItem[];
  /** Items for a specific event slug */
  getItemsForSlug: (slug: string) => UploadQueueItem[];
  /** Add files to the upload queue for an event */
  addFiles: (slug: string, files: FileList | File[]) => Promise<void>;
  /** Retry a single failed item */
  retryUpload: (itemId: string) => void;
  /** Retry all failed items */
  retryAllFailed: () => void;
  /** Clear completed items from the list */
  clearCompleted: () => void;
  /** Whether any uploads are currently active (uploading or pending) */
  hasActiveUploads: boolean;
  /** Whether any uploads have failed */
  hasFailedUploads: boolean;
  /** Total completed uploads */
  completedCount: number;
  /** Total items in queue */
  totalCount: number;
  /** 0-100 overall progress */
  overallProgress: number;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [queueItems, setQueueItems] = useState<UploadQueueItem[]>([]);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    // Initialise the singleton (loads from IndexedDB, sets up global listeners)
    uploadManager.init();
    // Subscribe to all state changes from the manager
    const unsubscribe = uploadManager.subscribe(setQueueItems);
    return unsubscribe;
  }, []);

  const addFiles = useCallback(
    (slug: string, files: FileList | File[]) => uploadManager.addFiles(slug, files),
    [],
  );

  const retryUpload = useCallback((id: string) => uploadManager.retryUpload(id), []);
  const retryAllFailed = useCallback(() => uploadManager.retryAllFailed(), []);
  const clearCompleted = useCallback(() => uploadManager.clearCompleted(), []);
  const getItemsForSlug = useCallback(
    (slug: string) => queueItems.filter(i => i.eventSlug === slug),
    [queueItems],
  );

  const hasActiveUploads = queueItems.some(i => i.status === 'uploading' || i.status === 'pending');

  // Warn before closing tab/browser if uploads active
  useEffect(() => {
    if (!hasActiveUploads) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasActiveUploads]);
  const hasFailedUploads = queueItems.some(i => i.status === 'failed');
  const completedCount = queueItems.filter(i => i.status === 'completed').length;
  const totalCount = queueItems.length;
  const overallProgress = totalCount > 0
    ? Math.round(queueItems.reduce((sum, i) => sum + i.progress, 0) / totalCount)
    : 0;

  const value: UploadContextValue = {
    queueItems,
    getItemsForSlug,
    addFiles,
    retryUpload,
    retryAllFailed,
    clearCompleted,
    hasActiveUploads,
    hasFailedUploads,
    completedCount,
    totalCount,
    overallProgress,
  };

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
};

export function useUploadContext(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUploadContext must be used within <UploadProvider>');
  return ctx;
}
