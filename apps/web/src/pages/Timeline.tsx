import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, Download, X, Search, Users, Check } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { TimelineSkeleton } from '../components/Skeletons';
import SEO from '../components/SEO';
import JustifiedGrid from '../components/JustifiedGrid';
import VerticalDateScrubber from '../components/VerticalDateScrubber';
import MemoriesCarousel from '../components/MemoriesCarousel';
import { useGridDensity } from '../hooks/useGridDensity';
import { usePhotoSelection } from '../hooks/usePhotoSelection';
import { getTimeline, getUserFavoriteIds, toggleFavorite as toggleFavoriteAPI, requestZip, downloadZip, getMyPhotos, searchPhotos, getPublicNamedPeople } from '../api';
import type { SearchResultPhoto, PublicNamedPerson } from '../api';
import { getCachedTimelinePhotos, cacheTimelinePhotos } from '../services/timelineCache';
import type { Photo } from '../types';
import { config } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { haptics } from '../utils/haptics';

/** Group photos by date (YYYY-MM-DD from capture_time) */
function groupByDate(photos: Photo[]): { dates: string[]; groups: Map<string, Photo[]> } {
  const groups = new Map<string, Photo[]>();
  for (const photo of photos) {
    const date = photo.capture_time?.slice(0, 10) || 'Unknown';
    const arr = groups.get(date) || [];
    arr.push(photo);
    groups.set(date, arr);
  }
  const dates = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a)); // newest first
  return { dates, groups };
}

/** Format a date string for display — memoized at module level to avoid repeated locale formatting */
const dateFormatCache = new Map<string, string>();
function formatDate(date: string): string {
  const cached = dateFormatCache.get(date);
  if (cached) return cached;
  const dateObj = new Date(date);
  const formatted = dateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  dateFormatCache.set(date, formatted);
  return formatted;
}

/**
 * Lazily renders children only when the element is near the viewport.
 * Shows a placeholder with estimated height when off-screen to maintain scroll position.
 */
function LazyDateGroup({ photoCount, children }: { photoCount: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        } else if (measuredHeight !== null) {
          // Only hide if we've measured the height (so placeholder can be sized correctly)
          setIsVisible(false);
        }
      },
      { rootMargin: '600px 0px' } // Start rendering 600px before entering viewport
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [measuredHeight]);

  // Measure actual height once rendered so placeholder can be accurate
  useEffect(() => {
    if (isVisible && ref.current) {
      const h = ref.current.getBoundingClientRect().height;
      if (h > 0) setMeasuredHeight(h);
    }
  }, [isVisible, children]);

  // Estimate height: ~200px per row, ~4 photos per row on average
  const estimatedHeight = measuredHeight || Math.max(120, Math.ceil(photoCount / 4) * 200);

  return (
    <div ref={ref} style={!isVisible ? { minHeight: estimatedHeight } : undefined}>
      {isVisible ? children : null}
    </div>
  );
}

