import { Capacitor } from '@capacitor/core';
import { config as appConfig } from '../config';
import FolderSync, { type FolderSyncStatus, type FolderSyncSettings } from './folderSyncPlugin';
import { purgeFolderSyncQueueItems } from '../uploadQueue';

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
  /**
   * @deprecated Kept only so old persisted configs still parse. The native
   * engine's ledger — not a timestamp — decides what has already been
   * uploaded; a wall-clock cutoff is exactly what caused the duplicate uploads
   * this replaced. Never write this.
   */
  lastSyncTime?: number;
}

/** Marks that the one-time migration off the old JS pipeline has run. */
const MIGRATION_KEY = 'folderSyncNativeMigrated';

/**
 * Folder sync configuration for mobile devices.
 *
 * This used to BE the sync implementation: it enumerated the folder, read every
 * new file fully into memory via Filesystem.readFile() (whole file as base64
 * across the Capacitor bridge, then atob'd into a second copy, then a Blob),
 * and persisted all of it into IndexedDB before uploading a single byte. That
 * is what made large batches OOM, and it only ran while the WebView was alive.
 *
 * All of that now lives in the native WorkManager engine
 * (apps/android/.../sync/), which streams files straight from their content://
 * URIs and runs hourly with the app closed. What remains here is configuration:
 * the folder→event mapping the user manages in FolderSyncManager, mirrored into
 * the native layer so the background job can read it with no WebView running.
 */
class FolderSyncService {
  private syncConfigs: Map<string, FolderSyncConfig> = new Map();
  private readonly STORAGE_KEY = 'folderSyncConfigs';

  async initialize() {
    if (!Capacitor.isNativePlatform()) {
      debug('Not available on web platform');
      return;
    }

    await this.loadConfigs();
    await this.migrateOffLegacyPipeline();
    // Push the current mapping (and API base URL) down to the native engine so
    // a background run has everything it needs without the app being open.
    await this.pushConfigToNative();
  }

  /**
   * One-time cleanup for devices upgrading from the JS pipeline.
   *
   * Those devices can have gigabytes of File blobs sitting in the IndexedDB
   * upload queue from folder scans that never drained — and uploadManager.init()
   * loads every one of them at startup, which on its own can take the WebView
   * out of memory before anything else runs. Dropping them is safe: the native
   * ledger plus the server-side hash pre-check prevent any of that content from
   * being re-uploaded.
   */
  private async migrateOffLegacyPipeline() {
    if (localStorage.getItem(MIGRATION_KEY) === '1') return;

    try {
      const purged = await purgeFolderSyncQueueItems();
      if (purged > 0) {
        debug(`Migration: dropped ${purged} legacy folder-sync queue item(s) holding file blobs`);
      }
      localStorage.removeItem('lastFolderScanTime');
      localStorage.setItem(MIGRATION_KEY, '1');
    } catch (err) {
      // Retry on the next launch rather than blocking initialisation.
      console.warn('[FolderSync] Legacy queue migration failed:', err);
    }
  }

  /** Save sync configurations to storage */
  private async saveConfigs() {
    const configs = Array.from(this.syncConfigs.values());
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(configs));
    await this.pushConfigToNative();
  }

  /** Load sync configurations from storage */
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
        const cleaned = Array.from(this.syncConfigs.values());
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cleaned));
      }
    }
  }

  /**
   * Mirrors the folder list and API base URL into the native engine.
   *
   * The base URL has to come from here: the engine can read the auth token
   * straight out of Capacitor Preferences, but the API origin is a build-time
   * (VITE_API_URL) / runtime (window.__CONFIG__) web concern.
   */
  private async pushConfigToNative() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await FolderSync.configure({
        apiBaseUrl: appConfig.apiUrl,
        folders: Array.from(this.syncConfigs.values()).map(c => ({
          treeUri: c.folderPath,
          eventSlug: c.eventSlug,
          enabled: c.autoSync,
        })),
      });
    } catch (err) {
      console.warn('[FolderSync] Failed to push config to native engine:', err);
    }
  }

  /**
   * Add a folder to sync to an event.
   *
   * Deliberately carries no "start from now" timestamp: the native ledger
   * already knows every file it has uploaded, keyed by content hash and by a
   * document identity that survives re-picking the folder. That is what stops
   * re-adding a folder — or reassigning it to another event and back — from
   * re-uploading everything in it, which the old lastSyncTime approach did
   * every single time.
   */
  async addFolderSync(eventSlug: string, folderPath: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      throw new Error('Folder sync only available on mobile');
    }

    this.syncConfigs.set(folderPath, {
      folderPath,
      eventSlug,
      autoSync: true,
    });
    await this.saveConfigs();
  }

  /**
   * Remove a folder from syncing.
   *
   * Keeps the native ledger intact on purpose — if the same folder is added
   * back later, its history is still there and nothing is re-uploaded. Use
   * forgetSyncHistory() for the "actually re-upload everything" case.
   */
  async removeFolderSync(folderPath: string): Promise<void> {
    this.syncConfigs.delete(folderPath);
    await this.saveConfigs();
  }

  /** Enable/disable a single folder without forgetting its sync history. */
  async setFolderEnabled(folderPath: string, enabled: boolean): Promise<void> {
    const config = this.syncConfigs.get(folderPath);
    if (!config) return;
    config.autoSync = enabled;
    this.syncConfigs.set(folderPath, config);
    await this.saveConfigs();
  }

  /** Get all configured folder syncs */
  getFolderSyncs(): FolderSyncConfig[] {
    return Array.from(this.syncConfigs.values());
  }

  /**
   * Ask the native engine to scan now. Returns immediately — the run happens
   * in a WorkManager job and reports progress via its own notification, so
   * there is no count to hand back here.
   */
  async syncNow(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      throw new Error('Folder sync only available on mobile');
    }
    await FolderSync.syncNow();
  }

  /** Live engine status: settings, queue counts and quarantined files. */
  async getStatus(eventSlug?: string): Promise<FolderSyncStatus> {
    return FolderSync.getStatus(eventSlug ? { eventSlug } : undefined);
  }

  /** Update the run conditions (Wi-Fi only, battery, interval, master switch). */
  async updateSettings(settings: Partial<FolderSyncSettings>): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    await FolderSync.configure(settings);
  }

  /** Put a single quarantined file back in the queue. */
  async retryFailed(id: number): Promise<void> {
    await FolderSync.retryFailed({ id });
  }

  /**
   * Forget what has been synced from a folder so its contents are uploaded
   * again. The server-side hash pre-check still suppresses anything that
   * genuinely is a duplicate, so this recovers from a corrupt ledger without
   * flooding the event with copies.
   */
  async forgetSyncHistory(folderPath: string): Promise<number> {
    const { removed } = await FolderSync.resetLedger({ treeUri: folderPath });
    return removed;
  }
}

export const folderSyncService = new FolderSyncService();
