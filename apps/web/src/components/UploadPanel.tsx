import React from 'react';
import { Upload } from 'lucide-react';
import { useUpload } from '../hooks/useUpload';

interface UploadPanelProps {
  slug: string;
}

/**
 * Slim upload panel: handles the drag-drop overlay.
 * The actual progress UI is rendered globally by <GlobalUploadIndicator /> in App.tsx.
 */
const UploadPanel: React.FC<UploadPanelProps> = ({ slug }) => {
  const {
    isDragging,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useUpload(slug);

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
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">JPEG/PNG/RAW images and MP4 videos</p>
          </div>
        </div>
      )}
    </>
  );
};

export default UploadPanel;
