import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { addToQueue } from '../uploadQueue';
import { ulid } from 'ulid';

export interface FolderSyncConfig {
  folderPath: string;
  eventSlug: string;
  autoSync: boolean;
  lastSyncTime?: number;
}

/**
 * Folder sync service for mobile devices
 * Allows users to select a folder and automatically sync photos to an event
 */
class FolderSyncService {
  private syncConfigs: Map<string, FolderSyncConfig> = new Map();
  private readonly STORAGE_KEY = 'folderSyncConfigs';

  async initialize() {
    if (!Capacitor.isNativePlatform()) {
      console.log('Folder sync not available on web platform');
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
      configs.forEach(config => {
        this.syncConfigs.set(config.folderPath, config);
      });
    }
  }

  /**
   * Add a folder to sync to an event
   * On mobile, this will prompt user to select a folder
   */
  async addFolderSync(eventSlug: string, folderPath: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      throw new Error('Folder sync only available on mobile');
    }

    const config: FolderSyncConfig = {
      folderPath,
      eventSlug,
      autoSync: true,
      lastSyncTime: Date.now(),
    };

    this.syncConfigs.set(folderPath, config);
    await this.saveConfigs();

    // Do initial sync
    await this.syncFolder(folderPath);
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
   * Sync a specific folder
   * Scans for new photos and adds them to the upload queue
   */
  async syncFolder(folderPath: string): Promise<number> {
    const config = this.syncConfigs.get(folderPath);
    if (!config) {
      throw new Error('Folder not configured for sync');
    }

    if (!Capacitor.isNativePlatform()) {
      throw new Error('Folder sync only available on mobile');
    }

    try {
      // Read directory contents
      const result = await Filesystem.readdir({
        path: folderPath,
        directory: Directory.External,
      });

      let addedCount = 0;
      const lastSync = config.lastSyncTime || 0;

      for (const file of result.files) {
        // Only process image and video files
        if (!this.isMediaFile(file.name)) {
          continue;
        }

        // Get file info
        const stat = await Filesystem.stat({
          path: `${folderPath}/${file.name}`,
          directory: Directory.External,
        });

        // Skip if file was already synced (based on modification time)
        if (stat.mtime && stat.mtime <= lastSync) {
          continue;
        }

        // Read file content
        const fileData = await Filesystem.readFile({
          path: `${folderPath}/${file.name}`,
          directory: Directory.External,
        });

        // Convert to File object
        const blob = this.base64ToBlob(fileData.data as string, this.getMimeType(file.name));
        const fileObj = new File([blob], file.name, { 
          type: this.getMimeType(file.name),
          lastModified: stat.mtime || Date.now(),
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
      }

      // Update last sync time
      config.lastSyncTime = Date.now();
      this.syncConfigs.set(folderPath, config);
      await this.saveConfigs();

      return addedCount;
    } catch (error) {
      console.error('Error syncing folder:', error);
      throw error;
    }
  }

  /**
   * Sync all configured folders
   */
  async syncAllFolders(): Promise<void> {
    const configs = this.getFolderSyncs();
    
    for (const config of configs) {
      if (config.autoSync) {
        try {
          await this.syncFolder(config.folderPath);
        } catch (error) {
          console.error(`Error syncing folder ${config.folderPath}:`, error);
        }
      }
    }
  }

  /**
   * Check if file is a media file (image or video)
   */
  private isMediaFile(filename: string): boolean {
    const ext = filename.toLowerCase().split('.').pop();
    return ['jpg', 'jpeg', 'png', 'gif', 'heic', 'heif', 'mp4', 'mov', 'avi'].includes(ext || '');
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
      'heic': 'image/heic',
      'heif': 'image/heif',
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
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