const Timeline: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [supportsHover, setSupportsHover] = useState(true);
  const [userFavorites, setUserFavorites] = useState<Set<string>>(new Set());
  // Set of photo IDs containing this account's linked person's face, or null if the account
  // isn't linked to a person at all (see AdminPersonDetail's "Linked account" section) — used
  // to show/hide the "Just me" filter toggle below and to filter the grid when it's active.
  const [myPhotoIds, setMyPhotoIds] = useState<Set<string> | null>(null);
  const [myDisplayName, setMyDisplayName] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'me'>('all');
  const dateRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const { targetRowHeight, containerRef: densityContainerRef } = useGridDensity();

  // Search + people filter — Timeline and the old standalone Search page were nearly identical
  // (both: browse every accessible photo, grouped for display, with favorite/select actions),
  // so they're now one combined page: by default this shows the full timeline (unchanged
  // behavior below); typing a query or picking people switches to a search-results view in
  // place, without navigating away. `/search?...` still works (see App.tsx's redirect) and
  // deep-links straight into search mode via these same URL params.
  const initialQuery = searchParams.get('q') || '';
  const initialPeople = (searchParams.get('people') || '')
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<number>>(new Set(initialPeople));
  const [namedPeople, setNamedPeople] = useState<PublicNamedPerson[]>([]);
  const [showPeoplePicker, setShowPeoplePicker] = useState(false);
  const [peopleSearchQuery, setPeopleSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultPhoto[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const hasActiveSearch = Boolean(searchQuery.trim()) || selectedPersonIds.size > 0;
  const selectedPeople = namedPeople.filter((p) => selectedPersonIds.has(p.id));

  const {
    selectedPhotos,
    togglePhotoSelection: togglePhotoSelectionBase,
    clearSelection,
  } = usePhotoSelection(photos);

  const togglePhotoSelection = async (photoId: string) => {
    await haptics.selectionChanged();
    togglePhotoSelectionBase(photoId);
  };

  const toggleFavorite = async (photoId: string, isFavorited: boolean) => {
    try {
      await toggleFavoriteAPI(photoId, isFavorited);
      await haptics.light();
      setUserFavorites(prev => {
        const next = new Set(prev);
        if (isFavorited) next.delete(photoId);
        else next.add(photoId);
        return next;
      });
    } catch {
      toast.showError('Failed to update favorite');
    }
  };

  const handleDownloadSelected = async () => {
    const selected = Array.from(selectedPhotos);
    if (selected.length === 0) return;
    // Group by event slug
    const bySlug = new Map<string, string[]>();
    for (const id of selected) {
      const photo = photos.find(p => p.id === id);
      const slug = photo?.event_slug || '';
      const arr = bySlug.get(slug) || [];
      arr.push(id);
      bySlug.set(slug, arr);
    }
    try {
      for (const [slug, ids] of bySlug) {
        const blob = await requestZip(slug, ids);
        await downloadZip(blob, `timeline_${slug}_${new Date().toISOString().split('T')[0]}.zip`);
      }
      await haptics.success();
      toast.showSuccess(`Downloaded ${selected.length} photos`);
      clearSelection();
    } catch {
      toast.showError('Download failed');
    }
  };

  // Runs a search (text query and/or people filter) and shows the results in place of the
  // normal date-grouped timeline — see hasActiveSearch's doc comment above for why this exists
  // as a mode switch on the same page rather than a separate route.
  const runSearch = async (q: string, personIds: Set<number>) => {
    if (!q.trim() && personIds.size === 0) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      // 2000 (worker's max, see GET /api/search's `limit` doc comment) rather than the old 200
      // — a person with hundreds/thousands of photos in the library was silently truncated to
      // 200 results with no indication anything was cut off.
      const results = await searchPhotos(q.trim(), 2000, Array.from(personIds));
      setSearchResults(results);
    } catch (err) {
      console.error('Search failed:', err);
      setSearchResults([]);
      setSearchError('Search failed — please try again.');
    } finally {
      setSearching(false);
    }
  };

  const updateUrlAndSearch = (q: string, personIds: Set<number>) => {
    const params: Record<string, string> = {};
    if (q.trim()) params.q = q.trim();
    if (personIds.size > 0) params.people = Array.from(personIds).join(',');
    setSearchParams(params, { replace: true });
    void runSearch(q, personIds);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateUrlAndSearch(searchQuery, selectedPersonIds);
  };

  const handleTogglePerson = (personId: number) => {
    setSelectedPersonIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      updateUrlAndSearch(searchQuery, next);
      return next;
    });
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSelectedPersonIds(new Set());
    setSearchResults(null);
    setSearchError(null);
    setSearchParams({}, { replace: true });
  };

  // Load the public named-people list once (for the people-filter picker) and, if the page was
  // opened with ?q=/?people= already in the URL (e.g. a deep link, or the old /search page's
  // links redirecting here — see App.tsx), run that search immediately.
  useEffect(() => {
    getPublicNamedPeople().then(setNamedPeople).catch((err) => console.error('Failed to load people list', err));
    if (initialQuery || initialPeople.length > 0) {
      void runSearch(initialQuery, new Set(initialPeople));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect hover support
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    setSupportsHover(mq.matches);
    const handler = () => setSupportsHover(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Initial load — render whatever is already cached in IndexedDB immediately
  // (instant, no network wait — this is what makes reopening the Timeline on
  // Android/mobile feel cached rather than re-downloading the whole library
  // every time), then fetch just the newest page from the network in the
  // background and merge it in (new uploads + edits to recent photos). Older
  // pages are only re-fetched as the user scrolls (see the load-more effect
  // below), and each fetched page is persisted to the cache as it arrives, so
  // the offline/instant-render coverage grows every session.
  //
  // Previously this blocked on fetching EVERY page (a `do...while` loop) before
  // rendering anything, which meant a library with thousands of photos across
  // dozens of pages had to finish dozens of sequential round-trips before the
  // very first photo appeared — every single time the page was opened.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const cached = await getCachedTimelinePhotos();
        if (!cancelled && cached.length > 0) {
          setPhotos(cached);
          setLoading(false);
        }
      } catch (err) {
        console.error('Failed to read timeline cache:', err);
      }

      try {
        const data = await getTimeline(200);
        if (!cancelled) {
          setPhotos((prev) => {
            const merged = new Map(prev.map((p) => [p.id, p]));
            for (const photo of data.photos) merged.set(photo.id, photo);
            return Array.from(merged.values()).sort((a, b) => (b.capture_time || '').localeCompare(a.capture_time || ''));
          });
          setNextCursor(data.nextCursor || undefined);
          setLoading(false);
          void cacheTimelinePhotos(data.photos);
        }
        // Load favorites if authenticated (non-blocking)
        if (isAuthenticated) {
          try {
            const favIds = await getUserFavoriteIds();
            if (!cancelled) setUserFavorites(new Set(favIds.map(f => f.photoId)));
          } catch { /* ignore */ }

          try {
            const mine = await getMyPhotos();
            if (!cancelled && mine.linked) {
              setMyPhotoIds(new Set((mine.photos || []).map((p) => p.id)));
              setMyDisplayName(mine.person?.displayName ?? null);
            }
          } catch { /* ignore — the "Just me" toggle simply stays hidden */ }
        }
      } catch (err) {
        console.error('Failed to load timeline:', err);
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Load additional pages as the user scrolls near the bottom sentinel.
  useEffect(() => {
    if (!loadMoreRef.current || !nextCursor) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || loadingMore) return;

          setLoadingMore(true);
          getTimeline(200, nextCursor)
            .then((data) => {
              setPhotos((prev) => [...prev, ...data.photos]);
              setNextCursor(data.nextCursor || undefined);
              void cacheTimelinePhotos(data.photos);
            })
            .catch((err) => {
              console.error('Failed to load more timeline photos:', err);
            })
            .finally(() => setLoadingMore(false));
        });
      },
      { rootMargin: '800px 0px' }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore]);

  // Track active date on scroll (throttled to avoid excessive re-renders)
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        let closestDate: string | null = null;
        let closestDistance = Infinity;

        dateRefs.current.forEach((el, date) => {
          const rect = el.getBoundingClientRect();
          const distance = Math.abs(rect.top - 140);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestDate = date;
          }
        });

        if (closestDate) setActiveDate(closestDate);
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const filteredPhotos = useMemo(() => {
    if (filterMode !== 'me' || !myPhotoIds) return photos;
    return photos.filter((p) => myPhotoIds.has(p.id));
  }, [photos, filterMode, myPhotoIds]);

  const { dates, groups } = useMemo(() => groupByDate(filteredPhotos), [filteredPhotos]);

  // Photo ids per event across the ENTIRE (filtered) timeline, not just one date's slice — used
  // so PhotoDetail's next/prev navigation (see its `fromTimeline`/`timelinePhotoIds` handling)
  // can restrict itself to "every photo of this event that's actually in the timeline" instead
  // of silently falling back to browsing that event's ENTIRE gallery (the previously-reported
  // bug: `fromTimeline` only ever affected the Back button's destination, never what next/prev
  // actually iterated over). A single event's photos in the timeline can span multiple dates
  // (each rendered as a separate JustifiedGrid instance below), so this must be computed from
  // the full `filteredPhotos` list, not from one date-grid's own `eventPhotos` slice.
  const timelinePhotoIdsByEvent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of filteredPhotos) {
      const s = p.event_slug || '';
      const arr = map.get(s) || [];
      arr.push(p.id);
      map.set(s, arr);
    }
    return map;
  }, [filteredPhotos]);

  // Search results are grouped by event (not date) — same approach the old standalone Search
  // page used, since JustifiedGrid needs one `slug` per instance to build preview URLs and
  // results can span many events.
  const searchResultsByEvent = useMemo(() => {
    if (!searchResults) return [];
    const groups = new Map<string, SearchResultPhoto[]>();
    for (const photo of searchResults) {
      const arr = groups.get(photo.event_slug) || [];
      arr.push(photo);
      groups.set(photo.event_slug, arr);
    }
    return Array.from(groups.entries());
  }, [searchResults]);

  const scrollToDate = (date: string) => {
    const el = dateRefs.current.get(date);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 120;
    window.scrollTo({ top: y, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <SEO
        title={`Timeline - ${config.brandName}`}
        description="Browse all photos across events in chronological order"
        url={window.location.origin + '/timeline'}
      />
      <Navbar />
      <div className="max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8 flex-grow w-full">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <Clock className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              Timeline
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2 text-sm sm:text-base">
              All photos across events, sorted by date
            </p>
          </div>

          {myPhotoIds && !hasActiveSearch && (
            <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden self-start">
              <button
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1.5 text-sm font-medium transition ${
                  filterMode === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterMode('me')}
                className={`px-3 py-1.5 text-sm font-medium transition ${
                  filterMode === 'me'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                Just {myDisplayName || 'me'}
              </button>
            </div>
          )}
        </div>

        {/* Search bar + people filter — switches this page into "search mode" in place (see
            hasActiveSearch's doc comment above) instead of navigating to a separate page. */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-3 sm:p-4 mb-6">
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by filename, location, or description…"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition shrink-0"
            >
              Search
            </button>
            {hasActiveSearch && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition shrink-0"
              >
                Clear
              </button>
            )}
          </form>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            {selectedPeople.map((p) => (
              <span
                key={p.id}
                className="flex items-center gap-1 pl-3 pr-1.5 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 text-sm rounded-full"
              >
                {p.name}
                <button
                  onClick={() => handleTogglePerson(p.id)}
                  className="p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition"
                  aria-label={`Remove ${p.name} filter`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
            <button
              onClick={() => setShowPeoplePicker((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition"
            >
              <Users className="w-4 h-4" /> {selectedPeople.length > 0 ? 'Edit people' : 'Filter by people'}
            </button>
          </div>

          {showPeoplePicker && (
            <div className="mt-3 max-w-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
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
                {namedPeople.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 py-2 text-center">No named people yet.</p>
                ) : (
                  namedPeople
                    .filter((p) => p.name.toLowerCase().includes(peopleSearchQuery.trim().toLowerCase()))
                    .map((p) => {
                      const selected = selectedPersonIds.has(p.id);
                      return (
                        <button
                          key={p.id}
                          onClick={() => handleTogglePerson(p.id)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition ${
                            selected
                              ? 'bg-blue-600 text-white'
                              : 'bg-white dark:bg-gray-700/60 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
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

        {hasActiveSearch ? (
          <>
            {searchError && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg mb-4 text-sm">
                {searchError}
              </div>
            )}
            {searching ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-white"></div>
              </div>
            ) : searchResults && searchResults.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-600 dark:text-gray-400">
                  {searchQuery.trim() ? (
                    <>
                      No photos found for "{searchQuery}"
                      {selectedPeople.length > 0 && <> with {selectedPeople.map((p) => p.name).join(' and ')}</>}. Search
                      covers filenames, locations, and AI-generated descriptions (descriptions are added
                      gradually in the background, so very recently uploaded photos may not be searchable
                      by content yet).
                    </>
                  ) : selectedPeople.length > 0 ? (
                    <>
                      No photos found with {selectedPeople.map((p) => p.name).join(' and ')}
                      {selectedPeople.length > 1 ? ' together' : ''}. This only searches photos in
                      events you have access to.
                    </>
                  ) : (
                    'No photos found.'
                  )}
                </p>
              </div>
            ) : searchResults && searchResults.length > 0 ? (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  {searchResults.length} photo{searchResults.length === 1 ? '' : 's'} found
                </p>
                <div ref={densityContainerRef}>
                  {searchResultsByEvent.map(([eventSlug, eventPhotos]) => (
                    <div key={eventSlug} className="mb-6">
                      {searchResultsByEvent.length > 1 && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2 px-1">
                          {eventPhotos[0]?.event_name || eventSlug}
                        </p>
                      )}
                      <JustifiedGrid
                        photos={eventPhotos}
                        slug={eventSlug}
                        targetRowHeight={targetRowHeight}
                        spacing={4}
                        selectedPhotos={new Set()}
                        forceControlsVisible={false}
                        userFavorites={userFavorites}
                        supportsHover={supportsHover}
                        linkState={{
                          fromSearch: true,
                          searchResultIds: eventPhotos.map((p) => p.id),
                          searchUrl: `${window.location.pathname}${window.location.search}`,
                        }}
                        onToggleFavorite={isAuthenticated ? toggleFavorite : undefined}
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
        <MemoriesCarousel />

        {loading ? (
          <TimelineSkeleton />
        ) : filteredPhotos.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-600 dark:text-gray-400">
              {filterMode === 'me' ? 'No photos of you found yet.' : 'No photos found.'}
            </p>
          </div>
        ) : (
          <div className="space-y-7" ref={densityContainerRef}>
            {/* Selection toolbar */}
            {selectedPhotos.size > 0 && (
              <div className="sticky top-20 z-30 bg-blue-600 text-white rounded-xl px-4 py-2.5 flex items-center justify-between shadow-lg">
                <span className="font-medium text-sm">{selectedPhotos.size} selected</span>
                <div className="flex items-center gap-2">
                  <button onClick={handleDownloadSelected} className="px-3 py-1.5 bg-white/20 rounded-lg text-sm hover:bg-white/30 transition flex items-center gap-1.5">
                    <Download className="w-4 h-4" /> Download
                  </button>
                  <button onClick={clearSelection} className="p-1.5 rounded-lg hover:bg-white/20 transition">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
            {dates.map((date) => {
              const datePhotos = groups.get(date) || [];
              const formattedDate = formatDate(date);

              // Group photos by event slug within this date
              const byEvent = new Map<string, Photo[]>();
              for (const p of datePhotos) {
                const s = p.event_slug || '';
                const arr = byEvent.get(s) || [];
                arr.push(p);
                byEvent.set(s, arr);
              }

              return (
                <div
                  key={date}
                  data-date={date}
                  ref={(el) => {
                    if (el) dateRefs.current.set(date, el);
                    else dateRefs.current.delete(date);
                  }}
                >
                  <div className="mb-3 sm:mb-4 sticky top-20 z-20 backdrop-blur-sm bg-white/80 dark:bg-gray-900/70 rounded-xl px-3 py-2 border border-gray-200/70 dark:border-gray-700/70">
                    <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">
                      {formattedDate}
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      {datePhotos.length} {datePhotos.length === 1 ? 'photo' : 'photos'}
                      {byEvent.size > 1 && ` from ${byEvent.size} events`}
                    </p>
                  </div>

                  <LazyDateGroup photoCount={datePhotos.length}>
                    {/* Render a JustifiedGrid per event within this date */}
                    {Array.from(byEvent.entries()).map(([eventSlug, eventPhotos]) => (
                      <div key={eventSlug} className="mb-2">
                        {byEvent.size > 1 && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 px-1">
                            {eventPhotos[0]?.event_name || eventSlug}
                          </p>
                        )}
                        <JustifiedGrid
                          photos={eventPhotos}
                          slug={eventSlug}
                          targetRowHeight={targetRowHeight}
                          spacing={4}
                          selectedPhotos={selectedPhotos}
                          forceControlsVisible={selectedPhotos.size > 0}
                          userFavorites={userFavorites}
                          supportsHover={supportsHover}
                          linkState={{ fromTimeline: true, timelinePhotoIds: timelinePhotoIdsByEvent.get(eventSlug) || [] }}
                          onToggleSelection={togglePhotoSelection}
                          onToggleFavorite={isAuthenticated ? toggleFavorite : undefined}
                        />
                      </div>
                    ))}
                  </LazyDateGroup>
                </div>
              );
            })}

            {/* Sentinel for incrementally loading more pages as the user scrolls down */}
            {nextCursor && (
              <div ref={loadMoreRef} className="h-12 flex items-center justify-center" aria-hidden="true">
                {loadingMore && (
                  <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
            )}

            {/* End of timeline indicator */}
            {!loading && !nextCursor && photos.length > 0 && (
              <div className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                You've reached the end of the timeline
              </div>
            )}

            {/* Vertical date scrubber */}
            <VerticalDateScrubber
              dates={dates}
              activeDate={activeDate}
              onSelectDate={scrollToDate}
            />
          </div>
        )}
          </>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default Timeline;
