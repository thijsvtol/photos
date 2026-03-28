import { Capacitor } from '@capacitor/core';

interface GallerySortFilterProps {
  sortBy: string;
  onSortChange: (value: string) => void;
  selectedCount: number;
  onSelectAllVisible?: () => void;
  onClearSelection?: () => void;
  onToggleFavoriteSelected?: () => void;
  onToggleFeaturedSelected?: () => void;
  showFeaturedAction?: boolean;
  onDownloadSelected: () => void;
  onDeleteSelected?: () => void;
  isAdmin?: boolean;
  isDeleting?: boolean;
}

/**
 * Sort controls and bulk action buttons for gallery
 */
export function GallerySortFilter({
  sortBy,
  onSortChange,
  selectedCount,
  onSelectAllVisible,
  onClearSelection,
  onToggleFavoriteSelected,
  onToggleFeaturedSelected,
  showFeaturedAction = false,
  onDownloadSelected,
  onDeleteSelected,
  isAdmin = false,
  isDeleting = false,
}: GallerySortFilterProps) {
  const isAndroid = Capacitor.getPlatform() === 'android';
  
  return (
    <>
      {/* Fixed action bar when photos are selected */}
      {selectedCount > 0 && (
        <div
          data-selection-toolbar="true"
          className={`fixed ${isAndroid ? 'top-nav-offset-android' : 'top-nav-offset'} left-0 right-0 bg-indigo-600 dark:bg-indigo-700 shadow-lg z-40 border-b-2 border-indigo-700 dark:border-indigo-800`}
        >
          <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
            <div className="flex items-center justify-between py-2 sm:py-2.5 gap-3 flex-wrap">
              <span className="text-white font-medium text-sm">
                {selectedCount} {selectedCount === 1 ? 'photo' : 'photos'} selected
              </span>
              
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {onSelectAllVisible && (
                  <button
                    onClick={onSelectAllVisible}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors text-sm font-medium border border-white/20"
                  >
                    Select Visible
                  </button>
                )}

                {onClearSelection && (
                  <button
                    onClick={onClearSelection}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors text-sm font-medium border border-white/20"
                  >
                    Deselect
                  </button>
                )}

                <button
                  onClick={onDownloadSelected}
                  className="px-3 sm:px-4 py-1.5 sm:py-2 bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium flex items-center gap-2 border border-white/20"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span className="hidden sm:inline">Download</span>
                  <span className="sm:hidden">Download</span>
                </button>

                {onToggleFavoriteSelected && (
                  <button
                    onClick={onToggleFavoriteSelected}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors text-sm font-medium border border-white/20"
                  >
                    Favorite
                  </button>
                )}

                {showFeaturedAction && onToggleFeaturedSelected && (
                  <button
                    onClick={onToggleFeaturedSelected}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors text-sm font-medium border border-white/20"
                  >
                    Feature
                  </button>
                )}

                {isAdmin && onDeleteSelected && (
                  <button
                    onClick={onDeleteSelected}
                    disabled={isDeleting}
                    className="px-3 sm:px-4 py-1.5 sm:py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors text-sm font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed border border-white/20"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span className="hidden sm:inline">{isDeleting ? 'Deleting...' : 'Delete'}</span>
                    <span className="sm:hidden">Delete</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sort controls - always visible */}
      <div data-gallery-controls="true" className="bg-white dark:bg-gray-800 rounded-lg shadow p-3 sm:p-4 mb-6">
        <div className="flex items-center">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mr-3">
            Sort by
          </label>
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="date_desc">Date (Newest First)</option>
            <option value="date_asc">Date (Oldest First)</option>
            <option value="name_asc">Name (A-Z)</option>
            <option value="name_desc">Name (Z-A)</option>
          </select>
        </div>
      </div>
    </>
  );
}
