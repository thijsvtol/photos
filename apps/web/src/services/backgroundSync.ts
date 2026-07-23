import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { BackgroundTask } from '@capawesome/capacitor-background-task';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Network } from '@capacitor/network';
import { ulid } from 'ulid';
import { getPendingUploads, updateQueueItem } from '../uploadQueue';
import { startUpload, uploadPart, completeUpload } from '../api';
import { folderSyncService } from './folderSync';
import { uploadManager } from './uploadManager';
import ProgressNotification from '../plugins/ProgressNotification';
import type { UploadQueueItem } from '../types';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
const VIDEO_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB for videos — fewer round-trips
const PARALLEL_CHUNKS = 4; // Upload up to 4 chunks simultaneously
const MAX_RETRIES = 5; // Maximum retry attempts (increased from 3)
const RETRY_DELAY_MS = 2000; // Initial retry delay: 2 seconds
const MAX_CHUNK_RETRIES = 3; // Retry individual chunks up to 3 times
const PERIODIC_SYNC_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours between folder scans
const FOREGROUND_CHECK_INTERVAL = 2 * 60 * 60 * 1000; // Check every 2 hours while app is open

/**
 * Background sync service for uploading photos when app is in background.
 * Also handles periodic foreground folder checks and resume-on-focus syncing.
 */
