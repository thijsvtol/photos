import { useState } from 'react';
import { X, CheckSquare, Heart, Star, Download, Trash2, Loader2, Copy, Search, Grid3X3, Grid2X2, LayoutGrid, Image, Video, LayoutList, SlidersHorizontal, MapPin, Users, Check } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

type DensityLevel = 'comfortable' | 'default' | 'dense';
export type MediaTypeFilter = 'all' | 'photos' | 'videos';

interface SimplePerson {
  id: number;
  name: string;
}

interface GallerySortFilterProps {
  sortBy: string;
  onSortChange: (value: string) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  mediaTypeFilter?: MediaTypeFilter;
  onMediaTypeFilterChange?: (value: MediaTypeFilter) => void;
  selectedCount: number;
  onSelectAllVisible?: () => void;
  onClearSelection?: () => void;
  onToggleFavoriteSelected?: () => void;
  onToggleFeaturedSelected?: () => void;
  showFeaturedAction?: boolean;
  onDownloadSelected: () => void;
  onCopySelected?: () => void;
  onDeleteSelected?: () => void;
  isAdmin?: boolean;
  isDeleting?: boolean;
  isCopying?: boolean;
  /** Global-admin-only action: open the location picker for the selected photos.
   *  Omit to hide the action (e.g. for non-admin collaborators). */
  onSetLocationSelected?: () => void;
  /** Opens the "Tag people" picker for the selected photos (additive — never removes existing
   *  tags). Omit to hide the action (e.g. for viewers without edit permission). */
  onTagPeopleSelected?: () => void;
  isGlobalAdmin?: boolean;
  density?: DensityLevel;
  onDensityChange?: (density: DensityLevel) => void;
  /** People filter — folded into this shared sort/filter bar (rather than its own separate
   *  chips-row above the gallery, which is what EventGallery/Timeline each used to render
   *  independently) so filtering by person lives in the same place as every other filter
   *  control instead of being yet another distinct row. Omit `namedPeople` entirely to hide
   *  this control (e.g. non-admin EventGallery visitors). */
  namedPeople?: SimplePerson[];
  selectedPersonIds?: Set<number>;
  onTogglePerson?: (personId: number) => void;
}

/**
 * Sort controls and bulk action buttons for gallery
 */
