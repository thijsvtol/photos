/**
 * Global upload manager singleton.
 *
 * All upload processing (chunking, HTTP calls, progress) lives here so it
 * survives React component mount/unmount cycles (i.e. page navigation).
 * React components subscribe to state changes via the listener pattern.
 */
import { ulid } from 'ulid';
import { Capacitor } from '@capacitor/core';
import ExifReader from 'exifreader';
import axios from 'axios';
import { startUpload, uploadPart, completeUpload, cancelUpload as cancelUploadApi } from '../api';
import { addToQueue, updateQueueItem, getQueueItem, getQueueItems, getPendingUploads, removeFromQueue, clearCompletedUploads } from '../uploadQueue';
import { createPreview, computeFileHash } from '../imageUtils';
import { isRawFile, isRawFileType, getRawFileType, createRawPreview, createRawPlaceholder } from '../rawImageUtils';
import { extractMp4CreationTime, isVideoFile, normalizeVideoFileType } from '../utils/videoMetadata';
import type { UploadQueueItem } from '../types';

/** A file the user tried to upload that isn't a supported image/video/RAW type. */
export interface RejectedUploadFile {
  name: string;
  reason: string;
}

/** Whether a file is one of the plain (non-RAW) image types we accept as-is. */
export function isSupportedImageType(file: File): boolean {
  return file.type === 'image/jpeg' || file.type === 'image/png';
}

/**
 * HTTP status codes that indicate the request itself is invalid/rejected
 * rather than a transient network/server problem — retrying the exact same
 * chunk won't help. Everything else (network errors with no response,
 * timeouts, 5xx, 429 rate limiting) is treated as retryable.
 */
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404; // upload session gone/expired
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_UNPROCESSABLE_ENTITY = 422;
const NON_RETRYABLE_STATUS_CODES = new Set([
  HTTP_BAD_REQUEST,
  HTTP_UNAUTHORIZED,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_PAYLOAD_TOO_LARGE,
  HTTP_UNPROCESSABLE_ENTITY,
]);

export function isNonRetryableUploadError(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    return status !== undefined && NON_RETRYABLE_STATUS_CODES.has(status);
  }
  return false;
}

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB for images
const VIDEO_CHUNK_SIZE = 10 * 1024 * 1024; // base 10MB for videos — fewer round-trips
// R2's multipart upload API caps a single object at 10,000 parts. A flat 10MB
// video chunk size hits that ceiling at just 100GB (10,000 * 10MB), leaving no
// margin for supporting the large (up to ~100GB) video uploads this app needs
// to handle. Scale the chunk size up for large files so the part count stays
// well under the limit, while capping the per-request chunk size well below
// a Cloudflare Worker's ~128MB memory limit — the worker buffers each part's
// body into memory via `c.req.arrayBuffer()` before forwarding it to R2, so a
// too-large chunk would crash the Worker outright, not just be slow.
const VIDEO_CHUNK_TARGET_MAX_PARTS = 2000; // stay well under R2's 10,000-part ceiling
const VIDEO_CHUNK_MAX_SIZE = 64 * 1024 * 1024; // 64MB cap per part (well under Workers' 128MB memory limit)
function computeVideoChunkSize(fileSize: number): number {
  const sizeAtBaseChunking = VIDEO_CHUNK_SIZE * VIDEO_CHUNK_TARGET_MAX_PARTS; // ~19.5GB
  if (fileSize <= sizeAtBaseChunking) return VIDEO_CHUNK_SIZE;
  const scaled = Math.ceil(fileSize / VIDEO_CHUNK_TARGET_MAX_PARTS);
  return Math.min(scaled, VIDEO_CHUNK_MAX_SIZE);
}
const PARALLEL_CHUNKS = 4; // Upload up to 4 chunks simultaneously
const MAX_CHUNK_RETRIES = 3;
const CHUNK_RETRY_DELAY = 2000;
// Whole-file auto-retry limit (distinct from MAX_CHUNK_RETRIES, which only
// covers a single chunk's HTTP retries). Once an item's `retries` count
// reaches this, resumeAll() stops auto-retrying it — only a manual
// "Retry"/"Retry all" click will try again — so a permanently-broken upload
// isn't hammered forever.
export const MAX_RETRIES = 5;
const RETRY_BACKOFF_BASE_MS = 2000;
// Cap how many files are uploaded at once on the web (foreground) path.
// Without this, selecting many/large files (photos + videos) fires off an
// unbounded number of concurrent uploads, each already doing up to
// PARALLEL_CHUNKS simultaneous chunk requests — this floods the browser's
// connection pool and often exhausts memory (each file is fully read for
// EXIF/preview/video-metadata extraction), causing large batches to fail.
//
// The cap is adaptive: on a fast connection (4g/wifi and no data-saver) more
// files upload in parallel for better throughput; on a slow/metered
// connection (2g/3g or Save-Data enabled) it's kept low to avoid flooding a
// constrained pipe. Falls back to a safe default of 3 when the Network
// Information API isn't available (e.g. Safari/iOS).
const MIN_CONCURRENT_UPLOADS = 2;
const DEFAULT_CONCURRENT_UPLOADS = 3;
const MAX_CONCURRENT_UPLOADS_FAST = 6;

