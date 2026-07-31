import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CheckCircle, AlertCircle, Loader2, ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react';
import { useUploadContext } from '../contexts/UploadContext';
import { MAX_RETRIES } from '../services/uploadManager';

/**
 * Global upload indicator rendered at app root — visible on ALL pages.
 * Google Photos style: compact floating pill at the bottom, expandable for details.
 * Hidden on photo detail page to avoid overlapping fullscreen viewer controls.
 */
const GlobalUploadIndicator: React.FC = () => {
  const location = useLocation();
  const {
    queueItems,
    hasActiveUploads,
    hasFailedUploads,
    completedCount,
    totalCount,
    overallProgress,
    retryUpload,
    retryAllFailed,
    clearCompleted,
    cancelUpload,
    cancelAll,
  } = useUploadContext();

  const [isExpanded, setIsExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const collapse = () => { setIsExpanded(false); setVisibleCount(50); };

  // Hide on fullscreen photo detail page (/p/:slug/:photoId)
  if (location.pathname.startsWith('/p/')) return null;

  // Nothing to show
  if (totalCount === 0) return null;

  const activeItems = queueItems.filter(i => i.status === 'uploading');
  const pendingItems = queueItems.filter(i => i.status === 'pending');
  const failedItems = queueItems.filter(i => i.status === 'failed');
  const remainingCount = activeItems.length + pendingItems.length;

  // ── Compact pill ──
  if (!isExpanded) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-sm pointer-events-auto">
        <button
          onClick={() => setIsExpanded(true)}
          className="w-full bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-xl transition"
        >
          <div className="px-4 py-3 flex items-center gap-3">
            {hasActiveUploads ? (
              <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin flex-shrink-0" />
            ) : hasFailedUploads ? (
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            ) : (
              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-900 dark:text-white font-medium truncate">
                  {hasActiveUploads
                    ? `Uploading ${remainingCount} item${remainingCount !== 1 ? 's' : ''}…`
                    : hasFailedUploads
                    ? `${failedItems.length} upload${failedItems.length !== 1 ? 's' : ''} failed`
                    : `${completedCount} upload${completedCount !== 1 ? 's' : ''} complete`}
                </span>
                <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0 ml-2" />
              </div>
              {hasActiveUploads && (
                <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5 mt-1.5">
                  <div
                    className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${overallProgress}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </button>
      </div>
    );
  }

  // ── Expanded panel ──
  return (
    <div className="fixed bottom-0 left-0 right-0 z-[60] max-h-[70vh] flex flex-col pointer-events-auto">
      {/* Backdrop tap to collapse */}
      <div
        className="flex-shrink-0 h-8 bg-gradient-to-b from-transparent to-black/20 cursor-pointer"
        onClick={collapse}
      />

      <div className="bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl border-t border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
            Uploads {totalCount > 0 && `(${completedCount}/${totalCount})`}
          </h3>
          <div className="flex items-center gap-2">
            {(hasActiveUploads || hasFailedUploads) && (
              <button
                onClick={cancelAll}
                className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600 transition"
              >
                Cancel All
              </button>
            )}
            {hasFailedUploads && (
              <button
                onClick={retryAllFailed}
                className="px-3 py-1 text-xs bg-red-600 text-white rounded-full hover:bg-red-700 transition flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Retry All
              </button>
            )}
            {completedCount > 0 && !hasActiveUploads && (
              <button
                onClick={clearCompleted}
                className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600 transition"
              >
                Clear
              </button>
            )}
            <button
              onClick={collapse}
              className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition"
            >
              <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Queue items */}
        <div className="overflow-y-auto flex-1 max-h-[50vh]">
          {queueItems.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
              No uploads.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {queueItems.slice().reverse().slice(0, visibleCount).map((item) => (
                <div key={item.id} className="px-4 py-2.5 flex items-center gap-3">
                  {/* Status icon */}
                  <div className="flex-shrink-0">
                    {item.status === 'uploading' && <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />}
                    {item.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />}
                    {item.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-500" />}
                    {item.status === 'failed' && <AlertCircle className="w-4 h-4 text-red-500" />}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-white truncate">{item.file?.name || item.photoId}</p>
                    {item.status === 'uploading' && (
                      <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1 mt-1">
                        <div className="bg-blue-600 h-1 rounded-full transition-all" style={{ width: `${item.progress}%` }} />
                      </div>
                    )}
                    {item.status === 'uploading' && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {item.phase === 'preview' ? 'Uploading preview…' : 'Uploading…'}
                      </p>
                    )}
                    {item.status === 'pending' && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Waiting to upload…</p>
                    )}
                    {item.status === 'failed' && (
                      <p className="text-xs text-red-500 truncate mt-0.5">{item.error || 'Upload failed'}</p>
                    )}
                    {item.status === 'failed' && (item.retries || 0) >= MAX_RETRIES && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Auto-retry stopped after {MAX_RETRIES} attempts — retry to try again.
                      </p>
                    )}
                  </div>

                  {/* Retry button */}
                  {item.status === 'failed' && (
                    <button
                      onClick={() => retryUpload(item.id)}
                      className="flex-shrink-0 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                      title="Retry"
                    >
                      <RotateCcw className="w-4 h-4 text-gray-500" />
                    </button>
                  )}

                  {/* Cancel/remove button — always available so a stuck or
                      half-uploaded item can be cleared regardless of status */}
                  {item.status !== 'completed' && (
                    <button
                      onClick={() => cancelUpload(item.id)}
                      className="flex-shrink-0 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                      title={item.status === 'failed' ? 'Remove' : 'Cancel'}
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </button>
                  )}

                  {/* Progress text */}
                  {item.status === 'uploading' && (
                    <span className="flex-shrink-0 text-xs text-gray-500 tabular-nums">{item.progress}%</span>
                  )}
                </div>
              ))}
              {queueItems.length > visibleCount && (
                <button
                  onClick={() => setVisibleCount(c => c + 50)}
                  className="w-full px-4 py-2 text-xs text-blue-600 dark:text-blue-400 text-center hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
                >
                  +{queueItems.length - visibleCount} more — show more
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GlobalUploadIndicator;
