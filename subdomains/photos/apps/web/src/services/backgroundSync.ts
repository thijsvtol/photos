import { Capacitor } from '@capacitor/core';
import { BackgroundTask } from '@capawesome/capacitor-background-task';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Network } from '@capacitor/network';
import { ulid } from 'ulid';
import { getPendingUploads, updateQueueItem } from '../uploadQueue';
import { startUpload, uploadPart, completeUpload } from '../api';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

/**
 * Background sync service for uploading photos when app is in background
 * Works on iOS and Android using Capacitor plugins
 */
class BackgroundSyncService {
  private taskId: string | null = null;
  private isRunning = false;

  async initialize() {
    if (!Capacitor.isNativePlatform()) {
      console.log('Background sync not available on web platform');
      return;
    }

    // Request notification permissions
    await LocalNotifications.requestPermissions();
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
   * Process all pending uploads in the queue
   */
  private async processPendingUploads() {
    // Check network status
    const status = await Network.getStatus();
    if (!status.connected) {
      console.log('No network connection, skipping sync');
      return;
    }

    const pendingUploads = await getPendingUploads();
    
    if (pendingUploads.length === 0) {
      return;
    }

    console.log(`Processing ${pendingUploads.length} pending uploads in background`);

    let successCount = 0;
    let failCount = 0;

    for (const upload of pendingUploads) {
      try {
        // Skip if already uploading
        if (upload.status === 'uploading') {
          continue;
        }

        // Update status to uploading
        await updateQueueItem(upload.id, { status: 'uploading' });

        // Generate photoId if not already set
        const photoId = upload.photoId || ulid();

        // Perform chunked upload
        const totalChunks = Math.ceil(upload.file.size / CHUNK_SIZE);
        const uploadData = await startUpload(
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

        const parts: Array<{ partNumber: number; etag: string }> = [];

        // Upload each chunk
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, upload.file.size);
          const chunk = upload.file.slice(start, end);

          const { etag } = await uploadPart(
            upload.eventSlug,
            photoId,
            uploadData.uploadId,
            i + 1,
            chunk
          );

          parts.push({ partNumber: i + 1, etag });

          // Update progress
          const progress = Math.round(((i + 1) / totalChunks) * 100);
          await updateQueueItem(upload.id, { progress });
        }

        // Complete upload
        await completeUpload(
          upload.eventSlug,
          photoId,
          uploadData.uploadId,
          parts
        );

        // Mark as completed
        await updateQueueItem(upload.id, { 
          status: 'completed',
          progress: 100,
          photoId: photoId
        });

        successCount++;
      } catch (error) {
        console.error(`Failed to upload ${upload.file.name}:`, error);
        
        // Mark as failed
        await updateQueueItem(upload.id, { 
          status: 'failed',
          error: error instanceof Error ? error.message : 'Upload failed'
        });

        failCount++;
      }
    }

    // Show notification if any uploads completed
    if (successCount > 0 || failCount > 0) {
      await LocalNotifications.schedule({
        notifications: [{
          title: 'Photo Upload Complete',
          body: `${successCount} uploaded successfully${failCount > 0 ? `, ${failCount} failed` : ''}`,
          id: Date.now(),
          schedule: { at: new Date(Date.now() + 1000) },
        }],
      });
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
      console.log('Background sync stopped');
    }
  }

  /**
   * Manually trigger a sync (useful for testing or user-initiated sync)
   */
  async syncNow() {
    if (!Capacitor.isNativePlatform()) {
      console.log('Background sync not available on web platform');
      return;
    }

    await this.processPendingUploads();
  }
}

export const backgroundSyncService = new BackgroundSyncService();