class BackgroundSyncService {
  private taskId: string | null = null;
  private isRunning = false;
  private lastFolderScanTime = 0;

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
    chunk: Blob
  ): Promise<{ etag: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
      try {
        return await uploadPart(eventSlug, photoId, uploadIdVal, partNumber, chunk);
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

    // Listen for app state changes — sync folders when app resumes
    App.addListener('appStateChange', async ({ isActive }) => {
      if (isActive) {
        await this.syncFoldersIfDue();
        // Also kick the upload manager to resume pending items. Use
        // refresh() instead of init() to resume pending items — this used
        // to call init(), but init() is a one-shot initializer that no-ops
        // on every call after the first, so it could never actually resume
        // uploads that stalled while the app was backgrounded.
        uploadManager.refresh();
      }
    });

    // Periodic foreground folder check (every 2 hours while app is open)
    setInterval(() => {
      this.syncFoldersIfDue();
    }, FOREGROUND_CHECK_INTERVAL);

    // Restore persisted last scan time
    const stored = localStorage.getItem('lastFolderScanTime');
    if (stored) this.lastFolderScanTime = parseInt(stored, 10) || 0;

    // Run an initial folder scan if overdue
    await this.syncFoldersIfDue();
  }

  /**
   * Check configured folders for new files if enough time has passed
   * since the last scan. Queues any new files via the upload manager.
   */
  private async syncFoldersIfDue() {
    const now = Date.now();
    if (now - this.lastFolderScanTime < PERIODIC_SYNC_INTERVAL) return;

    // Check network before scanning
    if (Capacitor.isNativePlatform()) {
      const status = await Network.getStatus();
      if (!status.connected) return;
    } else if (!navigator.onLine) {
      return;
    }

    const configs = folderSyncService.getFolderSyncs();
    if (configs.length === 0) return;

    console.log('[BackgroundSync] Periodic folder scan starting');
    try {
      const newFiles = await folderSyncService.syncAllFolders();
      this.lastFolderScanTime = now;
      localStorage.setItem('lastFolderScanTime', String(now));
      if (newFiles > 0) {
        console.log(`[BackgroundSync] Periodic scan: ${newFiles} new files queued`);
        // Kick upload manager to start processing (see note above re: refresh() vs init())
        uploadManager.refresh();
      }
    } catch (err) {
      console.warn('[BackgroundSync] Periodic folder scan failed:', err);
    }
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

  /**
   * Process all pending uploads in the queue
   */
  private async processPendingUploads() {
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

    // Scan configured folders for new photos before processing uploads (native only)
    if (isNative) {
      try {
        const newFiles = await folderSyncService.syncAllFolders();
        if (newFiles > 0) {
          console.log(`Background folder scan: ${newFiles} new files queued`);
        }
      } catch (error) {
        console.warn('Background folder scan failed:', error);
      }
    }

    const pendingUploads = await getPendingUploads();
    
    if (pendingUploads.length === 0) {
      return;
    }

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
      // service notification, so this simply updates it in place).
      await ProgressNotification.show({
        id: notificationId,
        title: 'Uploading Photos',
        body: `0 of ${pendingUploads.length} completed`,
        progress: 0,
        maxProgress: pendingUploads.length,
        indeterminate: false,
        ongoing: true,
        eventSlug: eventSlug || undefined,
      });
    }

    try {
      await this.uploadBatch(pendingUploads, notificationId, eventSlug, isNative);
    } finally {
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

    for (let idx = 0; idx < pendingUploads.length; idx++) {
      const upload = pendingUploads[idx];
      
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

        // Update progress notification (native only)
        if (isNative) {
          await ProgressNotification.show({
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
        const photoId = upload.photoId || ulid();

        // Perform chunked upload
        const isVideo = upload.file.type === 'video/mp4';
        const chunkSize = isVideo ? VIDEO_CHUNK_SIZE : CHUNK_SIZE;
        const totalChunks = Math.ceil(upload.file.size / chunkSize);

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
          upload.file.type
        );

        // Resume support: if a previous attempt already uploaded some chunks
        // (uploadId + parts persisted from before a failure/interruption),
        // reuse that same R2 multipart upload and only send the chunks that
        // are still missing, instead of discarding that progress and
        // re-uploading the whole file from 0%.
        let uploadId = upload.uploadId;
        let parts: Array<{ partNumber: number; etag: string }> =
          upload.progress < 100 ? [...(upload.parts || [])] : [];
        let resuming = !!uploadId && parts.length > 0 && parts.length < totalChunks;

        if (!resuming) {
          parts = [];
          const uploadData = await startOriginalUpload();
          uploadId = uploadData.uploadId;
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
            const progress = Math.round((completedChunks / totalChunks) * 100);
            await this.updateQueueItemAndSync(upload.id, { progress, parts: [...parts] });

            // Update notification with chunk progress (native only)
            if (isNative) {
              await ProgressNotification.show({
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

        // Mark as completed
        await this.updateQueueItemAndSync(upload.id, {
          status: 'completed',
          progress: 100,
          photoId: photoId
        });

        successCount++;
      } catch (error) {
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
          await this.updateQueueItemAndSync(upload.id, {
            status: 'failed',
            retries: MAX_RETRIES,
            error: `Upload failed after ${MAX_RETRIES} retries: ${error instanceof Error ? error.message : 'Unknown error'}`,
          });
          failCount++;
        }
      }
    }

    // Show completion notification (native only)
    if (isNative) {
      // First cancel the progress notification
      await ProgressNotification.cancel({ id: notificationId });
      
      if (successCount > 0 && failCount === 0) {
        // All succeeded
        await LocalNotifications.schedule({
          notifications: [{
            title: '✓ Upload Complete',
            body: `Successfully uploaded ${successCount} photo${successCount > 1 ? 's' : ''}. Tap to view.`,
            id: notificationId,
            ongoing: false,
            actionTypeId: 'VIEW_EVENT',
            extra: {
              eventSlug: eventSlug,
              action: 'view_event'
            }
          }],
        });
      } else if (successCount > 0 && failCount > 0) {
        // Partial success
        await LocalNotifications.schedule({
          notifications: [{
            title: 'Upload Completed',
            body: `${successCount} uploaded, ${failCount} failed. Tap to view.`,
            id: notificationId,
            ongoing: false,
            actionTypeId: 'VIEW_EVENT',
            extra: {
              eventSlug: eventSlug,
              action: 'view_event'
            }
          }],
        });
      } else if (failCount > 0) {
        // All failed
        await LocalNotifications.schedule({
          notifications: [{
            title: '✗ Upload Failed',
            body: `Failed to upload ${failCount} photo${failCount > 1 ? 's' : ''}. Check your connection and try again.`,
            id: notificationId,
            ongoing: false,
          }],
        });
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
