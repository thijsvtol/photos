import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { getMemories, getPreviewUrl, type MemoryYear } from '../api';

/**
 * "On this day" carousel — shows photos captured on today's month/day in
 * previous years, grouped by year. Pure SQL on the backend (no AI), mirrors
 * the classic Google Photos / Facebook "memories" feature. Renders nothing
 * if there are no memories for today, so it's safe to always mount.
 */
export default function MemoriesCarousel() {
  const [years, setYears] = useState<MemoryYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeYearIndex, setActiveYearIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getMemories(8)
      .then((data) => {
        if (!cancelled) setYears(data);
      })
      .catch((err) => console.error('Failed to load memories:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || years.length === 0) {
    return null;
  }

  const activeYear = years[Math.min(activeYearIndex, years.length - 1)];
  const yearsAgo = new Date().getFullYear() - activeYear.year;

  return (
    <div className="mb-8 bg-white dark:bg-gray-800 rounded-xl shadow p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          On This Day — {yearsAgo} year{yearsAgo === 1 ? '' : 's'} ago
        </h2>
        {years.length > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveYearIndex((i) => Math.max(0, i - 1))}
              disabled={activeYearIndex === 0}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
              aria-label="Previous year"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400 w-20 text-center">{activeYear.year}</span>
            <button
              onClick={() => setActiveYearIndex((i) => Math.min(years.length - 1, i + 1))}
              disabled={activeYearIndex === years.length - 1}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30"
              aria-label="Next year"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {activeYear.photos.map((photo) => (
          <Link
            key={photo.id}
            to={`/p/${photo.event_slug}/${photo.id}`}
            className="flex-shrink-0 w-32 sm:w-40 rounded-lg overflow-hidden shadow hover:shadow-lg transition-shadow"
          >
            <div className="aspect-square bg-gray-100 dark:bg-gray-700">
              <img
                src={getPreviewUrl(photo.event_slug, photo.id, photo.file_type, photo.cache_version)}
                alt={photo.original_filename}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 truncate px-1 py-1">{photo.event_name}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
