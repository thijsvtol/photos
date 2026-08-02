import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Clock, Download, X } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { TimelineSkeleton } from '../components/Skeletons';
import SEO from '../components/SEO';
import JustifiedGrid from '../components/JustifiedGrid';
import VerticalDateScrubber from '../components/VerticalDateScrubber';
import MemoriesCarousel from '../components/MemoriesCarousel';
import { useGridDensity } from '../hooks/useGridDensity';
import { usePhotoSelection } from '../hooks/usePhotoSelection';
import { getTimeline, getUserFavoriteIds, toggleFavorite as toggleFavoriteAPI, requestZip, downloadZip, getMyPhotos } from '../api';
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

          {myPhotoIds && (
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
                          linkState={{ fromTimeline: true }}
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
      </div>
      <Footer />
    </div>
  );
};

export default Timeline;