interface NetworkInformationLike {
  effectiveType?: '2g' | '3g' | '4g' | 'slow-2g';
  saveData?: boolean;
  downlink?: number;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

function getNetworkInformation(): NetworkInformationLike | undefined {
  const nav = navigator as Navigator & {
    connection?: NetworkInformationLike;
    mozConnection?: NetworkInformationLike;
    webkitConnection?: NetworkInformationLike;
  };
  return nav.connection || nav.mozConnection || nav.webkitConnection;
}

function getAdaptiveConcurrency(): number {
  const conn = getNetworkInformation();
  if (!conn) return DEFAULT_CONCURRENT_UPLOADS;
  if (conn.saveData) return MIN_CONCURRENT_UPLOADS;
  switch (conn.effectiveType) {
    case 'slow-2g':
    case '2g':
      return MIN_CONCURRENT_UPLOADS;
    case '3g':
      return DEFAULT_CONCURRENT_UPLOADS;
    case '4g':
      return MAX_CONCURRENT_UPLOADS_FAST;
    default:
      // Unknown effectiveType but a numeric downlink estimate is available —
      // treat a fast reported downlink (>= 10 Mbps) the same as 4g.
      if (typeof conn.downlink === 'number' && conn.downlink >= 10) return MAX_CONCURRENT_UPLOADS_FAST;
      return DEFAULT_CONCURRENT_UPLOADS;
  }
}

export type UploadManagerListener = (items: UploadQueueItem[]) => void;

class UploadManager {
  private items: Map<string, UploadQueueItem> = new Map();
  private processing = new Set<string>();
  private cancelled = new Set<string>();
  private listeners = new Set<UploadManagerListener>();
  private initialised = false;
  /** Files waiting for a processing slot (see MAX_CONCURRENT_UPLOADS). */
  private uploadQueue: UploadQueueItem[] = [];

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
        // Don't reload completed items from previous sessions —
        // they cause ghost "X uploads complete" notifications.
        if (item.status === 'completed') continue;
        this.items.set(item.id, item);
      }
      // Purge stale completed items from IndexedDB
      clearCompletedUploads().catch(() => {});
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

