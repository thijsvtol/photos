import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Clock, Download, X } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { TimelineSkeleton } from '../components/Skeletons';
import SEO from '../components/SEO';
import JustifiedGrid from '../components/JustifiedGrid';
import DateScrubber from '../components/DateScrubber';
import { useGridDensity } from '../hooks/useGridDensity';
import { usePhotoSelection } from '../hooks/usePhotoSelection';
import { getTimeline, getUserFavoriteIds, toggleFavorite as toggleFavoriteAPI, requestZip, downloadZip } from '../api';
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

const Timeline: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [supportsHover, setSupportsHover] = useState(true);
  const [userFavorites, setUserFavorites] = useState<Set<string>>(new Set());
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

  // Initial load
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const data = await getTimeline(200);
        if (!cancelled) {
          setPhotos(data.photos);
          setNextCursor(data.nextCursor);
        }
        // Load favorites if authenticated
        if (isAuthenticated) {
          try {
            const favIds = await getUserFavoriteIds();
            if (!cancelled) setUserFavorites(new Set(favIds.map(f => f.photoId)));
          } catch { /* ignore */ }
        }
      } catch (err) {
        console.error('Failed to load timeline:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Infinite scroll
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await getTimeline(200, nextCursor);
      setPhotos((prev) => [...prev, ...data.photos]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      console.error('Failed to load more timeline photos:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && nextCursor && !loadingMore) {
          loadMore();
        }
      },
      { rootMargin: '400px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, loadMore]);

  // Track active date on scroll
  useEffect(() => {
    const handleScroll = () => {
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
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [photos]);

  const { dates, groups } = groupByDate(photos);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <SEO
        title={`Timeline - ${config.brandName}`}
        description="Browse all photos across events in chronological order"
        url={window.location.origin + '/timeline'}
      />
      <Navbar />
      <div className="max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8 flex-grow w-full">
        <div className="mb-6">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <Clock className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            Timeline
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2 text-sm sm:text-base">
            All photos across events, sorted by date
          </p>
        </div>

        {loading ? (
          <TimelineSkeleton />
        ) : photos.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-600 dark:text-gray-400">No photos found.</p>
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
              const dateObj = new Date(date);
              const formattedDate = dateObj.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              });

              // Timeline photos may come from different events - group by event_slug for navigation
              // Each photo already has event_slug from the API

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
                        onToggleSelection={togglePhotoSelection}
                        onToggleFavorite={isAuthenticated ? toggleFavorite : undefined}
                      />
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Load more sentinel */}
            {nextCursor && (
              <div ref={loadMoreRef} className="h-12 flex items-center justify-center" aria-hidden="true">
                {loadingMore && (
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 dark:border-blue-400" />
                )}
              </div>
            )}

            {/* Date Scrubber */}
            <DateScrubber
              dateRefs={dateRefs}
              dates={dates}
              activeDate={activeDate}
            />
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default Timeline;
