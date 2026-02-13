interface GallerySortFilterProps {
  sortBy: string;
  onSortChange: (value: string) => void;
  selectedCount: number;
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
  onDownloadSelected,
  onDeleteSelected,
  isAdmin = false,
  isDeleting = false,
}: GallerySortFilterProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-3 sm:p-4 mb-6">
      <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 sm:items-center">
        <div className="flex-1 sm:flex-none">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Sort by
          </label>
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="date_desc">Date (Newest First)</option>
            <option value="date_asc">Date (Oldest First)</option>
            <option value="name_asc">Name (A-Z)</option>
            <option value="name_desc">Name (Z-A)</option>
          </select>
        </div>

        {selectedCount > 0 && (
          <>
            <button
              onClick={onDownloadSelected}
              className="w-full sm:w-auto px-6 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 active:scale-95 transition-all text-sm font-semibold shadow-md flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span className="hidden sm:inline">Download Selected</span>
              <span className="sm:hidden">Download</span>
              <span>({selectedCount})</span>
            </button>

            {isAdmin && onDeleteSelected && (
              <button
                onClick={onDeleteSelected}
                disabled={isDeleting}
                className="w-full sm:w-auto px-6 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 active:scale-95 transition-all text-sm font-semibold shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>{isDeleting ? 'Deleting...' : 'Delete Selected'}</span>
                <span>({selectedCount})</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
