import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { BackgroundTask } from '@capawesome/capacitor-background-task';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Network } from '@capacitor/network';
import { ulid } from 'ulid';
import { getPendingUploads, updateQueueItem } from '../uploadQueue';
import { startUpload, uploadPart, completeUpload, cancelUpload as cancelUploadApi, uploadVideoPoster } from '../api';
import FolderSync from './folderSyncPlugin';
import { uploadManager } from './uploadManager';
import { createPreview, computeFileHash } from '../imageUtils';
import { normalizeVideoFileType, captureVideoPoster } from '../utils/videoMetadata';
import ProgressNotification from '../plugins/ProgressNotification';
import type { UploadQueueItem } from '../types';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
const VIDEO_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB for videos — fewer round-trips
const PARALLEL_CHUNKS = 4; // Upload up to 4 chunks simultaneously
const MAX_RETRIES = 5; // Maximum retry attempts (increased from 3)
const RETRY_DELAY_MS = 2000; // Initial retry delay: 2 seconds
const MAX_CHUNK_RETRIES = 3; // Retry individual chunks up to 3 times
// Progress notification updates are coalesced to at most one per this interval,
// mirroring the native folder-sync engine (SyncNotifier.UPDATE_THROTTLE_MS).
// Without it this path fired a notification per uploaded file AND per uploaded
// 4-chunk batch — thousands across a large batch — which floods the phone's
// notification stream and any paired wearable/bridge that mirrors updates.
const PROGRESS_NOTIFY_THROTTLE_MS = 1000;

/** Thrown to unwind out of an in-flight upload when the user taps "Cancel
 *  uploads" on the progress notification. Handled distinctly from a real
 *  failure so a deliberate cancel doesn't burn a retry attempt or get reported
 *  to the user as an error. */
class UploadsCancelledError extends Error {
  constructor() {
    super('Uploads cancelled by user');
    this.name = 'UploadsCancelledError';
  }
}

/**
 * Background sync service for uploads the JS layer owns: files the user picked
 * manually, and files shared into the app via a share intent.
 *
 * Folder sync deliberately does NOT go through here any more. It used to —
 * this service scanned configured folders on resume and on every
 * processPendingUploads() call — but that only worked while the WebView was
 * alive, and the two scan triggers could run concurrently and each queue the
 * entire folder. Folder sync now lives in the native WorkManager engine
 * (apps/android/.../sync/), which runs with the app closed and keeps its own
 * ledger; all this service does for it is ask it to scan when the app comes
 * back to the foreground.
 */
class BackgroundSyncService {
  private taskId: string | null = null;
  private isRunning = false;
  /**
   * Guards processPendingUploads() against concurrent runs. It has three
   * independent callers — the app-resume listener, syncNow() (used by the
   * share-upload page), and uploadManager.addFiles() on native — and without
   * this two of them could process the same queue item at once, racing each
   * other's progress writes and starting two multipart uploads for one photo.
   */
  private isProcessing = false;

  /** Timestamp of the last progress-notification update, for throttling. */
  private lastProgressNotifyAt = 0;

