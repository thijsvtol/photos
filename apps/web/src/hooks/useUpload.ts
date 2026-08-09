import { useCallback } from 'react';
import { useUploadContext } from '../contexts/UploadContext';
import { useToast } from '../components/Toast';
import type { UploadQueueItem } from '../types';

/**
 * Thin wrapper around the global UploadContext.
 * Provides drag-drop/file-input handlers scoped to a specific event slug.
 * Upload processing itself happens in the global UploadManager singleton
 * so it survives page navigation. `isDragging` lives in the context so every
 * consumer (this hook may be called by multiple components) shares one flag.
 */
export function useUpload(slug: string | undefined) {
  const ctx = useUploadContext();
  const toast = useToast();
  const { isDragging, setIsDragging } = ctx;

  const queueItems = slug ? ctx.getItemsForSlug(slug) : ctx.queueItems;
  const hasActiveUploads = queueItems.some(i => i.status === 'uploading' || i.status === 'pending');
  const hasFailedUploads = queueItems.some(i => i.status === 'failed');
  const completedCount = queueItems.filter(i => i.status === 'completed').length;
  const totalCount = queueItems.length;

  const handleFiles = useCallback(async (files: FileList) => {
    if (!slug) return;
    const { rejected } = await ctx.addFiles(slug, files);
    if (rejected.length > 0) {
      const names = rejected.map(r => r.name).join(', ');
      toast.showError(
        rejected.length === 1
          ? `Couldn't upload "${names}": unsupported file type. Only JPEG/PNG/RAW photos and MP4 videos are supported.`
          : `Couldn't upload ${rejected.length} files (${names}): unsupported file type. Only JPEG/PNG/RAW photos and MP4 videos are supported.`
      );
    }
  }, [slug, ctx, toast]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
  }, [handleFiles]);

  const retryUpload = useCallback((item: UploadQueueItem) => {
    ctx.retryUpload(item.id);
  }, [ctx]);

  const retryAllFailed = useCallback(() => {
    ctx.retryAllFailed();
  }, [ctx]);

  return {
    queueItems,
    isDragging,
    hasActiveUploads,
    hasFailedUploads,
    completedCount,
    totalCount,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileInput,
    retryUpload,
    retryAllFailed,
  };
}
