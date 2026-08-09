import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import {
  Folder, Plus, Trash2, RefreshCw, Smartphone, AlertTriangle, ChevronDown, ChevronUp, History,
} from 'lucide-react';
import { folderSyncService, FolderSyncConfig } from '../services/folderSync';
import type { FolderSyncStatus } from '../services/folderSyncPlugin';

interface Props {
  eventSlug: string;
}

/** How often the status panel refreshes while a sync run is in progress. */
const STATUS_POLL_MS = 3000;

const INTERVAL_OPTIONS = [
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 180, label: 'Every 3 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Once a day' },
];

/**
 * Extract a human-readable display name from a content:// tree URI or filesystem path.
 */
function getDisplayPath(uri: string): string {
  if (uri.startsWith('content://')) {
    try {
      const decoded = decodeURIComponent(uri);
      // content://com.android.externalstorage.documents/tree/primary:DCIM/Facebook
      const match = decoded.match(/tree\/(?:primary:|[A-F0-9-]+:)(.+)/);
      if (match) {
        return match[1]; // e.g. "DCIM/Facebook"
      }
    } catch { /* fall through */ }
  }
  // Filesystem path fallback
  const parts = uri.split('/').filter(Boolean);
  return parts.slice(-3).join('/');
}

export default function FolderSyncManager({ eventSlug }: Props) {
  const [folderSyncs, setFolderSyncs] = useState<FolderSyncConfig[]>([]);
  const [isNative, setIsNative] = useState(false);
  const [status, setStatus] = useState<FolderSyncStatus | null>(null);
  const [showQuarantined, setShowQuarantined] = useState(false);
  const pollRef = useRef<number | null>(null);

  const loadFolderSyncs = useCallback(() => {
    const syncs = folderSyncService.getFolderSyncs();
    setFolderSyncs(syncs.filter(s => s.eventSlug === eventSlug));
  }, [eventSlug]);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await folderSyncService.getStatus(eventSlug));
    } catch (err) {
      console.warn('[FolderSyncManager] Failed to read sync status:', err);
    }
  }, [eventSlug]);

  useEffect(() => {
    const isNativePlatform = Capacitor.isNativePlatform();
    setIsNative(isNativePlatform);
    if (!isNativePlatform) return;

    loadFolderSyncs();
    void refreshStatus();

    // The engine runs in a background job, not in this WebView, so poll rather
    // than expecting it to push updates into React.
    pollRef.current = window.setInterval(() => { void refreshStatus(); }, STATUS_POLL_MS);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [loadFolderSyncs, refreshStatus]);

  const handleAddFolder = async () => {
    try {
      // pickDirectory() uses Android's Storage Access Framework (SAF)
      const result = await FilePicker.pickDirectory();

      if (!result.path) {
        return; // User cancelled
      }

      // Store the raw content:// tree URI — the SAF plugin needs it as-is
      await folderSyncService.addFolderSync(eventSlug, result.path);
      loadFolderSyncs();
      await folderSyncService.syncNow(true);
      await refreshStatus();
    } catch (error) {
      console.error('Error adding folder:', error);
      // User may have cancelled the picker
      if (error instanceof Error && error.message?.includes('cancel')) {
        return;
      }
      alert('Failed to add folder: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const handleRemoveFolder = async (folderPath: string) => {
    try {
      await folderSyncService.removeFolderSync(folderPath);
      loadFolderSyncs();
      await refreshStatus();
    } catch (error) {
      console.error('Error removing folder:', error);
      alert('Failed to remove folder');
    }
  };

  const handleToggleFolder = async (folderPath: string, enabled: boolean) => {
    await folderSyncService.setFolderEnabled(folderPath, enabled);
    loadFolderSyncs();
    await refreshStatus();
  };

  const handleSyncNow = async () => {
    try {
      await folderSyncService.syncNow(true);
      await refreshStatus();
    } catch (error) {
      alert('Failed to start sync: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const handleForgetHistory = async (folderPath: string) => {
    const confirmed = window.confirm(
      'Forget what has been synced from this folder? Everything in it will be checked again. '
      + 'Photos the server already has are still skipped, so this will not create duplicates.'
    );
    if (!confirmed) return;

    try {
      await folderSyncService.forgetSyncHistory(folderPath);
      await folderSyncService.syncNow(true);
      await refreshStatus();
    } catch (error) {
      alert('Failed to reset sync history: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const updateSetting = async (patch: Parameters<typeof folderSyncService.updateSettings>[0]) => {
    // Optimistic: the poll below will correct it if the native write fails.
    setStatus(prev => (prev ? { ...prev, ...patch } : prev));
    await folderSyncService.updateSettings(patch);
    await refreshStatus();
  };

  const handleRetryQuarantined = async (id: number) => {
    await folderSyncService.retryFailed(id);
    await refreshStatus();
  };

  if (!isNative) {
    return (
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Smartphone className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
          <div>
            <h3 className="font-medium text-blue-900 dark:text-blue-200">Mobile App Feature</h3>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Folder syncing is only available in the mobile app. Install the Photos app on your
              Android device to automatically sync folders to this event.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const quarantined = status?.quarantined ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Folder className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <h3 className="font-medium text-gray-900 dark:text-white">Folder Sync</h3>
        </div>
        <div className="flex items-center gap-2">
          {folderSyncs.length > 0 && (
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={status?.running}
              className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm disabled:opacity-50"
              title="Sync now"
            >
              <RefreshCw className={`w-4 h-4 ${status?.running ? 'animate-spin' : ''}`} />
              {status?.running ? 'Syncing…' : 'Sync now'}
            </button>
          )}
          <button
            type="button"
            onClick={handleAddFolder}
            className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            Select Folder
          </button>
        </div>
      </div>

      {folderSyncs.length === 0 && (
        <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center">
          <Folder className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
          <p className="text-gray-600 dark:text-gray-300 mb-2">No folders configured</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Tap "Select Folder" to choose a folder. New photos in that folder will automatically sync to this event.
          </p>
        </div>
      )}

      {folderSyncs.length > 0 && (
        <div className="space-y-2">
          {folderSyncs.map((sync) => (
            <div
              key={sync.folderPath}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Folder className="w-4 h-4 text-gray-500 dark:text-gray-400 shrink-0" />
                  <span className="font-mono text-sm text-gray-900 dark:text-white truncate">
                    {getDisplayPath(sync.folderPath)}
                  </span>
                </div>
                <label className="flex items-center gap-2 mt-2 text-xs text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={sync.autoSync}
                    onChange={(e) => handleToggleFolder(sync.folderPath, e.target.checked)}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  Sync this folder automatically
                </label>
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-2">
                <button
                  type="button"
                  onClick={() => handleForgetHistory(sync.folderPath)}
                  className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  title="Forget sync history for this folder"
                >
                  <History className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveFolder(sync.folderPath)}
                  className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  title="Remove folder"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Live engine status. The counts come from the native ledger, so they
          stay accurate across app restarts and background runs. */}
      {folderSyncs.length > 0 && status && (
        <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-2">
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat label="Waiting" value={status.pending} />
            <Stat label="Uploaded" value={status.uploaded} />
            <Stat label="Already synced" value={status.duplicates} />
            <Stat label="Failed" value={status.failed} />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {status.running
              ? 'Syncing now…'
              : status.lastRunAt
                ? `Last checked: ${new Date(status.lastRunAt).toLocaleString()}`
                : 'Not checked yet'}
          </p>
          {!status.hasAuthToken && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Signed out — sync is paused until you sign in again.
            </p>
          )}
          {status.lastError && (
            <p className="text-xs text-red-600 dark:text-red-400">Last error: {status.lastError}</p>
          )}
        </div>
      )}

      {/* Files the engine gave up on. Surfaced explicitly rather than silently
          dropped, since they're the one case that needs a human decision. */}
      {quarantined.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          <button
            type="button"
            onClick={() => setShowQuarantined(v => !v)}
            className="flex items-center gap-2 w-full text-left text-sm text-amber-900 dark:text-amber-200"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1">
              {quarantined.length} file{quarantined.length > 1 ? 's were' : ' was'} skipped after repeated failures
            </span>
            {showQuarantined ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showQuarantined && (
            <ul className="mt-2 space-y-2">
              {quarantined.map((file) => (
                <li key={file.id} className="flex items-start justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-mono text-amber-900 dark:text-amber-200 truncate">{file.name}</p>
                    {file.error && (
                      <p className="text-amber-700 dark:text-amber-400 break-words">{file.error}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRetryQuarantined(file.id)}
                    className="shrink-0 px-2 py-1 border border-amber-300 dark:border-amber-700 rounded text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                  >
                    Retry
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Run conditions. These map onto the native job's WorkManager
          constraints, so the OS enforces them even with the app closed. */}
      {status && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white">Sync settings</h4>

          <Toggle
            label="Sync in the background"
            hint="Checks your folders on a schedule, even when the app is closed."
            checked={status.enabled}
            onChange={(v) => updateSetting({ enabled: v })}
          />
          <Toggle
            label="Wi-Fi only"
            hint="Avoids uploading large batches over mobile data."
            checked={status.wifiOnly}
            onChange={(v) => updateSetting({ wifiOnly: v })}
          />
          <Toggle
            label="Skip when battery is low"
            hint="Waits until the phone has charge to spare."
            checked={status.batteryNotLow}
            onChange={(v) => updateSetting({ batteryNotLow: v })}
          />

          <label className="block">
            <span className="text-sm text-gray-700 dark:text-gray-200">Check for new photos</span>
            <select
              value={status.intervalMinutes}
              onChange={(e) => updateSetting({ intervalMinutes: Number(e.target.value) })}
              className="mt-1 block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm p-2"
            >
              {INTERVAL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 block">
              Android may delay a check to save battery. Your folders are also checked whenever you open the app.
            </span>
          </label>
        </div>
      )}

      {folderSyncs.length > 0 && status?.enabled && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
          <p className="text-xs text-green-800 dark:text-green-300">
            <strong>Auto-sync enabled:</strong> New photos in configured folders are uploaded automatically in
            the background, even when the app is closed. Photos already in this event are skipped, so
            re-adding a folder never uploads anything twice.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-lg font-semibold text-gray-900 dark:text-white">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}

function Toggle({
  label, hint, checked, onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 rounded border-gray-300 dark:border-gray-600"
      />
      <span className="min-w-0">
        <span className="block text-sm text-gray-700 dark:text-gray-200">{label}</span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">{hint}</span>
      </span>
    </label>
  );
}
