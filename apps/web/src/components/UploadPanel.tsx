import React, { useState } from 'react';
import { Upload, FolderSync } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useUpload } from '../hooks/useUpload';
import FolderSyncManager from './FolderSyncManager';

interface UploadPanelProps {
  slug: string;
  onUploadsComplete?: () => void;
}

/**
 * Slim upload panel: handles drag-drop overlay and notifies parent when uploads finish.
 * The actual progress UI is rendered globally by <GlobalUploadIndicator /> in App.tsx.
 */
const UploadPanel: React.FC<UploadPanelProps> = ({ slug, onUploadsComplete }) => {
  const {
    isDragging,
    hasActiveUploads,
    totalCount,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useUpload(slug);

  const isNative = Capacitor.isNativePlatform();
  const [showFolderSync, setShowFolderSync] = useState(false);

  // Notify parent when all uploads complete
  const prevActiveRef = React.useRef(hasActiveUploads);
  React.useEffect(() => {
    if (prevActiveRef.current && !hasActiveUploads && totalCount > 0 && onUploadsComplete) {
      onUploadsComplete();
    }
    prevActiveRef.current = hasActiveUploads;
  }, [hasActiveUploads, totalCount, onUploadsComplete]);

  return (
    <>
      {/* Full-page drag overlay */}
      {isDragging && (
        <div
          className="fixed inset-0 z-50 bg-blue-500/20 backdrop-blur-sm flex items-center justify-center"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center border-4 border-dashed border-blue-500">
            <Upload className="w-12 h-12 text-blue-600 mx-auto mb-3" />
            <p className="text-lg font-semibold text-gray-900 dark:text-white">Drop files here</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">JPEG images and MP4 videos</p>
          </div>
        </div>
      )}

      {/* Folder sync (Android only) — toggle button + collapsible panel */}
      {isNative && (
        <div className="mb-4">
          <button
            onClick={() => setShowFolderSync(!showFolderSync)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <FolderSync className="w-4 h-4" />
            Folder Sync
          </button>
          {showFolderSync && (
            <div className="mt-3">
              <FolderSyncManager eventSlug={slug} />
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default UploadPanel;
