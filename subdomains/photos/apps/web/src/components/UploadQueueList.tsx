
import { Upload, AlertCircle, Loader2, ChevronDown } from 'lucide-react';
import type { UploadQueueItem } from '../types';

interface UploadQueueListProps {
  queueItems: UploadQueueItem[];
  itemsToShow: number;
  onLoadMore: () => void;
}

export default function UploadQueueList({ queueItems, itemsToShow, onLoadMore }: UploadQueueListProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'uploading': return 'bg-blue-500';
      case 'failed': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow p-4 sm:p-6">
      <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <Upload className="w-5 h-5" />
        <span>Upload Queue</span>
        {queueItems.length > 0 && (
          <span className="ml-2 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded-full">
            {queueItems.length}
          </span>
        )}
      </h2>
      
      {queueItems.length === 0 ? (
        <div className="text-center py-8">
          <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3">
            <Upload className="w-8 h-8 text-gray-400 dark:text-gray-500" />
          </div>
          <p className="text-gray-600 dark:text-gray-400">No uploads in queue</p>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">Files you upload will appear here</p>
        </div>
      ) : (
        <>
          <div className="space-y-3 sm:space-y-4">
            {queueItems.slice(0, itemsToShow).map((item) => (
              <div key={item.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 hover:border-gray-300 dark:hover:border-gray-600 transition bg-gray-50 dark:bg-gray-900/50">
                <div className="flex justify-between items-start mb-2 gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white truncate text-sm sm:text-base">{item.file.name}</p>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                      {(item.file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <span className={`px-2 sm:px-3 py-1 rounded-full text-white text-xs font-medium ${getStatusColor(item.status)} flex-shrink-0`}>
                    {item.status}
                  </span>
                </div>
                
                {item.status === 'uploading' && (
                  <div className="space-y-1">
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${item.progress}%` }}
                      ></div>
                    </div>
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>{item.progress}%</span>
                    </p>
                  </div>
                )}
                
                {item.status === 'failed' && (
                  <div className="flex items-start gap-2 text-xs sm:text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded p-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{item.error}</span>
                  </div>
                )}
                
                {item.captureTime && (
                  <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-2">
                    Captured: {new Date(item.captureTime).toLocaleString()}
                  </p>
                )}
              </div>
            ))}
          </div>
          {queueItems.length > itemsToShow && (
            <div className="mt-4 sm:mt-6 text-center">
              <button
                onClick={onLoadMore}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-sm hover:shadow flex items-center gap-2 mx-auto text-sm sm:text-base"
              >
                <ChevronDown className="w-4 h-4" />
                <span>Load More ({queueItems.length - itemsToShow} remaining)</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
