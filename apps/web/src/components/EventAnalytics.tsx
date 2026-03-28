
import { Link } from 'react-router-dom';
import { Camera, Heart, Eye, ChevronUp, ChevronDown } from 'lucide-react';
import type { EventStats } from '../types';
import { getPreviewUrl } from '../api';

interface EventAnalyticsProps {
  stats: EventStats;
  slug: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export default function EventAnalytics({ stats, slug, isExpanded, onToggleExpand }: EventAnalyticsProps) {
  return (
    <div className="mb-6 sm:mb-8">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow p-4 sm:p-6">
        <button
          onClick={onToggleExpand}
          className="flex items-center justify-between w-full text-left group"
          aria-expanded={isExpanded}
        >
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Camera className="w-5 h-5" />
            <span>Event Analytics</span>
          </h2>
          <div className="p-1 rounded-lg group-hover:bg-gray-100 dark:group-hover:bg-gray-700 transition">
            {isExpanded ? (
              <ChevronUp className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            )}
          </div>
        </button>
        
        {isExpanded && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-4 sm:mt-6">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 sm:p-4 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition">
                <div className="text-xl sm:text-2xl font-bold text-blue-900 dark:text-blue-300">{stats.photoCount}</div>
                <div className="text-xs sm:text-sm text-blue-700 dark:text-blue-400 mt-1">Total Photos</div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 sm:p-4 hover:bg-green-100 dark:hover:bg-green-900/30 transition">
                <div className="text-xl sm:text-2xl font-bold text-green-900 dark:text-green-300">{stats.photosWithGPS}</div>
                <div className="text-xs sm:text-sm text-green-700 dark:text-green-400 mt-1">With GPS Data</div>
              </div>
              <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3 sm:p-4 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition">
                <div className="text-xl sm:text-2xl font-bold text-yellow-900 dark:text-yellow-300">{stats.featuredCount}</div>
                <div className="text-xs sm:text-sm text-yellow-700 dark:text-yellow-400 mt-1">Featured Photos</div>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 sm:p-4 hover:bg-red-100 dark:hover:bg-red-900/30 transition">
                <div className="text-xl sm:text-2xl font-bold text-red-900 dark:text-red-300">{stats.totalFavorites}</div>
                <div className="text-xs sm:text-sm text-red-700 dark:text-red-400 mt-1">Total Favorites</div>
              </div>
            </div>

            {stats.topFavorites && stats.topFavorites.length > 0 && (
              <div className="mb-4 sm:mb-6">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                  <Heart className="w-5 h-5 text-red-500" />
                  <span>Top Favorited Photos</span>
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
                  {stats.topFavorites.map((photo) => (
                    <div key={photo.id} className="relative group overflow-hidden rounded-lg">
                      <img
                        src={getPreviewUrl(slug, photo.id, photo.file_type, photo.cache_version)}
                        alt={photo.original_filename}
                        className="w-full aspect-square object-cover rounded-lg shadow-sm group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent text-white px-2 py-2 text-xs flex items-center gap-1">
                        <Heart className="w-3 h-3 fill-red-500 text-red-500" />
                        <span>{photo.favorites_count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {stats.cameraModels && stats.cameraModels.length > 0 && (
              <div className="mb-4 sm:mb-6">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                  <Camera className="w-5 h-5" />
                  <span>Cameras Used</span>
                </h3>
                <div className="flex flex-wrap gap-2">
                  {stats.cameraModels.map((camera, index) => (
                    <span
                      key={index}
                      className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs sm:text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition"
                    >
                      {camera.camera_model} ({camera.count})
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 sm:mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <Link
                to={`/events/${slug}`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-sm hover:shadow"
              >
                <Eye className="w-4 h-4" />
                <span>View Gallery</span>
              </Link>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-2">
                View the gallery as admin to manage photos (delete, mark as featured)
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
