import React from 'react';
import { Link } from 'react-router-dom';
import { Heart, Star } from 'lucide-react';
import ProgressiveImage from './ProgressiveImage';
import { getPreviewUrl, getOriginalUrl } from '../api';
import type { Photo } from '../types';

interface PhotoCardProps {
  photo: Photo;
  slug: string;
  // Optional props for different contexts
  fromFavorites?: boolean;
  favoritePhotos?: Array<{ id: string; slug: string }>;
  showSelection?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (photoId: string) => void;
  showAddToFavorites?: boolean;
  onToggleFavorite?: (photoId: string, isFavorited: boolean) => void;
  showFeatured?: boolean;
  onToggleFeatured?: (photoId: string, currentStatus: boolean) => void;
  showRemoveFavorite?: boolean;
  onRemoveFavorite?: (photoId: string) => void;
  userFavorites?: Set<string>;
}

const PhotoCard: React.FC<PhotoCardProps> = ({
  photo,
  slug,
  fromFavorites = false,
  favoritePhotos,
  showSelection = false,
  isSelected = false,
  onToggleSelection,
  showAddToFavorites = false,
  onToggleFavorite,
  showFeatured = false,
  onToggleFeatured,
  showRemoveFavorite = false,
  onRemoveFavorite,
  userFavorites = new Set(),
}) => {
  return (
    <div className="mb-2 sm:mb-4 relative group bg-white rounded-xl overflow-hidden shadow-md hover:shadow-lg active:scale-[0.98] transition-all">
      <Link
        to={`/p/${slug}/${photo.id}`}
        state={fromFavorites && favoritePhotos ? {
          fromFavorites: true,
          favoritePhotos
        } : undefined}
        className="block relative aspect-[16/9] overflow-hidden"
      >
        <ProgressiveImage
          src={getPreviewUrl(slug, photo.id)}
          blurDataUrl={photo.blur_placeholder}
          alt={photo.original_filename}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {/* User favorite indicator */}
        {userFavorites.has(photo.id) && (
          <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-sm text-white p-1.5 rounded-full">
            <Heart className="w-4 h-4 fill-red-500 text-red-500" />
          </div>
        )}
        {/* Featured photo indicator */}
        {!!photo.is_featured && (
          <div className="absolute top-2 left-2 bg-yellow-500/90 backdrop-blur-sm text-white p-1.5 rounded-full">
            <Star className="w-4 h-4 fill-white" />
          </div>
        )}
      </Link>
      <div className="p-3">
        {/* Action buttons */}
        <div className="flex flex-col gap-2 mb-2">
          {/* Selection and Featured row */}
          {(showSelection || showAddToFavorites || showFeatured) && (
            <div className="flex gap-1 sm:gap-2">
              {showSelection && onToggleSelection && (
                <button
                  onClick={() => onToggleSelection(photo.id)}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all active:scale-95 ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300 active:bg-gray-400'
                  }`}
                >
                  {isSelected ? '✓ Selected' : 'Select'}
                </button>
              )}
              {showAddToFavorites && onToggleFavorite && (
                <button
                  onClick={() => onToggleFavorite(photo.id, userFavorites.has(photo.id))}
                  className={`${showSelection ? 'px-2 py-2' : 'flex-1 px-3 py-2'} rounded-lg text-xs sm:text-sm flex items-center ${showSelection ? 'gap-1' : 'justify-center gap-1.5'} font-medium transition-all active:scale-95 ${
                    userFavorites.has(photo.id)
                      ? 'bg-red-500 text-white shadow-sm'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300 active:bg-gray-400'
                  }`}
                  title={userFavorites.has(photo.id) ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Heart className={`w-3 h-3 sm:w-4 sm:h-4 ${userFavorites.has(photo.id) ? 'fill-white' : ''}`} />
                  {!showSelection && <span>{userFavorites.has(photo.id) ? 'Favorited' : 'Favorite'}</span>}
                </button>
              )}
              {showFeatured && onToggleFeatured && (
                <button
                  onClick={() => onToggleFeatured(photo.id, photo.is_featured || false)}
                  className={`px-2 py-2 rounded-lg text-xs sm:text-sm flex items-center gap-1 transition-all active:scale-95 ${
                    photo.is_featured
                      ? 'bg-yellow-500 text-white shadow-sm'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300 active:bg-gray-400'
                  }`}
                  title={photo.is_featured ? 'Remove from featured' : 'Mark as featured'}
                >
                  <Star className={`w-3 h-3 sm:w-4 sm:h-4 ${photo.is_featured ? 'fill-white' : ''}`} />
                </button>
              )}
            </div>
          )}
          {/* Download buttons row */}
          <div className="flex gap-1 sm:gap-2">
            <a
              href={getOriginalUrl(slug, photo.id)}
              download
              className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs sm:text-sm hover:bg-blue-700 active:bg-blue-800 active:scale-95 transition-all text-center flex items-center justify-center gap-1.5 font-medium shadow-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span className="hidden sm:inline">Original</span>
              <span className="sm:hidden">Full</span>
            </a>
            <a
              href={getPreviewUrl(slug, photo.id)}
              download
              className="flex-1 px-3 py-2 bg-purple-600 text-white rounded-lg text-xs sm:text-sm hover:bg-purple-700 active:bg-purple-800 active:scale-95 transition-all text-center flex items-center justify-center gap-1.5 font-medium shadow-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Small
            </a>
            {/* Remove from favorites button in same row */}
            {showRemoveFavorite && onRemoveFavorite && (
              <button
                onClick={() => onRemoveFavorite(photo.id)}
                className="px-2 py-2 text-red-500 bg-red-50 hover:bg-red-100 active:bg-red-200 rounded-lg transition-all active:scale-95"
                title="Remove from favorites"
              >
                <Heart className="w-4 h-4 fill-current" />
              </button>
            )}
          </div>
        </div>
        {/* Photo info */}
        <p className="text-xs text-gray-500 truncate">
          {photo.original_filename}
        </p>
        {photo.capture_time && (
          <p className="text-xs text-gray-400 mt-1">
            {new Date(photo.capture_time).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
};

export default PhotoCard;
