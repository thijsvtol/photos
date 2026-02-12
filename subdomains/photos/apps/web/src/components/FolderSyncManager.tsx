import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Folder, Plus, Trash2, RefreshCw, Smartphone } from 'lucide-react';
import { folderSyncService, FolderSyncConfig } from '../services/folderSync';
import { backgroundSyncService } from '../services/backgroundSync';

interface Props {
  eventSlug: string;
}

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
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const isNativePlatform = Capacitor.isNativePlatform();
    setIsNative(isNativePlatform);
    if (isNativePlatform) {
      loadFolderSyncs();
    }
  }, []);

  const loadFolderSyncs = () => {
    const syncs = folderSyncService.getFolderSyncs();
    setFolderSyncs(syncs.filter(s => s.eventSlug === eventSlug));
  };

  const handleAddFolder = async () => {
    try {
      // pickDirectory() uses Android's Storage Access Framework (SAF)
      const result = await FilePicker.pickDirectory();
      
      if (!result.path) {
        return; // User cancelled
      }

      // Store the raw content:// tree URI — the SAF plugin needs it as-is
      const folderUri = result.path;

      await folderSyncService.addFolderSync(eventSlug, folderUri);
      loadFolderSyncs();
      
      const count = await syncFolder(folderUri);
      alert(`Folder added! ${count} photos queued for upload.`);
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
    } catch (error) {
      console.error('Error removing folder:', error);
      alert('Failed to remove folder');
    }
  };

  const syncFolder = async (folderPath: string): Promise<number> => {
    setSyncing(true);
    try {
      const count = await folderSyncService.syncFolder(folderPath);
      
      // Trigger background sync to start uploading
      await backgroundSyncService.syncNow();
      
      return count;
    } catch (error) {
      console.error('Error syncing folder:', error);
      throw error;
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncFolder = async (folderPath: string) => {
    try {
      const count = await syncFolder(folderPath);
      alert(`${count} new photos added to upload queue`);
      loadFolderSyncs();
    } catch (error) {
      alert('Failed to sync folder: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Folder className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <h3 className="font-medium text-gray-900 dark:text-white">Folder Sync</h3>
        </div>
        <button
          onClick={handleAddFolder}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Select Folder
        </button>
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
                {sync.lastSyncTime && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Last synced: {new Date(sync.lastSyncTime).toLocaleString()}
                  </p>
                )}
              </div>
              
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <button
                  onClick={() => handleSyncFolder(sync.folderPath)}
                  disabled={syncing}
                  className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50"
                  title="Sync now"
                >
                  <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                </button>
                <button
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

      {folderSyncs.length > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
          <p className="text-xs text-green-800 dark:text-green-300">
            <strong>Auto-sync enabled:</strong> New photos in configured folders will be detected and 
            uploaded automatically, including when the app is in the background.
          </p>
        </div>
      )}
    </div>
  );
}
