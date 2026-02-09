import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import { Folder, Plus, Trash2, RefreshCw, Smartphone } from 'lucide-react';
import { folderSyncService, FolderSyncConfig } from '../services/folderSync';
import { backgroundSyncService } from '../services/backgroundSync';

interface Props {
  eventSlug: string;
}

export default function FolderSyncManager({ eventSlug }: Props) {
  const [folderSyncs, setFolderSyncs] = useState<FolderSyncConfig[]>([]);
  const [isNative, setIsNative] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setIsNative(Capacitor.isNativePlatform());
    if (Capacitor.isNativePlatform()) {
      loadFolderSyncs();
    }
  }, []);

  const loadFolderSyncs = () => {
    const syncs = folderSyncService.getFolderSyncs();
    setFolderSyncs(syncs.filter(s => s.eventSlug === eventSlug));
  };

  const handleAddFolder = async () => {
    try {
      // Request permissions
      const permissions = await Filesystem.requestPermissions();
      if (permissions.publicStorage !== 'granted') {
        alert('Storage permission is required to sync folders');
        return;
      }

      // For now, use a hardcoded common photo folder path
      // In a production app, you'd use a folder picker plugin
      const folderPath = 'DCIM/Camera'; // Common Android camera folder
      
      await folderSyncService.addFolderSync(eventSlug, folderPath);
      loadFolderSyncs();
      
      alert(`Folder added! ${await syncFolder(folderPath)} photos queued for upload.`);
    } catch (error) {
      console.error('Error adding folder:', error);
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
      alert('Failed to sync folder');
    }
  };

  if (!isNative) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Smartphone className="w-5 h-5 text-blue-600 mt-0.5" />
          <div>
            <h3 className="font-medium text-blue-900">Mobile App Feature</h3>
            <p className="text-sm text-blue-700 mt-1">
              Folder syncing is only available in the mobile app. Install the Photos app on your 
              iOS or Android device to automatically sync folders to this event.
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
          <Folder className="w-5 h-5 text-gray-600" />
          <h3 className="font-medium text-gray-900">Folder Sync</h3>
        </div>
        <button
          onClick={handleAddFolder}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Folder
        </button>
      </div>

      {folderSyncs.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
          <Folder className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600 mb-2">No folders configured</p>
          <p className="text-sm text-gray-500">
            Add a folder to automatically sync photos to this event in the background
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {folderSyncs.map((sync) => (
            <div
              key={sync.folderPath}
              className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Folder className="w-4 h-4 text-gray-500" />
                  <span className="font-mono text-sm text-gray-900">{sync.folderPath}</span>
                </div>
                {sync.lastSyncTime && (
                  <p className="text-xs text-gray-500 mt-1">
                    Last synced: {new Date(sync.lastSyncTime).toLocaleString()}
                  </p>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSyncFolder(sync.folderPath)}
                  disabled={syncing}
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                  title="Sync now"
                >
                  <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => handleRemoveFolder(sync.folderPath)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Remove folder"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
        <p className="text-xs text-yellow-800">
          <strong>Auto-sync:</strong> The app will automatically check for new photos in configured 
          folders and upload them in the background, even when the app is closed.
        </p>
      </div>
    </div>
  );
}