export function GallerySortFilter({
  sortBy,
  onSortChange,
  searchQuery,
  onSearchChange,
  mediaTypeFilter = 'all',
  onMediaTypeFilterChange,
  selectedCount,
  onSelectAllVisible,
  onClearSelection,
  onToggleFavoriteSelected,
  onToggleFeaturedSelected,
  showFeaturedAction = false,
  onDownloadSelected,
  onCopySelected,
  onDeleteSelected,
  isAdmin = false,
  isDeleting = false,
  isCopying = false,
  onSetLocationSelected,
  onTagPeopleSelected,
  isGlobalAdmin = false,
  density,
  onDensityChange,
  namedPeople,
  selectedPersonIds,
  onTogglePerson,
}: GallerySortFilterProps) {
  const isAndroid = Capacitor.getPlatform() === 'android';
  // On mobile, the media-type filter + grid-density controls are tucked into a
  // collapsible row (toggled via the Filters button) so the always-visible row
  // only has Sort + Search — previously all 4-5 control groups tried to fit on
  // one line and wrapped messily on narrow screens. On sm+ screens this row is
  // always shown regardless of this state (see `sm:flex` below).
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [showPeoplePicker, setShowPeoplePicker] = useState(false);
  const [peopleSearchQuery, setPeopleSearchQuery] = useState('');
  const hasPeopleFilter = Boolean(namedPeople && onTogglePerson);
  const hasSecondRow = Boolean(onMediaTypeFilterChange) || Boolean(density && onDensityChange) || hasPeopleFilter;
  const hasActiveMobileFilter = mediaTypeFilter !== 'all' || (selectedPersonIds?.size ?? 0) > 0;
  const selectedPeople = (namedPeople || []).filter((p) => selectedPersonIds?.has(p.id));
  
  return (
    <>
      {/* Fixed action bar when photos are selected */}
      {selectedCount > 0 && (
        <div
          data-selection-toolbar="true"
          className={`fixed ${isAndroid ? 'top-nav-offset-android' : 'top-nav-offset'} left-0 right-0 bg-indigo-600 dark:bg-indigo-700 shadow-lg z-50 border-b border-indigo-700/60 dark:border-indigo-800`}
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

                {/* Copy to Album (admin) */}
                {isAdmin && onCopySelected && (
                  <button
                    onClick={onCopySelected}
                    disabled={isCopying}
                    className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white hover:bg-white/15 transition text-sm font-medium whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Copy selected photos to another album"
                    title={isCopying ? 'Copying...' : 'Copy to Album'}
                  >
                    {isCopying
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Copy className="w-4 h-4" />
                    }
                    <span className="hidden sm:inline">{isCopying ? 'Copying...' : 'Copy to Album'}</span>
                  </button>
                )}

                {/* Set Location (global admin only) */}
                {isGlobalAdmin && onSetLocationSelected && (
                  <button
                    onClick={onSetLocationSelected}
                    className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white hover:bg-white/15 transition text-sm font-medium whitespace-nowrap"
                    aria-label="Set location for selected photos"
                    title="Set Location"
                  >
                    <MapPin className="w-4 h-4" />
                    <span className="hidden sm:inline">Set Location</span>
                  </button>
                )}

                {/* Tag People (editor/admin) */}
                {onTagPeopleSelected && (
                  <button
                    onClick={onTagPeopleSelected}
                    className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white hover:bg-white/15 transition text-sm font-medium whitespace-nowrap"
                    aria-label="Tag people on selected photos"
                    title="Tag People"
                  >
                    <Users className="w-4 h-4" />
                    <span className="hidden sm:inline">Tag People</span>
                  </button>
                )}

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
      <div data-gallery-controls="true" className="bg-white dark:bg-gray-800 rounded-lg shadow p-3 sm:p-4 mb-3 sm:mb-4">
        {/* Row 1: Sort + Search + mobile Filters toggle — always visible */}
        <div className="flex items-center gap-3">
          <div className="flex items-center flex-shrink-0">
            <label className="hidden sm:block text-sm font-medium text-gray-700 dark:text-gray-300 mr-3">
              Sort by
            </label>
            <select
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              aria-label="Sort by"
            >
              <option value="date_desc">Date (Newest First)</option>
              <option value="date_asc">Date (Oldest First)</option>
              <option value="uploaded_desc">Recently Uploaded</option>
              <option value="name_asc">Name (A-Z)</option>
              <option value="name_desc">Name (Z-A)</option>
            </select>
          </div>

          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search photos by name, camera, city..."
              className="w-full pl-9 pr-8 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Filters toggle — mobile only; media type + grid density live in row 2 below */}
          {hasSecondRow && (
            <button
              onClick={() => setShowMobileFilters((prev) => !prev)}
              className={`sm:hidden relative flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${
                showMobileFilters
                  ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400'
                  : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400'
              }`}
              aria-label="Toggle filters and view options"
              aria-expanded={showMobileFilters}
              title="Filters & view"
            >
              <SlidersHorizontal className="w-4 h-4" />
              {hasActiveMobileFilter && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-500" aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        {/* Row 2: Media type filter + grid density — collapsible on mobile (toggled
            above), always visible on sm+ screens regardless of the toggle state. */}
        {hasSecondRow && (
          <div
            className={`${showMobileFilters ? 'flex' : 'hidden'} sm:flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700`}
          >
            {/* Media type filter: All / Photos / Videos */}
            {onMediaTypeFilterChange && (
              <div
                className="flex items-center gap-0.5 border border-gray-300 dark:border-gray-600 rounded-lg p-0.5"
                role="group"
                aria-label="Filter by media type"
              >
                <button
                  onClick={() => onMediaTypeFilterChange('all')}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${mediaTypeFilter === 'all' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                  title="Show all media"
                  aria-label="Show all media"
                  aria-pressed={mediaTypeFilter === 'all'}
                >
                  <LayoutList className="w-4 h-4" />
                  <span className="inline">All</span>
                </button>
                <button
                  onClick={() => onMediaTypeFilterChange('photos')}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${mediaTypeFilter === 'photos' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                  title="Show photos only"
                  aria-label="Show photos only"
                  aria-pressed={mediaTypeFilter === 'photos'}
                >
                  <Image className="w-4 h-4" />
                  <span className="inline">Photos</span>
                </button>
                <button
                  onClick={() => onMediaTypeFilterChange('videos')}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${mediaTypeFilter === 'videos' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                  title="Show videos only"
                  aria-label="Show videos only"
                  aria-pressed={mediaTypeFilter === 'videos'}
                >
                  <Video className="w-4 h-4" />
                  <span className="inline">Videos</span>
                </button>
              </div>
            )}

            {/* Grid density controls */}
            {density && onDensityChange && (
              <div className="flex items-center gap-0.5 border border-gray-300 dark:border-gray-600 rounded-lg p-0.5">
                <button
                  onClick={() => onDensityChange('comfortable')}
                  className={`p-1.5 rounded transition-colors ${density === 'comfortable' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                  title="Comfortable (larger photos)"
                  aria-label="Comfortable grid density"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDensityChange('default')}
                  className={`p-1.5 rounded transition-colors ${density === 'default' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                  title="Default"
                  aria-label="Default grid density"
                >
                  <Grid2X2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDensityChange('dense')}
                  className={`p-1.5 rounded transition-colors ${density === 'dense' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                  title="Dense (more photos per row)"
                  aria-label="Dense grid density"
                >
                  <Grid3X3 className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* People filter — a searchable popover instead of a separate always-visible
                chips row, folding it into the same sort/filter bar as everything else. */}
            {hasPeopleFilter && (
              <div className="relative">
                <button
                  onClick={() => setShowPeoplePicker((v) => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    selectedPeople.length > 0
                      ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400'
                      : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                  aria-expanded={showPeoplePicker}
                >
                  <Users className="w-4 h-4" />
                  {selectedPeople.length > 0 ? `${selectedPeople.length} ${selectedPeople.length === 1 ? 'person' : 'people'}` : 'People'}
                </button>

                {showPeoplePicker && (
                  <div className="absolute left-0 top-full mt-2 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 z-30">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                      Selecting multiple people only shows photos where they're all together.
                    </p>
                    <input
                      type="text"
                      value={peopleSearchQuery}
                      onChange={(e) => setPeopleSearchQuery(e.target.value)}
                      placeholder="Search people…"
                      className="w-full mb-2 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <div className="max-h-56 overflow-y-auto space-y-1">
                      {(namedPeople || []).length === 0 ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400 py-2 text-center">No named people yet.</p>
                      ) : (
                        (namedPeople || [])
                          .filter((p) => p.name.toLowerCase().includes(peopleSearchQuery.trim().toLowerCase()))
                          .map((p) => {
                            const selected = selectedPersonIds?.has(p.id) ?? false;
                            return (
                              <button
                                key={p.id}
                                onClick={() => onTogglePerson?.(p.id)}
                                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition ${
                                  selected
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-50 dark:bg-gray-700/60 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                                }`}
                              >
                                <span>{p.name}</span>
                                {selected && <Check className="w-4 h-4 shrink-0" />}
                              </button>
                            );
                          })
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Selected-people chips (only when the people filter is active at all) */}
        {hasPeopleFilter && selectedPeople.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            {selectedPeople.map((p) => (
              <span
                key={p.id}
                className="flex items-center gap-1 pl-3 pr-1.5 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 text-sm rounded-full"
              >
                {p.name}
                <button
                  onClick={() => onTogglePerson?.(p.id)}
                  className="p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition"
                  aria-label={`Remove ${p.name} filter`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
