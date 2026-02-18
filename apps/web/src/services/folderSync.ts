import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import SafDirectory from './safDirectory';
import { addToQueue } from '../uploadQueue';
import { ulid } from 'ulid';

// Enable debug logging (set to false in production builds)
const DEBUG = import.meta.env.DEV;

function debug(...args: any[]) {
  if (DEBUG) {
    console.log('[FolderSync]', ...args);
  }
}

export interface FolderSyncConfig {
  /** SAF tree content:// URI (from FilePicker.pickDirectory) */
  folderPath: string;
  eventSlug: string;
  autoSync: boolean;
  lastSyncTime?: number;
}

/**
 * Folder sync service for mobile devices.
 * Uses the native SafDirectoryPlugin to enumerate files via Android's
 * DocumentsContract API, which works correctly under scoped storage (API 30+).
 * File reading uses Filesystem.readFile() with content:// URIs returned by SAF.
 */
class FolderSyncService {
  private syncConfigs: Map<string, FolderSyncConfig> = new Map();
  private readonly STORAGE_KEY = 'folderSyncConfigs';

  async initialize() {
    if (!Capacitor.isNativePlatform()) {
      debug('Not available on web platform');
      return;
    }

    // Load saved sync configurations
    await this.loadConfigs();
  }

  /**
   * Save sync configurations to storage
   */
  private async saveConfigs() {
    const configs = Array.from(this.syncConfigs.values());
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(configs));
  }

  /**
   * Load sync configurations from storage
   */
  private async loadConfigs() {
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored) {
      const configs: FolderSyncConfig[] = JSON.parse(stored);
      // Only load configs that look like content:// URIs (drop legacy filesystem paths)
      configs.forEach(config => {
        if (config.folderPath.startsWith('content://')) {
          this.syncConfigs.set(config.folderPath, config);
        } else {
          debug('Dropping legacy non-SAF config:', config.folderPath);
        }
      });
      // Persist cleaned-up configs
      if (configs.length !== this.syncConfigs.size) {
        await this.saveConfigs();
      }
    }
  }

  /**
   * Add a folder to sync to an event
   */
  async addFolderSync(eventSlug: string, folderPath: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      throw new Error('Folder sync only available on mobile');
    }

    const config: FolderSyncConfig = {
      folderPath,
      eventSlug,
      autoSync: true,
      lastSyncTime: undefined, // No lastSyncTime so first sync picks up everything
    };

    this.syncConfigs.set(folderPath, config);
    await this.saveConfigs();
  }

  /**
   * Remove a folder from syncing
   */
  async removeFolderSync(folderPath: string): Promise<void> {
    this.syncConfigs.delete(folderPath);
    await this.saveConfigs();
  }

  /**
   * Get all configured folder syncs
   */
  getFolderSyncs(): FolderSyncConfig[] {
    return Array.from(this.syncConfigs.values());
  }

  /**
   * Sync a specific folder using the native SAF plugin.
   * The folderPath must be a content:// tree URI obtained from FilePicker.pickDirectory().
   */
  async syncFolder(folderPath: string): Promise<number> {
    const config = this.syncConfigs.get(folderPath);
    if (!config) {
      throw new Error('Folder not configured for sync');
    }

    if (!Capacitor.isNativePlatform()) {
      throw new Error('Folder sync only available on mobile');
    }

    // Validate that this is a content:// URI
    if (!folderPath.startsWith('content://')) {
      console.error('[FolderSync] Invalid folder URI (not content://):', folderPath);
      throw new Error('Invalid folder URI. Please remove and re-add this folder.');
    }

    try {
      // Use the native SAF plugin to list files (works with scoped storage)
      debug('Listing files via SAF for:', folderPath);
      const result = await SafDirectory.listFiles({ treeUri: folderPath });

      debug(`SAF listFiles returned ${result.files.length} entries`);

      let addedCount = 0;
      let skippedCount = 0;
      const lastSync = config.lastSyncTime || 0;

      for (const file of result.files) {
        // Only process image and video files
        if (!this.isMediaFile(file.name)) {
          debug(`Skipping non-media: ${file.name} (${file.mimeType})`);
          continue;
        }

        // Skip if file was already synced (based on modification time)
        if (file.mtime && file.mtime <= lastSync) {
          skippedCount++;
          continue;
        }

        try {
          debug(`Reading file: ${file.name} via ${file.uri}`);

          // Filesystem.readFile() supports content:// URIs
          const fileData = await Filesystem.readFile({ path: file.uri });

          // Convert to File object
          const blob = this.base64ToBlob(fileData.data as string, this.getMimeType(file.name));
          const fileObj = new File([blob], file.name, {
            type: this.getMimeType(file.name),
            lastModified: file.mtime || Date.now(),
          });

          // Add to upload queue
          await addToQueue({
            id: ulid(),
            file: fileObj,
            eventSlug: config.eventSlug,
            status: 'pending',
            progress: 0,
          });

          addedCount++;
        } catch (fileError) {
          console.error('[FolderSync] Failed to read file:', file.name, fileError);
          // Continue with next file instead of failing entire sync
        }
      }

      debug(`Done: ${addedCount} added, ${skippedCount} already synced`);

      // Update last sync time
      config.lastSyncTime = Date.now();
      this.syncConfigs.set(folderPath, config);
      await this.saveConfigs();

      return addedCount;
    } catch (error) {
      console.error('[FolderSync] Error syncing folder:', error);
      throw error;
    }
  }

  /**
   * Sync all configured folders
   */
  async syncAllFolders(): Promise<number> {
    const configs = this.getFolderSyncs();
    let totalAdded = 0;

    for (const config of configs) {
      if (config.autoSync) {
        try {
          const count = await this.syncFolder(config.folderPath);
          totalAdded += count;
        } catch (error) {
          console.error(`Error syncing folder ${config.folderPath}:`, error);
        }
      }
    }

    return totalAdded;
  }

  /**
   * Check if file is a media file (image or video)
   */
  private isMediaFile(filename: string): boolean {
    const ext = filename.toLowerCase().split('.').pop();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'mp4', 'mov', 'avi', 'mkv'].includes(ext || '');
  }

  /**
   * Get MIME type from filename
   */
  private getMimeType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'heic': 'image/heic',
      'heif': 'image/heif',
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  /**
   * Convert base64 to Blob
   */
  private base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);

    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  }
}

export const folderSyncService = new FolderSyncService();
