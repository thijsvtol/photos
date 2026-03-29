import { X, CheckSquare, Heart, Star, Download, Trash2, Loader2 } from 'lucide-react';
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
          className={`fixed ${isAndroid ? 'top-nav-offset-android' : 'top-nav-offset'} left-0 right-0 bg-indigo-600 dark:bg-indigo-700 shadow-lg z-40 border-b border-indigo-700/60 dark:border-indigo-800`}
        >
          <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
            <div className="flex items-center py-2 gap-2">

              {/* Dismiss button */}
              {onClearSelection && (
                <button
                  onClick={onClearSelection}
                  className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg text-white/70 hover:text-white hover:bg-white/15 transition"
                  aria-label="Clear selection"
                  title="Clear selection"
                >
                  <X className="w-5 h-5" />
                </button>
              )}

              {/* Count */}
              <span className="text-white font-semibold text-sm flex-shrink-0">
                {selectedCount} {selectedCount === 1 ? 'photo' : 'photos'}
              </span>

              {/* Divider */}
              <div className="w-px h-5 bg-white/25 flex-shrink-0 mx-0.5" />

              {/* Scrollable action buttons */}
              <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-hide">

                {/* Select All */}
                {onSelectAllVisible && (
                  <button
                    onClick={onSelectAllVisible}
                    className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white hover:bg-white/15 transition text-sm font-medium whitespace-nowrap"
                    aria-label="Select all visible photos"
                    title="Select all visible"
                  >
                    <CheckSquare className="w-4 h-4" />
                    <span className="hidden sm:inline">Select All</span>
                  </button>
                )}

                {/* Favorite */}
                {onToggleFavoriteSelected && (
                  <button
                    onClick={onToggleFavoriteSelected}
                    className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white hover:bg-white/15 transition text-sm font-medium whitespace-nowrap"
                    aria-label="Toggle favorite for selected photos"
                    title="Favorite / Unfavorite"
                  >
                    <Heart className="w-4 h-4" />
                    <span className="hidden sm:inline">Favorite</span>
                  </button>
                )}

                {/* Feature (admin only) */}
                {showFeaturedAction && onToggleFeaturedSelected && (
                  <button
                    onClick={onToggleFeaturedSelected}
                    className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white hover:bg-white/15 transition text-sm font-medium whitespace-nowrap"
                    aria-label="Toggle featured for selected photos"
                    title="Feature / Unfeature"
                  >
                    <Star className="w-4 h-4" />
                    <span className="hidden sm:inline">Feature</span>
                  </button>
                )}

                {/* Download */}
                <button
                  onClick={onDownloadSelected}
                  className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white hover:bg-white/15 transition text-sm font-medium whitespace-nowrap"
                  aria-label="Download selected as ZIP"
                  title="Download as ZIP"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">Download</span>
                </button>

                {/* Delete (admin, destructive — last) */}
                {isAdmin && onDeleteSelected && (
                  <button
                    onClick={onDeleteSelected}
                    disabled={isDeleting}
                    className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-red-200 hover:bg-red-500/20 transition text-sm font-medium whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Delete selected photos"
                    title={isDeleting ? 'Deleting...' : 'Delete selected'}
                  >
                    {isDeleting
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Trash2 className="w-4 h-4" />
                    }
                    <span className="hidden sm:inline">{isDeleting ? 'Deleting...' : 'Delete'}</span>
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