    // If the connection quality improves mid-upload (e.g. switching from
    // cellular to wifi), pump the queue so additional queued items can start
    // taking advantage of the now-higher concurrency cap right away instead
    // of waiting for the next item to finish.
    getNetworkInformation()?.addEventListener?.('change', () => this.pumpQueue());
  }

  /** Add files and start uploading.
   *
   *  On native, manual uploads reuse the same background-sync + notification
   *  pipeline that folder sync uses: items are enqueued and then handed to
   *  backgroundSyncService, which shows the persistent progress notification,
   *  survives app-close (BackgroundTask.beforeExit), and resumes on relaunch.
   *  On web there is no such pipeline, so we process in the foreground and let
   *  the GlobalUploadIndicator render live progress. */
  async addFiles(slug: string, files: FileList | File[]): Promise<{ rejected: RejectedUploadFile[] }> {
    const supportedFiles: File[] = [];
    const rejected: RejectedUploadFile[] = [];

    for (const f of Array.from(files)) {
      if (isSupportedImageType(f) || isVideoFile(f.type, f.name) || isRawFile(f)) {
        supportedFiles.push(f);
      } else {
        rejected.push({
          name: f.name,
          reason: f.type
            ? `Unsupported file type "${f.type}"`
            : 'Unsupported or unrecognized file type',
        });
      }
    }

    // Nothing to do — bail out before touching the queue.
    if (supportedFiles.length === 0) return { rejected };

    // Enqueue every item immediately with bare-bones metadata so the UI
    // (GlobalUploadIndicator) can show the upload popup right away instead
    // of only after EXIF/video-metadata has been extracted from every file
    // one by one — that extraction can take several seconds for large
    // batches and was delaying the popup's first appearance noticeably.
    // captureTime/EXIF are extracted lazily by processUpload() when missing,
    // so it's safe to skip them here.
    const enqueued: UploadQueueItem[] = [];
    for (const file of supportedFiles) {
      const id = ulid();
      const photoId = ulid();
      // RAW files are identified by extension (not MIME type, which browsers
      // frequently leave blank/vendor-specific for RAW containers). Tag them
      // with `raw/<ext>` so the rest of the pipeline can tell the worker to
      // store the original with its real extension while still generating a
      // normal JPEG preview.
      const fileType = isRawFile(file) ? getRawFileType(file) : normalizeVideoFileType(file.type, file.name);

      const item: UploadQueueItem = {
        id,
        eventSlug: slug,
        file,
        fileType,
        status: 'pending',
        progress: 0,
        photoId,
      };

      await addToQueue(item);
      this.items.set(id, item);
      enqueued.push(item);
    }

    this.notify();

    if (Capacitor.isNativePlatform()) {
      // Delegate to the background-sync pipeline (progress notifications,
      // survives app-close, resumes on relaunch) — same as folder sync.
      // Dynamic import avoids a circular dependency: backgroundSync.ts imports
      // this module (uploadManager) at the top level, so importing it back
      // statically here would create an import cycle.
      try {
        const { backgroundSyncService } = await import('./backgroundSync');
        await backgroundSyncService.syncNow();
        // Reconcile in-memory state (GlobalUploadIndicator) with the final
        // statuses the background pipeline wrote to IndexedDB.
        const latest = await getQueueItems();
        for (const it of latest) {
          if (this.items.has(it.id)) this.items.set(it.id, it);
        }
        this.notify();
      } catch (err) {
        console.error('[UploadManager] background sync delegation failed, falling back to foreground:', err);
        for (const item of enqueued) this.enqueueUpload(item);
      }
    } else {
      for (const item of enqueued) this.enqueueUpload(item);
    }

    return { rejected };
  }


  /** Retry a single failed upload.
   *
   *  Deliberately keeps `uploadId`/`parts`/`progress` intact — processUpload()
   *  uses them to resume the existing R2 multipart upload from the last
   *  successfully uploaded chunk instead of restarting the whole file from 0%. */
  retryUpload(itemId: string) {
    const item = this.items.get(itemId);
    if (!item) return;
    const reset: UploadQueueItem = {
      ...item,
      status: 'pending',
      error: undefined,
    };
    this.items.set(itemId, reset);
    this.notify();
    updateQueueItem(itemId, { status: 'pending', error: undefined });
    this.enqueueUpload(reset);
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

  /** Cancel a single upload — always available, regardless of status.
   *  Removes the item from the local queue immediately (so the UI never
   *  gets stuck), and best-effort cleans up any half-uploaded data on the
   *  backend (aborts the R2 multipart upload and deletes the orphaned photo
   *  row) so cancelled uploads never linger as "half uploaded photos". */
  cancelUpload(itemId: string) {
    const item = this.items.get(itemId);
    if (!item) return;

    if (item.status === 'uploading') {
      // Ask the in-flight chunk loop to stop after its current batch.
      this.cancelled.add(itemId);
    }

    this.items.delete(itemId);
    removeFromQueue(itemId);
    this.notify();

    // Clean up server-side state for anything that ever reached /start
    // (pending items that were never sent don't have a photoId server-side
    // yet if photoId is unset, but addFiles always assigns one up-front, so
    // we conservatively always attempt cleanup — the endpoint is a no-op if
    // there's nothing to clean up).
    if (item.photoId) {
      cancelUploadApi(item.eventSlug, item.photoId, { uploadId: item.uploadId, fileType: item.fileType }).catch(err => {
        console.warn('[UploadManager] Failed to clean up cancelled upload on server:', err);
      });
    }
  }

  /** Cancel all pending, in-progress and failed uploads */
  cancelAll() {
    for (const [id, item] of this.items) {
      if (item.status === 'pending' || item.status === 'uploading' || item.status === 'failed') {
        this.cancelUpload(id);
      }
    }
  }

  /** Whether a failed item is due for an automatic retry: gated by both
   *  MAX_RETRIES (give up permanently past a point) and an exponential
   *  backoff since its last attempt, so a persistently-broken upload isn't
   *  hammered on every reconnect/foreground/reload event. */
  private shouldAutoRetry(item: UploadQueueItem): boolean {
    const retries = item.retries || 0;
    if (retries >= MAX_RETRIES) return false;
    const lastRetryTime = item.lastRetryTime || 0;
    const backoffDelay = RETRY_BACKOFF_BASE_MS * Math.pow(2, retries);
    return Date.now() - lastRetryTime >= backoffDelay;
  }

  /** Resume any pending/failed/interrupted uploads */
  private async resumeAll() {
    try {
      const pending = await getPendingUploads();
      for (const item of pending) {
        // Skip items that are currently being processed to avoid overwriting live progress
        if (this.processing.has(item.id)) continue;

        // Items stuck as 'uploading' in IndexedDB were interrupted (app was
        // killed/reloaded mid-upload). Reset their status to 'pending' so
        // they get picked up again, but keep uploadId/parts/progress intact —
        // processUpload() will resume the existing R2 multipart upload from
        // the last successfully uploaded chunk instead of restarting the
        // whole file from 0%.
        if (item.status === 'uploading') {
          item.status = 'pending';
          await updateQueueItem(item.id, { status: 'pending' });
        }

        this.items.set(item.id, item);
        if (item.status === 'pending') {
          this.enqueueUpload(item);
        } else if (item.status === 'failed' && this.shouldAutoRetry(item)) {
          this.retryUpload(item.id);
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

  /**  Merge a live status/progress update into the in-memory state and notify
   *  listeners (e.g. GlobalUploadIndicator). Used by backgroundSync (native)
   *  so the on-screen upload list reflects the same progress as the native
   *  notification in real time, instead of only jumping to the final state
   *  once the whole batch finishes. If the item isn't tracked yet (e.g. a
   *  folder-sync item processed before a refresh()/resumeAll() call, or a
   *  Share-to-app item added straight to the Dexie queue — see
   *  ShareUpload.tsx — that backgroundSync then uploads directly without
   *  ever going through this manager's own addFiles()/enqueueUpload()), the
   *  partial `updates` alone is added to the map immediately so it becomes
   *  visible right away, but is ALSO backfilled from Dexie asynchronously
   *  (which has the real `File` object — IndexedDB/Dexie can store Blobs)
   *  and merged in via a follow-up notify() once that resolves. Without
   *  this backfill, `faceDetectionQueue.ts`'s subscribe listener would see
   *  a `status: 'completed'` item with NO `file` and silently skip face
   *  detection entirely for every upload that took this path — this was a
   *  real, confirmed bug (fixed 2026-08-06): Share-to-app uploads never got
   *  faces detected because the map only ever received `{status:
   *  'completed', progress, photoId}`, never the file. */
  syncItemProgress(id: string, updates: Partial<UploadQueueItem>) {
    const existing = this.items.get(id);
    if (existing) {
      this.updateItem(id, updates);
    } else {
      this.items.set(id, { ...updates, id } as UploadQueueItem);
      this.notify();
      void getQueueItem(id).then((full) => {
        if (!full) return;
        // Re-merge in case `updates` (already applied above) is newer than
        // what's currently in Dexie by the time this resolves.
        const current = this.items.get(id);
        this.items.set(id, { ...full, ...current });
        this.notify();
      }).catch((err) => {
        console.warn('[UploadManager] Failed to backfill queue item from Dexie:', id, err);
      });
    }
  }

  // ── Core upload logic (moved from useUpload hook) ──

  /** Queue an item for processing, respecting the adaptive concurrency cap. */
  private enqueueUpload(item: UploadQueueItem) {
    if (this.processing.size < getAdaptiveConcurrency()) {
      this.processUpload(item);
    } else {
      this.uploadQueue.push(item);
    }
  }

  /** Pull the next queued item(s) into processing once a slot frees up. */
  private pumpQueue() {
    while (this.uploadQueue.length > 0 && this.processing.size < getAdaptiveConcurrency()) {
      const next = this.uploadQueue.shift()!;
      this.processUpload(next);
    }
  }

  private async processUpload(item: UploadQueueItem) {
    if (this.processing.has(item.id)) return;
    if (this.cancelled.has(item.id)) { this.cancelled.delete(item.id); return; }
    this.processing.add(item.id);

    // Hoisted so the catch block below can abort the in-progress R2
    // multipart upload (if any) when giving up permanently. originalDone
    // tracks whether the *original* file's multipart upload has already been
    // completed (server-side), so we never clear uploadId/parts — and never
    // try to abort an already-finished upload — once only the preview
    // remains, which would otherwise force a wasteful full re-upload later.
    let currentUploadId: string | undefined = item.uploadId;
    let originalDone = false;

    try {
      this.updateItem(item.id, { status: 'uploading', phase: 'original' });
      await updateQueueItem(item.id, { status: 'uploading', phase: 'original' });

      // Ensure photoId exists (folder-sync items may not have one)
      const photoId = item.photoId || ulid();
      if (!item.photoId) {
        this.updateItem(item.id, { photoId });
        await updateQueueItem(item.id, { photoId });
      }

      // Infer fileType from the File object if not set (folder-sync items) — normalized so a
      // stray 'video/quicktime' (or similar) that slipped through some other enqueue path never
      // reaches the backend, which only understands 'video/mp4' for video (see
      // normalizeVideoFileType()'s doc comment in utils/videoMetadata.ts).
      const fileType = item.fileType || normalizeVideoFileType(item.file.type, item.file.name) || 'image/jpeg';
      if (!item.fileType) {
        this.updateItem(item.id, { fileType });
        await updateQueueItem(item.id, { fileType });
      }

      const isVideo = fileType === 'video/mp4';

      // Extract metadata on-the-fly if not already present (folder-sync items)
      let exifData: Partial<UploadQueueItem> = {};
      if (isVideo) {
        // Capture time (if missing)
        if (!item.captureTime) {
          try {
            const sliceSize = Math.min(1024 * 1024, item.file.size);
            const buffer = await item.file.slice(0, sliceSize).arrayBuffer();
            const captureTime = extractMp4CreationTime(buffer) ?? new Date(item.file.lastModified).toISOString();
            exifData = { ...exifData, captureTime };
          } catch { /* proceed without capture time */ }
        }
        // Dimensions + poster so the gallery grid can render the video correctly.
        // Without width/height the justified grid falls back to a wrong 4:3 ratio,
        // and without a poster native tiles render blank.
        if (item.width == null || item.height == null || !item.blurPlaceholder) {
          try {
            const videoMeta = await this.extractVideoMetadata(item.file);
            exifData = { ...exifData, ...videoMeta };
          } catch { /* proceed without video metadata */ }
        }
      } else if (!item.captureTime) {
        try {
          exifData = await this.extractExifData(item.file);
        } catch { /* proceed without EXIF */ }
      }

      if (Object.keys(exifData).length > 0) {
        this.updateItem(item.id, exifData);
        await updateQueueItem(item.id, exifData);
      }

      // Compute a content hash for duplicate detection (images/RAW only —
      // skipped for video to avoid reading large files fully into memory).
      // Cached on the item so a retry never re-hashes the same file.
      let fileHash = item.fileHash;
      if (!isVideo && !fileHash) {
        fileHash = await computeFileHash(item.file);
        if (fileHash) {
          this.updateItem(item.id, { fileHash });
          await updateQueueItem(item.id, { fileHash });
        }
      }

      const merged = { ...item, photoId, fileType, fileHash, ...exifData };

      let previewBlob: Blob | null = null;
      if (!isVideo) {
        // Browsers/canvas can't decode RAW containers directly, so RAW files
        // get a dedicated WASM decode path (falls back to a generic
        // placeholder internally if decoding fails — never throws).
        previewBlob = isRawFileType(fileType)
          ? await createRawPreview(item.file).catch(() => createRawPlaceholder())
          : await createPreview(item.file);
      }

      const chunkSize = isVideo ? computeVideoChunkSize(item.file.size) : CHUNK_SIZE;
      const totalParts = Math.ceil(item.file.size / chunkSize);
      const originalProgressMax = isVideo ? 100 : 80;

      const startOriginalUpload = () => startUpload(
        merged.eventSlug, photoId, item.file.name,
        merged.captureTime, merged.width, merged.height, merged.iso,
        merged.aperture, merged.shutterSpeed, merged.focalLength,
        merged.cameraMake, merged.cameraModel, merged.lensModel,
        merged.latitude, merged.longitude, merged.blurPlaceholder,
        false, fileType, merged.fileHash,
      );

      // Once the original file has already fully uploaded (a previous attempt
      // got as far as completeUpload but then failed during the preview
      // upload), skip re-uploading the original entirely — only the preview
      // is missing.
      const originalAlreadyUploaded = !isVideo && item.progress >= originalProgressMax && item.uploadId !== undefined;
      if (originalAlreadyUploaded) originalDone = true;

      if (!originalAlreadyUploaded) {
        // Resume support: if a previous attempt already uploaded some chunks
        // (uploadId + parts persisted from before a failure/interruption),
        // reuse that same R2 multipart upload and only send the chunks that
        // are still missing, instead of discarding that progress and
        // re-uploading the whole file from 0%.
        let uploadId = item.uploadId;
        let partsCompleted: Array<{ partNumber: number; etag: string }> =
          item.progress < originalProgressMax ? [...(item.parts || [])] : [];
        let resuming = !!uploadId && partsCompleted.length > 0 && partsCompleted.length < totalParts;

        if (!resuming) {
          partsCompleted = [];
          const started = await startOriginalUpload();
          uploadId = started.uploadId;
          currentUploadId = uploadId;
          await updateQueueItem(item.id, { uploadId, parts: [] });
        }

        const uploadRemainingParts = async (): Promise<boolean> => {
          const completedPartNumbers = new Set(partsCompleted.map(p => p.partNumber));
          let completedChunks = partsCompleted.length;
          const remaining: number[] = [];
          for (let n = 1; n <= totalParts; n++) {
            if (!completedPartNumbers.has(n)) remaining.push(n);
          }

          // Upload chunks in parallel batches for speed
          for (let batchStart = 0; batchStart < remaining.length; batchStart += PARALLEL_CHUNKS) {
            const batchNumbers = remaining.slice(batchStart, batchStart + PARALLEL_CHUNKS);
            const batch = batchNumbers.map(partNumber => {
              const start = (partNumber - 1) * chunkSize;
              const end = Math.min(start + chunkSize, item.file.size);
              const chunk = item.file.slice(start, end);
              return this.uploadChunkWithRetry(
                item.eventSlug, photoId, uploadId!, partNumber, chunk, false, fileType,
              ).then(({ etag }) => ({ partNumber, etag }));
            });

            const results = await Promise.all(batch);
            partsCompleted.push(...results);
            completedChunks += results.length;

            // Check for cancellation between batches
            if (this.cancelled.has(item.id)) {
              this.cancelled.delete(item.id);
              this.processing.delete(item.id);
              return false;
            }

            const progress = Math.round((completedChunks / totalParts) * originalProgressMax);
            this.updateItem(item.id, { progress, parts: [...partsCompleted] });
            await updateQueueItem(item.id, { progress, parts: [...partsCompleted] });
          }
          return true;
        };

        let notCancelled: boolean;
        try {
          notCancelled = await uploadRemainingParts();
        } catch (err) {
          if (!resuming) throw err;
          // The resumed multipart upload may have expired or been aborted
          // server-side — fall back to a brand-new upload and retry once
          // from scratch rather than getting stuck retrying forever.
          partsCompleted = [];
          const started = await startOriginalUpload();
          uploadId = started.uploadId;
          currentUploadId = uploadId;
          await updateQueueItem(item.id, { uploadId, parts: [] });
          notCancelled = await uploadRemainingParts();
        }
        if (!notCancelled) return;

        // Sort parts by partNumber for completeUpload (R2 requires ordered parts)
        partsCompleted.sort((a, b) => a.partNumber - b.partNumber);

        await completeUpload(item.eventSlug, photoId, uploadId!, partsCompleted);
        originalDone = true;
      }

      if (isVideo) {
        this.updateItem(item.id, { status: 'completed', progress: 100 });
        await updateQueueItem(item.id, { status: 'completed', progress: 100 });
      } else {
        if (!originalAlreadyUploaded) {
          this.updateItem(item.id, { progress: 85 });
          await updateQueueItem(item.id, { progress: 85 });
        }
        // Distinct phase so the UI can label this step ("Uploading preview…")
        // instead of it looking like the upload silently restarted.
        this.updateItem(item.id, { phase: 'preview' });
        await updateQueueItem(item.id, { phase: 'preview' });
        await this.uploadPreview(item.eventSlug, photoId, previewBlob!);
        this.updateItem(item.id, { status: 'completed', progress: 100 });
        await updateQueueItem(item.id, { status: 'completed', progress: 100 });
      }
    } catch (err) {
      const currentRetries = ((this.items.get(item.id)?.retries) || 0) + 1;
      const errorMsg = err instanceof Error ? err.message : String(err);
      const giveUp = currentRetries >= MAX_RETRIES;
      const updates: Partial<UploadQueueItem> = {
        status: 'failed' as const,
        error: giveUp
          ? `Upload failed after ${MAX_RETRIES} attempts: ${errorMsg}`
          : `Upload failed: ${errorMsg}`,
        retries: currentRetries,
        lastRetryTime: Date.now(),
      };

      if (giveUp) {
        // Permanently giving up (past MAX_RETRIES) — best-effort abort the
        // orphaned R2 multipart upload now rather than leaving it (and its
        // uploaded parts) to linger in R2 indefinitely. Only do this (and
        // clear uploadId/parts) if the *original* file's upload never
        // finished — if only the preview upload is failing, uploadId/parts
        // must be preserved so a later retry doesn't wastefully re-upload
        // the original from scratch.
        if (!originalDone) {
          const photoId = this.items.get(item.id)?.photoId;
          const fileType = this.items.get(item.id)?.fileType;
          if (photoId && currentUploadId) {
            cancelUploadApi(item.eventSlug, photoId, { uploadId: currentUploadId, fileType }).catch(cleanupErr => {
              console.warn('[UploadManager] Failed to abort orphaned multipart upload:', cleanupErr);
            });
          }
          updates.uploadId = undefined;
          updates.parts = [];
        }
      }

      this.updateItem(item.id, updates);
      await updateQueueItem(item.id, updates);
    } finally {
      this.processing.delete(item.id);
      this.pumpQueue();
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
        // Client errors (bad request, auth, not found, payload too large, etc.)
        // will never succeed by retrying the same chunk unchanged — retrying
        // just delays the inevitable failure and wastes the user's data/battery.
        // Only retry on network failures, timeouts, and server-side errors
        // (5xx/429), which are the transient cases retries actually help with.
        if (isNonRetryableUploadError(err) || attempt >= MAX_CHUNK_RETRIES) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, CHUNK_RETRY_DELAY * (attempt + 1)));
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

  private async extractVideoMetadata(file: File): Promise<Partial<UploadQueueItem>> {
    const url = URL.createObjectURL(file);
    try {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';
      video.src = url;

      // Wait for intrinsic dimensions
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('Failed to load video metadata'));
      });

      const width = video.videoWidth || undefined;
      const height = video.videoHeight || undefined;

      // Capture a first-frame poster as a tiny blur placeholder. The file is a
      // local blob, so drawing to canvas is not cross-origin tainted here.
      // Previously this used a 1.5s timeout and only listened for `seeked`,
      // which was too short for slow mobile hardware decoders / long-GOP
      // codecs and unreliable across browsers — the timeout would win, the
      // poster capture would be silently skipped, and the video appeared as
      // a blank tile in grids/timeline until the user actually played it.
      let blurPlaceholder: string | undefined;
      try {
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(safety);
            resolve();
          };
          const safety = setTimeout(finish, 4000);
          video.onseeked = finish;
          // `seeked` doesn't fire reliably for every codec/browser at a seek
          // this close to 0 — `loadeddata`/`canplay` firing means a frame is
          // available too, which is good enough for a poster capture.
          video.onloadeddata = finish;
          video.oncanplay = finish;
          video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
        });
        if (video.videoWidth) {
          const canvas = document.createElement('canvas');
          canvas.width = 16; canvas.height = 16;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, 16, 16);
            blurPlaceholder = canvas.toDataURL('image/jpeg', 0.3);
          }
        }
      } catch { /* poster is best-effort */ }

      return {
        width: typeof width === 'number' ? width : undefined,
        height: typeof height === 'number' ? height : undefined,
        blurPlaceholder: blurPlaceholder || undefined,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
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
        latitude: latitude != null && !isNaN(latitude) ? latitude : undefined,
        longitude: longitude != null && !isNaN(longitude) ? longitude : undefined,
        blurPlaceholder: blurPlaceholder || undefined,
      };
    } catch { return {}; }
  }
}


/** Module-level singleton — survives across all React component lifecycles */
export const uploadManager = new UploadManager();
