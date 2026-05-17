/**
 * Global upload manager singleton.
 *
 * All upload processing (chunking, HTTP calls, progress) lives here so it
 * survives React component mount/unmount cycles (i.e. page navigation).
 * React components subscribe to state changes via the listener pattern.
 */
import { ulid } from 'ulid';
import ExifReader from 'exifreader';
import { startUpload, uploadPart, completeUpload } from '../api';
import { addToQueue, updateQueueItem, getQueueItems, getPendingUploads, removeFromQueue } from '../uploadQueue';
import { createPreview } from '../imageUtils';
import { extractMp4CreationTime } from '../utils/videoMetadata';
import type { UploadQueueItem } from '../types';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB for images
const VIDEO_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB for videos — fewer round-trips
const PARALLEL_CHUNKS = 4; // Upload up to 4 chunks simultaneously
const MAX_CHUNK_RETRIES = 3;
const CHUNK_RETRY_DELAY = 2000;

export type UploadManagerListener = (items: UploadQueueItem[]) => void;

class UploadManager {
  private items: Map<string, UploadQueueItem> = new Map();
  private processing = new Set<string>();
  private cancelled = new Set<string>();
  private listeners = new Set<UploadManagerListener>();
  private initialised = false;

  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe(listener: UploadManagerListener): () => void {
    this.listeners.add(listener);
    // Send current state immediately
    listener(this.getItems());
    return () => { this.listeners.delete(listener); };
  }

  private notify() {
    const snapshot = this.getItems();
    for (const fn of this.listeners) {
      try { fn(snapshot); } catch { /* swallow */ }
    }
  }

  getItems(): UploadQueueItem[] {
    return Array.from(this.items.values());
  }

  getItemsForSlug(slug: string): UploadQueueItem[] {
    return this.getItems().filter(i => i.eventSlug === slug);
  }

  get hasActiveUploads(): boolean {
    return this.getItems().some(i => i.status === 'uploading' || i.status === 'pending');
  }

  get hasFailedUploads(): boolean {
    return this.getItems().some(i => i.status === 'failed');
  }

  get completedCount(): number {
    return this.getItems().filter(i => i.status === 'completed').length;
  }

  get totalCount(): number {
    return this.items.size;
  }

  get overallProgress(): number {
    const items = this.getItems();
    if (items.length === 0) return 0;
    return Math.round(items.reduce((sum, i) => sum + i.progress, 0) / items.length);
  }

