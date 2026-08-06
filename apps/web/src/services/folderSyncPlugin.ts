import { registerPlugin } from '@capacitor/core';

/** One configured folder → event mapping, as the native engine stores it. */
export interface NativeFolderConfig {
  /** SAF tree content:// URI from FilePicker.pickDirectory(). */
  treeUri: string;
  eventSlug: string;
  enabled: boolean;
}

export interface FolderSyncSettings {
  /** Master switch. Also flipped off by the notification's "Pause sync" action. */
  enabled: boolean;
  /** Only sync on unmetered (Wi-Fi) connections. Defaults to true. */
  wifiOnly: boolean;
  /** Skip runs while the battery is low. Defaults to true. */
  batteryNotLow: boolean;
  /** Periodic scan interval. WorkManager's floor is 15 minutes; default is 60. */
  intervalMinutes: number;
}

/** A file the engine gave up on after exhausting its retries. */
export interface QuarantinedFile {
  /** Ledger row id — pass to retryFailed(). */
  id: number;
  name: string;
  eventSlug: string;
  error: string | null;
}

export interface FolderSyncStatus extends FolderSyncSettings {
  /** A sync run is in progress right now. */
  running: boolean;
  /** Epoch ms of the last completed run, or 0 if it has never run. */
  lastRunAt: number;
  lastError: string | null;
  /** Whether the engine has a usable (unexpired) auth token. */
  hasAuthToken: boolean;
  /** Discovered but not yet uploaded. */
  pending: number;
  uploaded: number;
  /** Skipped because the content was already present locally or server-side. */
  duplicates: number;
  failed: number;
  quarantined: QuarantinedFile[];
}

/** A photo the native engine uploaded that still needs client-side face detection. */
export interface FaceJob {
  photoId: string;
  eventSlug: string;
  /** content:// URI of the source file, for SafDirectory.readPreview(). */
  uri: string;
  name: string;
}

export interface FolderSyncPlugin {
  /**
   * Persists configuration and (re)schedules the periodic WorkManager job.
   * Every field is optional — omitted fields keep their current value — so
   * this doubles as the token/base-URL handoff on sign-in.
   */
  configure(options: {
    apiBaseUrl?: string;
    folders?: NativeFolderConfig[];
    enabled?: boolean;
    wifiOnly?: boolean;
    batteryNotLow?: boolean;
    intervalMinutes?: number;
  }): Promise<void>;

  /** Queues an immediate scan. No-op if one is already running. */
  syncNow(): Promise<void>;

  getStatus(options?: { eventSlug?: string }): Promise<FolderSyncStatus>;

  /** Puts a quarantined file back in the queue and kicks a run. */
  retryFailed(options: { id: number }): Promise<void>;

  /** Forgets sync history so the folder/event is re-uploaded. */
  resetLedger(options: { treeUri?: string; eventSlug?: string }): Promise<{ removed: number }>;

  takePendingFaceJobs(): Promise<{ jobs: FaceJob[] }>;
  clearFaceJob(options: { photoId: string }): Promise<void>;
}

/**
 * Bridge to the native Android folder-sync engine
 * (apps/android/.../sync/FolderSyncPlugin.java).
 *
 * The engine runs in a WorkManager job with no WebView alive — that is the
 * whole point, since the previous JS implementation died the moment the app was
 * swiped away and so never actually synced in the background. This plugin only
 * handles configuration, status, and the face-detection handoff (face
 * embeddings need the WASM model, which only exists in the WebView).
 *
 * Falls back to a web stub that reports a disabled, empty engine, so callers
 * don't need to branch on platform for reads.
 */
const FolderSync = registerPlugin<FolderSyncPlugin>('FolderSync', {
  web: () => ({
    async configure() { /* folder sync is mobile-only */ },
    async syncNow() { /* folder sync is mobile-only */ },
    async getStatus(): Promise<FolderSyncStatus> {
      return {
        enabled: false,
        wifiOnly: true,
        batteryNotLow: true,
        intervalMinutes: 60,
        running: false,
        lastRunAt: 0,
        lastError: null,
        hasAuthToken: false,
        pending: 0,
        uploaded: 0,
        duplicates: 0,
        failed: 0,
        quarantined: [],
      };
    },
    async retryFailed() { /* folder sync is mobile-only */ },
    async resetLedger() { return { removed: 0 }; },
    async takePendingFaceJobs() { return { jobs: [] }; },
    async clearFaceJob() { /* folder sync is mobile-only */ },
  }),
});

export default FolderSync;
