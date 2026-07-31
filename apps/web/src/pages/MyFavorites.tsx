import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Download, LogIn } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { GallerySkeleton } from '../components/Skeletons';
import JustifiedGrid from '../components/JustifiedGrid';
import VerticalDateScrubber from '../components/VerticalDateScrubber';
import SEO from '../components/SEO';
import { useRefresh } from '../contexts/RefreshContext';
import { useGridDensity } from '../hooks/useGridDensity';
import { getUserFavorites, removeFavorite as removeFavoriteAPI, toggleFavorite as toggleFavoriteAPI, requestZip, downloadZip, type FavoritePhoto } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { config } from '../config';
import { useToast } from '../components/Toast';
import { haptics } from '../utils/haptics';

/** Group photos by date (YYYY-MM-DD from capture_time), newest first */
function groupByDate(photos: FavoritePhoto[]): { dates: string[]; groups: Map<string, FavoritePhoto[]> } {
  const groups = new Map<string, FavoritePhoto[]>();
  for (const photo of photos) {
    const date = photo.capture_time?.slice(0, 10) || 'Unknown';
    const arr = groups.get(date) || [];
    arr.push(photo);
    groups.set(date, arr);
  }
  const dates = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));
  return { dates, groups };
}

const MyFavorites: React.FC = () => {
  const { isAuthenticated, loading: authLoading, login } = useAuth();
  const { registerRefreshHandler, unregisterRefreshHandler } = useRefresh();
  const toast = useToast();
  const [photos, setPhotos] = useState<FavoritePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [supportsHover, setSupportsHover] = useState(true);
  const dateRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const { targetRowHeight, containerRef: densityContainerRef } = useGridDensity();

  // All favorites are favorited by definition
  const userFavorites = useMemo(() => new Set(photos.map(p => p.id)), [photos]);

  // Group once and reuse for both rendering and navigation state, so the
  // next/prev order passed to PhotoDetail exactly matches what's on screen
  // (date-desc, then grouped by event within each date).
  const { dates, groups } = useMemo(() => groupByDate(photos), [photos]);

  const scrollToDate = (date: string) => {
    const el = dateRefs.current.get(date);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 120;
    window.scrollTo({ top: y, behavior: 'smooth' });
  };

  // Navigation state passed to PhotoDetail so swiping next/prev stays within
  // the full favorites list (across all events/dates) instead of falling back
  // to the clicked photo's parent event.
  const favoritesLinkState = useMemo(() => {
    const ordered: FavoritePhoto[] = [];
    for (const date of dates) {
      const datePhotos = groups.get(date) || [];
      const byEvent = new Map<string, FavoritePhoto[]>();
      for (const p of datePhotos) {
        const arr = byEvent.get(p.event_slug) || [];
        arr.push(p);
        byEvent.set(p.event_slug, arr);
      }
      for (const eventPhotos of byEvent.values()) {
        ordered.push(...eventPhotos);
      }
    }
    return {
      fromFavorites: true,
      favoritePhotos: ordered.map(p => ({ id: p.id, slug: p.event_slug })),
    };
  }, [dates, groups]);

  // Detect hover support
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    setSupportsHover(mq.matches);
    const handler = () => setSupportsHover(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!authLoading) {
      if (isAuthenticated) {
        loadFavorites();
      } else {
        setLoading(false);
      }
    }
  }, [isAuthenticated, authLoading]);

  // Register refresh handler
  useEffect(() => {
    if (isAuthenticated) {
      registerRefreshHandler(handleRefresh);
      return () => unregisterRefreshHandler();
    }
  }, [isAuthenticated]);

  // Track active date on scroll (for DateScrubber)
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

  const loadFavorites = async () => {
    try {
      setLoading(true);
      const favorites = await getUserFavorites();
      setPhotos(favorites);
      setError(null);
    } catch (err) {
      setError('Failed to load your favorites');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    await loadFavorites();
  };

  const toggleFavorite = async (photoId: string, isFavorited: boolean) => {
    if (isFavorited) {
      // Unfavorite — remove from list
      try {
        await removeFavoriteAPI(photoId);
        await haptics.light();
        setPhotos(prev => prev.filter(p => p.id !== photoId));
      } catch {
        toast.showError('Failed to remove from favorites');
      }
    } else {
      try {
        await toggleFavoriteAPI(photoId, false);
        await haptics.light();
      } catch {
        toast.showError('Failed to update favorite');
      }
    }
  };

  const downloadAllFavorites = async () => {
    if (photos.length === 0) {
      toast.showInfo('No favorites to download');
      return;
    }

    if (photos.length > 50) {
      toast.showInfo('Maximum 50 photos can be downloaded at once. Please remove some favorites first.');
      return;
    }

    setDownloading(true);
    try {
      // Group photos by event
      const photosByEvent = photos.reduce((acc, photo) => {
        if (!acc[photo.event_slug]) {
          acc[photo.event_slug] = [];
        }
        acc[photo.event_slug].push(photo.id);
        return acc;
      }, {} as Record<string, string[]>);

      const timestamp = new Date().toISOString().split('T')[0];

      // Download ZIP for each event
      for (const [slug, photoIds] of Object.entries(photosByEvent)) {
        const zipBlob = await requestZip(slug, photoIds);
        
        // Download using platform-specific method
        await downloadZip(zipBlob, `favorites_${slug}_${timestamp}.zip`);
        
        // Small delay between downloads to avoid issues
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      await haptics.success();
      toast.showSuccess(`Downloaded ${Object.keys(photosByEvent).length} ZIP file(s)`);
    } catch {
      await haptics.error();
      toast.showError('Failed to download some files. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  // Show login prompt if not authenticated
  if (!authLoading && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
        <SEO
          title={`My Favorites - ${config.appName}`}
          description="Your personal collection of favorite photos from various events. Login required."
          url={`${window.location.origin}/favorites`}
        />
        <Navbar />
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-8 flex-grow w-full">
          <div className="text-center py-16 px-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg max-w-2xl mx-auto">
            <Heart className="w-20 h-20 text-red-500 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Login Required</h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg mb-8">
              You need to be logged in to view and manage your favorites.
            </p>
            <button
              onClick={login}
              className="inline-flex items-center gap-2 px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 active:scale-95 transition-all font-semibold shadow-md"
            >
              <LogIn className="w-5 h-5" />
              Login with Cloudflare Access
            </button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <SEO
        title={`My Favorites - ${config.appName}`}
        description="Your personal collection of favorite photos from various events."
        url={`${window.location.origin}/favorites`}
      />
      <Navbar />
      <div className="max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8 flex-grow w-full">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Heart className="w-8 h-8 fill-red-500 text-red-500" />
              My Favorites
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              {photos.length} photo{photos.length !== 1 ? 's' : ''} you've favorited
            </p>
          </div>
          {photos.length > 0 && (
            <button
              onClick={downloadAllFavorites}
              disabled={downloading}
              className="w-full sm:w-auto px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 active:scale-95 transition-all disabled:bg-gray-400 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center justify-center gap-2 font-semibold shadow-md"
            >
              <Download className="w-5 h-5" />
              {downloading ? 'Downloading...' : 'Download All'}
            </button>
          )}
        </div>

        {loading && (
          <GallerySkeleton />
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {!loading && !error && photos.length === 0 && (
          <div className="text-center py-16 px-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
            <Heart className="w-20 h-20 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-gray-900 dark:text-white text-xl font-semibold mb-2">No favorites yet</p>
            <p className="text-gray-500 dark:text-gray-400 text-base mb-8 max-w-md mx-auto">Click the heart icon on photos to add them to your favorites</p>
            <Link
              to="/events"
              className="inline-block px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 active:scale-95 transition-all font-semibold shadow-md"
            >
              Browse Photos
            </Link>
          </div>
        )}

        {!loading && !error && photos.length > 0 && (
          <div className="space-y-7" ref={densityContainerRef}>
            {dates.map((date) => {
              const datePhotos = groups.get(date) || [];
              const formattedDate = date === 'Unknown'
                ? 'Unknown Date'
                : new Date(date).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  });

              // Group by event slug within each date (JustifiedGrid needs a slug for URL building)
              const byEvent = new Map<string, FavoritePhoto[]>();
              for (const p of datePhotos) {
                const arr = byEvent.get(p.event_slug) || [];
                arr.push(p);
                byEvent.set(p.event_slug, arr);
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
                        selectedPhotos={new Set()}
                        forceControlsVisible={false}
                        userFavorites={userFavorites}
                        supportsHover={supportsHover}
                        onToggleFavorite={toggleFavorite}
                        linkState={favoritesLinkState}
                      />
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Vertical date scrubber */}
            {dates.length > 1 && (
              <VerticalDateScrubber
                dates={dates}
                activeDate={activeDate}
                onSelectDate={scrollToDate}
              />
            )}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default MyFavorites;