  /** Load persisted queue from IndexedDB on first access */
  async init() {
    if (this.initialised) return;
    this.initialised = true;
    try {
      const all = await getQueueItems();
      for (const item of all) {
        this.items.set(item.id, item);
      }
      this.notify();
      // Auto-resume anything pending/uploading (was interrupted)
      this.resumeAll();
    } catch (err) {
      console.error('[UploadManager] init failed:', err);
    }

    // Global resilience listeners
    window.addEventListener('online', () => this.resumeAll());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.resumeAll();
    });
  }

  /** Add files and start uploading */
  async addFiles(slug: string, files: FileList | File[]) {
    const supportedFiles = Array.from(files).filter(
      f => f.type === 'image/jpeg' || f.type === 'video/mp4'
    );

    for (const file of supportedFiles) {
      const id = ulid();
      const photoId = ulid();
      const isVideo = file.type === 'video/mp4';

      let exif: Record<string, unknown> = {};
      if (isVideo) {
        const sliceSize = Math.min(1024 * 1024, file.size);
        const buffer = await file.slice(0, sliceSize).arrayBuffer();
        const captureTime = extractMp4CreationTime(buffer) ?? new Date(file.lastModified).toISOString();
        exif = { captureTime };
      } else {
        exif = await this.extractExifData(file);
      }

      const item: UploadQueueItem = {
        id,
        eventSlug: slug,
        file,
        fileType: file.type,
        status: 'pending',
        progress: 0,
        photoId,
        ...exif,
      };

      await addToQueue(item);
      this.items.set(id, item);
      this.notify();
      this.processUpload(item);
    }
  }

  /** Retry a single failed upload */
  retryUpload(itemId: string) {
    const item = this.items.get(itemId);
    if (!item) return;
    const reset: UploadQueueItem = {
      ...item,
      status: 'pending',
      progress: 0,
      error: undefined,
      uploadId: undefined,
      parts: undefined,
    };
    this.items.set(itemId, reset);
    this.notify();
    updateQueueItem(itemId, { status: 'pending', progress: 0, error: undefined, uploadId: undefined, parts: undefined });
    this.processUpload(reset);
  }

  /** Retry all failed uploads */
  retryAllFailed() {
    for (const item of this.getItems()) {
      if (item.status === 'failed') this.retryUpload(item.id);
    }
  }

  /** Clear completed items from the list */
  clearCompleted() {
    for (const [id, item] of this.items) {
      if (item.status === 'completed') this.items.delete(id);
    }
    this.notify();
  }

  /** Cancel a single upload. Pending items are removed immediately; in-progress items are flagged and aborted after the current chunk. */
  cancelUpload(itemId: string) {
    const item = this.items.get(itemId);
    if (!item) return;
    if (item.status === 'pending') {
      this.items.delete(itemId);
      removeFromQueue(itemId);
    } else if (item.status === 'uploading') {
      this.cancelled.add(itemId);
      this.items.delete(itemId);
      removeFromQueue(itemId);
    }
    this.notify();
  }

  /** Cancel all pending and in-progress uploads */
  cancelAll() {
    for (const [id, item] of this.items) {
      if (item.status === 'pending' || item.status === 'uploading') {
        this.cancelUpload(id);
      }
    }
  }

  /** Resume any pending/failed uploads */
  private async resumeAll() {
    try {
      const pending = await getPendingUploads();
      for (const item of pending) {
        // Update our in-memory copy
        this.items.set(item.id, item);
        if (item.status === 'pending' || item.status === 'failed') {
          this.processUpload(item);
        }
      }
      this.notify();
    } catch (err) {
      console.error('[UploadManager] resumeAll failed:', err);
    }
  }

  /** Reload pending items from IndexedDB and start processing them.
   *  Use after external code (e.g. folder sync) adds items to the queue. */
  async refresh() {
    await this.resumeAll();
  }

  // ── Core upload logic (moved from useUpload hook) ──

  private async processUpload(item: UploadQueueItem) {
    if (this.processing.has(item.id)) return;
    if (this.cancelled.has(item.id)) { this.cancelled.delete(item.id); return; }
    this.processing.add(item.id);

    try {
      this.updateItem(item.id, { status: 'uploading' });
      await updateQueueItem(item.id, { status: 'uploading' });

      // Ensure photoId exists (folder-sync items may not have one)
      const photoId = item.photoId || ulid();
      if (!item.photoId) {
        this.updateItem(item.id, { photoId });
        await updateQueueItem(item.id, { photoId });
      }

      // Infer fileType from the File object if not set (folder-sync items)
      const fileType = item.fileType || item.file.type || 'image/jpeg';
      if (!item.fileType) {
        this.updateItem(item.id, { fileType });
        await updateQueueItem(item.id, { fileType });
      }

      const isVideo = fileType === 'video/mp4';

      // Extract EXIF data on-the-fly if not already present (folder-sync items)
      let exifData: Partial<UploadQueueItem> = {};
      if (!item.captureTime) {
        try {
          if (isVideo) {
            const sliceSize = Math.min(1024 * 1024, item.file.size);
            const buffer = await item.file.slice(0, sliceSize).arrayBuffer();
            const captureTime = extractMp4CreationTime(buffer) ?? new Date(item.file.lastModified).toISOString();
            exifData = { captureTime };
          } else {
            exifData = await this.extractExifData(item.file);
          }
          this.updateItem(item.id, exifData);
          await updateQueueItem(item.id, exifData);
        } catch { /* proceed without EXIF */ }
      }

      const merged = { ...item, photoId, fileType, ...exifData };

      let previewBlob: Blob | null = null;
      if (!isVideo) previewBlob = await createPreview(item.file);

      const { uploadId } = await startUpload(
        merged.eventSlug, photoId, item.file.name,
        merged.captureTime, merged.width, merged.height, merged.iso,
        merged.aperture, merged.shutterSpeed, merged.focalLength,
        merged.cameraMake, merged.cameraModel, merged.lensModel,
        merged.latitude, merged.longitude, merged.blurPlaceholder,
        false, fileType,
      );
      await updateQueueItem(item.id, { uploadId });

      const chunkSize = isVideo ? VIDEO_CHUNK_SIZE : CHUNK_SIZE;
      const totalParts = Math.ceil(item.file.size / chunkSize);
      const originalProgressMax = isVideo ? 100 : 80;
      const partsCompleted: Array<{ partNumber: number; etag: string }> = [];
      let completedChunks = 0;

      // Upload chunks in parallel batches for speed
      for (let batchStart = 1; batchStart <= totalParts; batchStart += PARALLEL_CHUNKS) {
        const batchEnd = Math.min(batchStart + PARALLEL_CHUNKS - 1, totalParts);
        const batch: Promise<{ partNumber: number; etag: string }>[] = [];

        for (let partNumber = batchStart; partNumber <= batchEnd; partNumber++) {
          const start = (partNumber - 1) * chunkSize;
          const end = Math.min(start + chunkSize, item.file.size);
          const chunk = item.file.slice(start, end);
          batch.push(
            this.uploadChunkWithRetry(
              item.eventSlug, photoId, uploadId, partNumber, chunk, false, fileType,
            ).then(({ etag }) => ({ partNumber, etag }))
          );
        }

        const results = await Promise.all(batch);
        partsCompleted.push(...results);
        completedChunks += results.length;

        // Check for cancellation between batches
        if (this.cancelled.has(item.id)) {
          this.cancelled.delete(item.id);
          this.processing.delete(item.id);
          return;
        }

        const progress = Math.round((completedChunks / totalParts) * originalProgressMax);
        this.updateItem(item.id, { progress, parts: [...partsCompleted] });
        await updateQueueItem(item.id, { progress, parts: [...partsCompleted] });
      }

      // Sort parts by partNumber for completeUpload (R2 requires ordered parts)
      partsCompleted.sort((a, b) => a.partNumber - b.partNumber);

      await completeUpload(item.eventSlug, photoId, uploadId, partsCompleted);

      if (isVideo) {
        this.updateItem(item.id, { status: 'completed', progress: 100 });
        await updateQueueItem(item.id, { status: 'completed', progress: 100 });
      } else {
        this.updateItem(item.id, { progress: 85 });
        await updateQueueItem(item.id, { progress: 85 });
        await this.uploadPreview(item.eventSlug, photoId, previewBlob!);
        this.updateItem(item.id, { status: 'completed', progress: 100 });
        await updateQueueItem(item.id, { status: 'completed', progress: 100 });
      }
    } catch (err) {
      const currentRetries = ((this.items.get(item.id)?.retries) || 0) + 1;
      const errorMsg = err instanceof Error ? err.message : String(err);
      const updates = {
        status: 'failed' as const,
        error: `Upload failed: ${errorMsg}`,
        retries: currentRetries,
        lastRetryTime: Date.now(),
      };
      this.updateItem(item.id, updates);
      await updateQueueItem(item.id, updates);
    } finally {
      this.processing.delete(item.id);
    }
  }

  private updateItem(id: string, updates: Partial<UploadQueueItem>) {
    const existing = this.items.get(id);
    if (existing) {
      this.items.set(id, { ...existing, ...updates });
      this.notify();
    }
  }

  private async uploadPreview(eventSlug: string, photoId: string, previewBlob: Blob) {
    const { uploadId } = await startUpload(
      eventSlug, photoId, `${photoId}_preview.jpg`,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, true,
    );
    const parts: Array<{ partNumber: number; etag: string }> = [];
    const totalParts = Math.ceil(previewBlob.size / CHUNK_SIZE);
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const start = (partNumber - 1) * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, previewBlob.size);
      const chunk = previewBlob.slice(start, end);
      const { etag } = await this.uploadChunkWithRetry(eventSlug, photoId, uploadId, partNumber, chunk, true);
      parts.push({ partNumber, etag });
    }
    await completeUpload(eventSlug, photoId, uploadId, parts, true);
  }

  private async uploadChunkWithRetry(
    eventSlug: string, photoId: string, uploadId: string,
    partNumber: number, chunk: Blob, isPreview?: boolean, fileType?: string,
  ): Promise<{ etag: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
      try {
        return await uploadPart(eventSlug, photoId, uploadId, partNumber, chunk, isPreview, fileType);
      } catch (err) {
        lastError = err;
        if (attempt < MAX_CHUNK_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, CHUNK_RETRY_DELAY * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  // ── EXIF helpers ──

  private parseExifDate(exifDate: string): string | undefined {
    try {
      const cleaned = exifDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      const date = new Date(cleaned);
      if (isNaN(date.getTime())) return undefined;
      return date.toISOString();
    } catch { return undefined; }
  }

  private async extractExifData(file: File) {
    try {
      const buffer = await file.arrayBuffer();
      const tags = ExifReader.load(buffer);

      const captureTime = tags.DateTimeOriginal?.description;
      const width = tags.PixelXDimension?.value || tags['Image Width']?.value;
      const height = tags.PixelYDimension?.value || tags['Image Height']?.value;
      const iso = tags.ISOSpeedRatings?.value;
      const aperture = tags.FNumber?.description;
      const shutterSpeed = tags.ExposureTime?.description;
      const focalLength = tags.FocalLength?.description;
      const cameraMake = tags.Make?.description;
      const cameraModel = tags.Model?.description;
      const lensModel = tags.LensModel?.description;

      let latitude: number | undefined;
      let longitude: number | undefined;
      if (tags.GPSLatitude && tags.GPSLongitude) {
        latitude = parseFloat(tags.GPSLatitude.description);
        longitude = parseFloat(tags.GPSLongitude.description);
      }

      let blurPlaceholder: string | undefined;
      try {
        const img = new Image();
        const url = URL.createObjectURL(file);
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
        const canvas = document.createElement('canvas');
        canvas.width = 16; canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (ctx) { ctx.drawImage(img, 0, 0, 16, 16); blurPlaceholder = canvas.toDataURL('image/jpeg', 0.3); }
        URL.revokeObjectURL(url);
      } catch { /* ignore */ }

      return {
        captureTime: captureTime ? this.parseExifDate(captureTime) : undefined,
        width: typeof width === 'number' ? width : undefined,
        height: typeof height === 'number' ? height : undefined,
        iso: typeof iso === 'number' ? iso : undefined,
        aperture: aperture || undefined,
        shutterSpeed: shutterSpeed || undefined,
        focalLength: focalLength || undefined,
        cameraMake: cameraMake || undefined,
        cameraModel: cameraModel || undefined,
        lensModel: lensModel || undefined,
        latitude: latitude || undefined,
        longitude: longitude || undefined,
        blurPlaceholder: blurPlaceholder || undefined,
      };
    } catch { return {}; }
  }
}

/** Module-level singleton — survives across all React component lifecycles */
export const uploadManager = new UploadManager();