  /**
   * Post/update the ongoing progress notification, coalesced to at most one
   * update per PROGRESS_NOTIFY_THROTTLE_MS. Pass `force` for updates that must
   * always show (the first one, and the terminal summary) so throttling never
   * swallows a state the user needs to see. No-op on web (the plugin is a stub
   * there anyway) — kept unconditional so callers stay simple.
   */
  private async showProgress(
    options: Parameters<typeof ProgressNotification.show>[0],
    force = false
  ): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastProgressNotifyAt < PROGRESS_NOTIFY_THROTTLE_MS) return;
    this.lastProgressNotifyAt = now;
    await ProgressNotification.show(options);
  }

  /**
   * Calculate exponential backoff delay in milliseconds
   * Formula: RETRY_DELAY_MS * (2 ^ retryCount)
   */
  private getBackoffDelay(retryCount: number): number {
    return RETRY_DELAY_MS * Math.pow(2, retryCount);
  }

  /**
   * Upload a single chunk with retry logic
   */
  private async uploadChunkWithRetry(
    eventSlug: string,
    photoId: string,
    uploadIdVal: string,
    partNumber: number,
    chunk: Blob,
    isPreview?: boolean,
    fileType?: string
  ): Promise<{ etag: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
      try {
        return await uploadPart(eventSlug, photoId, uploadIdVal, partNumber, chunk, isPreview, fileType);
      } catch (err) {
        lastError = err;
        if (attempt < MAX_CHUNK_RETRIES) {
          const delay = RETRY_DELAY_MS * (attempt + 1);
          console.warn(`Chunk ${partNumber} failed (attempt ${attempt + 1}/${MAX_CHUNK_RETRIES + 1}), retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  /**
   * Upload the small JPEG preview for a photo, mirroring uploadManager's
   * uploadPreview() so native/background-synced photos get the same
   * fast-loading preview as web-uploaded ones instead of permanently
   * serving the full-size original in the gallery.
   */
  private async uploadPreview(eventSlug: string, photoId: string, previewBlob: Blob): Promise<void> {
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

  /**
   * Check if an upload should be retried based on retry count and backoff delay
   */
  private shouldRetry(upload: any): boolean {
    const retries = upload.retries || 0;
    
    // Don't retry if max retries exceeded
    if (retries >= MAX_RETRIES) {
      return false;
    }
    
    // Check if enough time has passed for exponential backoff
    const lastRetryTime = upload.lastRetryTime || 0;
    const backoffDelay = this.getBackoffDelay(retries);
    const timeSinceLastRetry = Date.now() - lastRetryTime;
    
    return timeSinceLastRetry >= backoffDelay;
  }

  async initialize() {
    if (!Capacitor.isNativePlatform()) {
      console.log('Background sync not available on web platform');
      return;
    }

    // Request notification permissions. On Android 13+ this requires the
    // POST_NOTIFICATIONS manifest permission (see AndroidManifest.xml) or the
    // OS silently denies it with no prompt, and any subsequent
    // upload/progress notification fails to display.
    try {
      const result = await LocalNotifications.requestPermissions();
      if (result.display !== 'granted') {
        console.warn('[BackgroundSync] Notification permission not granted — upload progress/completion notifications will not be shown.');
      }
    } catch (err) {
      console.warn('[BackgroundSync] Failed to request notification permissions:', err);
    }

    // Listen for app state changes — resume uploads and kick a folder scan
    // when the app comes back to the foreground.
    App.addListener('appStateChange', async ({ isActive }) => {
      if (isActive) {
        this.requestFolderScan();
        // Also kick the upload manager to resume pending items. Use
        // refresh() instead of init() to resume pending items — this used
        // to call init(), but init() is a one-shot initializer that no-ops
        // on every call after the first, so it could never actually resume
        // uploads that stalled while the app was backgrounded.
        uploadManager.refresh();
      }
    });

    // Kick a scan on launch too, so opening the app always picks up new photos
    // immediately rather than waiting for the next periodic run.
    this.requestFolderScan();
  }

  /**
   * Asks the native folder-sync engine to scan now.
   *
   * There is no interval-gating or network check here any more: WorkManager
   * owns the schedule (hourly by default) and enforces the user's Wi-Fi-only
   * and battery constraints, and its unique-work name means a request while a
   * run is already in flight is a no-op rather than a second concurrent scan.
   * The previous JS version gated on a `lastFolderScanTime` that two callers
   * could read before either wrote it — which queued the whole folder twice.
   */
  private requestFolderScan() {
    if (!Capacitor.isNativePlatform()) return;
    FolderSync.syncNow().catch(err => {
      console.warn('[BackgroundSync] Failed to request folder scan:', err);
    });
  }

  /**
   * Start background sync task
   * This will periodically check for pending uploads and process them
   */
  async startBackgroundSync() {
    if (!Capacitor.isNativePlatform() || this.isRunning) {
      return;
    }

    try {
      this.taskId = await BackgroundTask.beforeExit(async () => {
        await this.processPendingUploads();
        BackgroundTask.finish({ taskId: this.taskId! });
      });

      this.isRunning = true;
      console.log('Background sync started');
    } catch (error) {
      console.error('Failed to start background sync:', error);
    }
  }

  /**
   * Persist a queue item update to IndexedDB AND mirror it into the
   * in-memory upload manager so GlobalUploadIndicator (web/app UI) reflects
   * the same live progress as the native notification, instead of only
   * jumping to the final state once the whole batch finishes.
   */
  private async updateQueueItemAndSync(id: string, updates: Partial<UploadQueueItem>) {
    await updateQueueItem(id, updates);
    uploadManager.syncItemProgress(id, updates);
  }

  /** Whether the user tapped "Cancel uploads" on the progress notification.
   *  Reads and clears the native flag, so one tap cancels one batch. */
  private async isCancelRequested(): Promise<boolean> {
    try {
      const { cancelled } = await ProgressNotification.consumeCancelRequest();
      return cancelled;
    } catch {
      // An older native build without this method must not block uploads.
      return false;
    }
  }

  /**
   * Process all pending uploads in the queue.
   *
   * Re-entrant calls return immediately rather than starting a second pass
   * over the same items — see the `isProcessing` field for why that matters.
   */
  private async processPendingUploads() {
    if (this.isProcessing) {
      console.log('[BackgroundSync] Already processing, skipping duplicate run');
      return;
    }

    const isNative = Capacitor.isNativePlatform();

    // Check network status (native only, web assumes online via navigator.onLine)
    if (isNative) {
      const status = await Network.getStatus();
      if (!status.connected) {
        console.log('No network connection, skipping sync');
        return;
      }
    } else if (!navigator.onLine) {
      console.log('Browser offline, skipping sync');
      return;
    }

    const pendingUploads = await getPendingUploads();

    if (pendingUploads.length === 0) {
      return;
    }

    this.isProcessing = true;

    // Everything below runs inside a single try/finally so `isProcessing` is
    // ALWAYS reset — even if a notification call throws. It previously wasn't:
    // the initial ProgressNotification.show() ran before the try block, so a
    // rejection there left `isProcessing` stuck true and every later
    // syncNow()/resume silently early-returned forever, until the app process
    // was restarted. That was the primary "uploads just stop and never resume"
    // bug.
    try {
      console.log(`Processing ${pendingUploads.length} pending uploads in background`);

      const notificationId = Math.floor(Math.random() * 2147483647);

      // Track which event we're uploading to (use first upload's event)
      const eventSlug = pendingUploads.length > 0 ? pendingUploads[0].eventSlug : null;

      // Start a foreground service (native only) so the OS treats these
      // uploads as important, user-visible work and doesn't throttle network
      // access or suspend the app when it's backgrounded/screen locked —
      // without this, in-flight chunk uploads get aborted with generic
      // network errors as soon as the phone is locked mid-upload.
      if (isNative) {
        try {
          await ProgressNotification.startForeground({
            id: notificationId,
            title: 'Uploading Photos',
            body: `0 of ${pendingUploads.length} completed`,
          });
        } catch (err) {
          console.warn('[BackgroundSync] Failed to start upload foreground service:', err);
        }

        // Show initial progress notification (same id as the foreground
        // service notification, so this simply updates it in place). Forced so
        // the first update is never throttled away.
        await this.showProgress({
          id: notificationId,
          title: 'Uploading Photos',
          body: `0 of ${pendingUploads.length} completed`,
          progress: 0,
          maxProgress: pendingUploads.length,
          indeterminate: false,
          ongoing: true,
          eventSlug: eventSlug || undefined,
        }, true);
      }

      await this.uploadBatch(pendingUploads, notificationId, eventSlug, isNative);
    } finally {
      this.isProcessing = false;
      if (isNative) {
        try {
          await ProgressNotification.stopForeground();
        } catch (err) {
          console.warn('[BackgroundSync] Failed to stop upload foreground service:', err);
        }
      }
    }
  }

  /** Uploads every pending item in `pendingUploads` sequentially, updating
   *  progress notifications and the queue as it goes, then shows the final
   *  completion notification. Split out from processPendingUploads() so the
   *  foreground service can be reliably stopped in a finally block. */
  private async uploadBatch(
    pendingUploads: UploadQueueItem[],
    notificationId: number,
    eventSlug: string | null,
    isNative: boolean
  ) {
    let successCount = 0;
    let failCount = 0;
    let cancelled = false;

    for (let idx = 0; idx < pendingUploads.length; idx++) {
      const upload = pendingUploads[idx];

      // Stop if the user tapped "Cancel uploads" on the notification. Checked
      // between files (and between chunk batches below) so a cancel takes
      // effect promptly without abandoning a chunk mid-flight. Items keep
      // their multipart resume state, so retrying later continues rather than
      // restarting from 0%.
      if (isNative && await this.isCancelRequested()) {
        cancelled = true;
        break;
      }

      // Hoisted so the catch block below can reference them (they are
      // otherwise only assigned inside the try block).
      let photoId: string = upload.photoId || ulid();
      let currentUploadId: string | undefined = upload.uploadId;
      let originalDone = false;

      try {
        // Skip if already uploading
        if (upload.status === 'uploading') {
          continue;
        }

        // Skip if failed and not ready to retry yet
        if (upload.status === 'failed' && !this.shouldRetry(upload)) {
          failCount++;
          continue;
        }

        // Skip if failed after max retries
        const retries = upload.retries || 0;
        if (upload.status === 'failed' && retries >= MAX_RETRIES) {
          failCount++;
          continue;
        }

        // Update progress notification (native only), throttled so a large
        // batch doesn't post one notification per file.
        if (isNative) {
          await this.showProgress({
            id: notificationId,
            title: 'Uploading Photos',
            body: `${idx} of ${pendingUploads.length} completed`,
            largeBody: `Currently uploading: ${upload.file.name}`,
            progress: idx,
            maxProgress: pendingUploads.length,
            indeterminate: false,
            ongoing: true,
            eventSlug: eventSlug || undefined,
          });
        }

        // Update status to uploading
        await this.updateQueueItemAndSync(upload.id, { status: 'uploading' });

        // Generate photoId if not already set
        photoId = upload.photoId || photoId;

        // Perform chunked upload — normalized so a stray 'video/quicktime' (or similar) that
        // slipped through some enqueue path is treated the same as any other video (see
        // normalizeVideoFileType()'s doc comment in utils/videoMetadata.ts).
        const fileType = normalizeVideoFileType(upload.fileType || upload.file.type, upload.file.name);
        const isVideo = fileType === 'video/mp4';
        const chunkSize = isVideo ? VIDEO_CHUNK_SIZE : CHUNK_SIZE;
        const totalChunks = Math.ceil(upload.file.size / chunkSize);
        // Reserve the last 20% of progress for the preview upload (images
        // only) so the progress bar/notification reflects both steps,
        // matching uploadManager.ts's foreground upload path.
        const originalProgressMax = isVideo ? 100 : 80;

        // Compute a content hash for duplicate detection (images/RAW only,
        // same as uploadManager.ts's foreground path — this used to be
        // missing entirely here, which meant every photo uploaded via this
        // native background-sync path got file_hash = NULL, silently
        // breaking duplicate detection for the whole library). Cached on the
        // queue item so a retry never re-hashes the same file.
        let fileHash = upload.fileHash;
        if (!isVideo && !fileHash) {
          fileHash = await computeFileHash(upload.file);
          if (fileHash) {
            await this.updateQueueItemAndSync(upload.id, { fileHash });
          }
        }

        const startOriginalUpload = () => startUpload(
          upload.eventSlug,
          photoId,
          upload.file.name,
          upload.captureTime,
          upload.width,
          upload.height,
          upload.iso,
          upload.aperture,
          upload.shutterSpeed,
          upload.focalLength,
          upload.cameraMake,
          upload.cameraModel,
          upload.lensModel,
          upload.latitude,
          upload.longitude,
          upload.blurPlaceholder,
          false,
          fileType,
          fileHash
        );

        // Once the original file has already fully uploaded (a previous
        // attempt got as far as completeUpload but then failed during the
        // preview upload), skip re-uploading the original entirely — only
        // the preview is missing.
        const originalAlreadyUploaded = !isVideo && upload.progress >= originalProgressMax && upload.uploadId !== undefined;
        if (originalAlreadyUploaded) originalDone = true;

        // Resume support: if a previous attempt already uploaded some chunks
        // (uploadId + parts persisted from before a failure/interruption),
        // reuse that same R2 multipart upload and only send the chunks that
        // are still missing, instead of discarding that progress and
        // re-uploading the whole file from 0%.
        let uploadId = upload.uploadId;
        let parts: Array<{ partNumber: number; etag: string }> =
          upload.progress < originalProgressMax ? [...(upload.parts || [])] : [];
        let resuming = !!uploadId && parts.length > 0 && parts.length < totalChunks;

        if (!originalAlreadyUploaded) {
          if (!resuming) {
            parts = [];
            const uploadData = await startOriginalUpload();
            uploadId = uploadData.uploadId;
            currentUploadId = uploadId;
            await this.updateQueueItemAndSync(upload.id, { uploadId, parts: [] });
          }

          let completedChunks = parts.length;

          const uploadRemainingParts = async () => {
            const completedPartNumbers = new Set(parts.map(p => p.partNumber));
            const remaining: number[] = [];
            for (let n = 1; n <= totalChunks; n++) {
              if (!completedPartNumbers.has(n)) remaining.push(n);
            }

            // Upload chunks in parallel batches for speed
            for (let batchStart = 0; batchStart < remaining.length; batchStart += PARALLEL_CHUNKS) {
              // A large video is a long time to keep uploading after the user
              // asked to stop, so check between chunk batches too, not just
              // between files. Throwing unwinds into the normal failure path,
              // which preserves uploadId/parts for a later resume.
              if (isNative && await this.isCancelRequested()) {
                throw new UploadsCancelledError();
              }

              const batchNumbers = remaining.slice(batchStart, batchStart + PARALLEL_CHUNKS);
              const batch = batchNumbers.map(partNumber => {
                const start = (partNumber - 1) * chunkSize;
                const end = Math.min(start + chunkSize, upload.file.size);
                const chunk = upload.file.slice(start, end);
                return this.uploadChunkWithRetry(
                  upload.eventSlug, photoId, uploadId!, partNumber, chunk
                ).then(({ etag }) => ({ partNumber, etag }));
              });

              const results = await Promise.all(batch);
              parts.push(...results);
              completedChunks += results.length;

              // Update progress
              const progress = Math.round((completedChunks / totalChunks) * originalProgressMax);
              await this.updateQueueItemAndSync(upload.id, { progress, parts: [...parts] });

              // Update notification with chunk progress (native only),
              // throttled so a big file doesn't post one notification per
              // uploaded 4-chunk batch.
              if (isNative) {
                await this.showProgress({
                  id: notificationId,
                  title: 'Uploading Photos',
                  body: `${idx} of ${pendingUploads.length} completed`,
                  largeBody: `Current file: ${upload.file.name} (${progress}%)`,
                  progress: idx,
                  maxProgress: pendingUploads.length,
                  indeterminate: false,
                  ongoing: true,
                  eventSlug: eventSlug || undefined,
                });
              }
            }
          };

          try {
            await uploadRemainingParts();
          } catch (err) {
            if (!resuming) throw err;
            // The resumed multipart upload may have expired or been aborted
            // server-side — fall back to a brand-new upload and retry once
            // from scratch rather than getting stuck retrying forever.
            parts = [];
            completedChunks = 0;
            const uploadData = await startOriginalUpload();
            uploadId = uploadData.uploadId;
            currentUploadId = uploadId;
            await this.updateQueueItemAndSync(upload.id, { uploadId, parts: [] });
            await uploadRemainingParts();
          }

          // Sort parts by partNumber (R2 requires ordered parts)
          parts.sort((a, b) => a.partNumber - b.partNumber);

          // Complete upload
          await completeUpload(
            upload.eventSlug,
            photoId,
            uploadId!,
            parts
          );
          originalDone = true;
        }

        if (isVideo) {
          // Mark as completed
          await this.updateQueueItemAndSync(upload.id, {
            status: 'completed',
            progress: 100,
            photoId: photoId
          });
          // Best-effort: capture + store a poster (cover) image so the video gets a fast gallery
          // thumbnail immediately instead of waiting for the nightly ffmpeg job. Never fatal.
          try {
            const poster = await captureVideoPoster(upload.file);
            if (poster) await uploadVideoPoster(upload.eventSlug, photoId, poster);
          } catch (err) {
            console.warn('[BackgroundSync] Video poster capture/upload failed (nightly job will retry):', err);
          }
        } else {
          if (!originalAlreadyUploaded) {
            await this.updateQueueItemAndSync(upload.id, { progress: 85 });
          }
          // Upload the preview so folder-synced/backgrounded photos get the
          // same fast-loading preview image as web-uploaded ones, instead of
          // permanently serving the full-size original in the gallery.
          const previewBlob = await createPreview(upload.file);
          await this.uploadPreview(upload.eventSlug, photoId, previewBlob);
          await this.updateQueueItemAndSync(upload.id, {
            status: 'completed',
            progress: 100,
            photoId: photoId
          });
        }

        successCount++;
      } catch (error) {
        // A user-requested cancel is not a failure: return the item to
        // 'pending' with its uploadId/parts intact so a later run resumes from
        // the last completed chunk, and don't consume a retry attempt.
        if (error instanceof UploadsCancelledError) {
          await this.updateQueueItemAndSync(upload.id, { status: 'pending' });
          cancelled = true;
          break;
        }

        console.error(`Failed to upload ${upload.file.name}:`, error);

        const currentRetries = upload.retries || 0;
        
        // If retries remaining, reschedule for retry with exponential backoff
        if (currentRetries < MAX_RETRIES) {
          const backoffDelay = this.getBackoffDelay(currentRetries);
          console.log(
            `Scheduling retry ${currentRetries + 1}/${MAX_RETRIES} for ${upload.file.name} in ${backoffDelay}ms`
          );
          
          await this.updateQueueItemAndSync(upload.id, {
            status: 'failed',
            retries: currentRetries + 1,
            lastRetryTime: Date.now(),
            error: error instanceof Error ? error.message : 'Upload failed',
          });
        } else {
          // Max retries exceeded, mark as permanently failed
          console.error(
            `Max retries (${MAX_RETRIES}) exceeded for ${upload.file.name}, marking as permanently failed`
          );

          const updates: Partial<UploadQueueItem> = {
            status: 'failed',
            retries: MAX_RETRIES,
            error: `Upload failed after ${MAX_RETRIES} retries: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };

          // Best-effort abort the orphaned R2 multipart upload now rather
          // than leaving it (and its uploaded parts) to linger in R2
          // indefinitely. Only do this (and clear uploadId/parts) if the
          // *original* file's upload never finished — if only the preview
          // upload is failing, uploadId/parts must be preserved so a later
          // retry doesn't wastefully re-upload the original from scratch.
          if (!originalDone) {
            if (photoId && currentUploadId) {
              cancelUploadApi(upload.eventSlug, photoId, { uploadId: currentUploadId, fileType: upload.fileType }).catch(cleanupErr => {
                console.warn('[BackgroundSync] Failed to abort orphaned multipart upload:', cleanupErr);
              });
            }
            updates.uploadId = undefined;
            updates.parts = [];
          }

          await this.updateQueueItemAndSync(upload.id, updates);
          failCount++;
        }
      }
    }

    // Show a single end-of-run summary (native only).
    //
    // Routed through ProgressNotification.show({ ongoing: false }) rather than
    // Capacitor's LocalNotifications.schedule(): the native plugin sets
    // setLocalOnly(true), so the summary stays on the phone and never buzzes a
    // paired watch. LocalNotifications does NOT set localOnly, so it was the
    // one upload notification still bridged to the wrist. Reusing the progress
    // notification id transitions the ongoing progress notification into this
    // dismissible summary in place (ongoing:false → autoCancel + alert-once),
    // so there's exactly one notification, and tap-to-view is preserved via
    // eventSlug (same MainActivity intent contract as the progress taps).
    if (isNative) {
      let title: string | null = null;
      let body = '';

      if (cancelled) {
        // The user stopped this deliberately — confirm it and say what happens
        // to the rest, rather than reporting it as a failure.
        const remaining = pendingUploads.length - successCount;
        title = 'Uploads stopped';
        body = successCount > 0
          ? `${successCount} uploaded. ${remaining} still waiting — they'll resume next time you upload.`
          : 'No photos were uploaded. They\'ll resume next time you upload.';
      } else if (successCount > 0 && failCount === 0) {
        title = '✓ Upload Complete';
        body = `Successfully uploaded ${successCount} photo${successCount > 1 ? 's' : ''}. Tap to view.`;
      } else if (successCount > 0 && failCount > 0) {
        title = 'Upload Completed';
        body = `${successCount} uploaded, ${failCount} failed. Tap to view.`;
      } else if (failCount > 0) {
        title = '✗ Upload Failed';
        body = `Failed to upload ${failCount} photo${failCount > 1 ? 's' : ''}. Check your connection and try again.`;
      }

      if (title !== null) {
        // Forced so the terminal state is never swallowed by throttling.
        await this.showProgress({
          id: notificationId,
          title,
          body,
          progress: pendingUploads.length,
          maxProgress: pendingUploads.length,
          indeterminate: false,
          ongoing: false,
          eventSlug: eventSlug || undefined,
        }, true);
      } else {
        // Nothing worth reporting (e.g. every item was skipped) — just clear
        // the ongoing progress notification.
        await ProgressNotification.cancel({ id: notificationId });
      }
    }
  }

  /**
   * Stop background sync
   */
  async stopBackgroundSync() {
    if (this.taskId) {
      // Background task will be finished automatically
      this.taskId = null;
      this.isRunning = false;
    }
  }

  /**
   * Manually trigger a sync (works on all platforms)
   */
  async syncNow() {
    await this.processPendingUploads();
  }
}

export const backgroundSyncService = new BackgroundSyncService();
