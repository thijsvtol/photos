import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Star, Check } from 'lucide-react';
import ProgressiveImage from './ProgressiveImage';
import { getPreviewUrl, downloadOriginal, downloadSmall } from '../api';
import type { Photo } from '../types';

interface PhotoCardProps {
  photo: Photo;
  slug: string;
  albumMode?: boolean;
  forceControlsVisible?: boolean;
  // Optional props for different contexts
  fromFavorites?: boolean;
  favoritePhotos?: Array<{ id: string; slug: string }>;
  sortBy?: string;
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
  sortBy,
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
  albumMode = false,
  forceControlsVisible = false,
}) => {
  const isVideo = photo.file_type === 'video/mp4';
  const [supportsHover, setSupportsHover] = useState(true);
  const [touchControlsVisible, setTouchControlsVisible] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    const updateSupportsHover = () => setSupportsHover(mediaQuery.matches);
    updateSupportsHover();

    mediaQuery.addEventListener('change', updateSupportsHover);
    return () => mediaQuery.removeEventListener('change', updateSupportsHover);
  }, []);

  useEffect(() => {
    if (supportsHover && touchControlsVisible) {
      setTouchControlsVisible(false);
    }
  }, [supportsHover, touchControlsVisible]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = () => {
    if (supportsHover) return;
    clearLongPressTimer();
    longPressTimerRef.current = setTimeout(() => {
      setTouchControlsVisible(true);
      suppressNextClickRef.current = true;
      longPressTimerRef.current = null;
    }, 380);
  };

  const controlsRevealClass = forceControlsVisible
    ? 'opacity-100 pointer-events-auto'
    : supportsHover
      ? 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto'
      : touchControlsVisible
        ? 'opacity-100 pointer-events-auto'
        : 'opacity-0 pointer-events-none';

  if (albumMode) {
    return (
      <div className="mb-2 sm:mb-3 relative group">
        <Link
          to={`/p/${slug}/${photo.id}`}
          state={fromFavorites && favoritePhotos ? {
            fromFavorites: true,
            favoritePhotos,
            sortBy
          } : sortBy ? {
            sortBy
          } : undefined}
          className="block relative overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800"
          style={{ aspectRatio: photo.width && photo.height ? `${photo.width} / ${photo.height}` : '4 / 3' }}
          onClick={(e) => {
            if (!supportsHover && suppressNextClickRef.current) {
              e.preventDefault();
              e.stopPropagation();
              suppressNextClickRef.current = false;
              return;
            }
            sessionStorage.setItem(`gallery_scroll_${slug}`, window.scrollY.toString());
          }}
          onTouchStart={startLongPress}
          onTouchEnd={clearLongPressTimer}
          onTouchMove={clearLongPressTimer}
          onTouchCancel={clearLongPressTimer}
        >
          {isVideo ? (
            <video
              src={getPreviewUrl(slug, photo.id, photo.file_type)}
              className="w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.02]"
              muted
              playsInline
              onMouseEnter={(e) => e.currentTarget.play()}
              onMouseLeave={(e) => {
                e.currentTarget.pause();
                e.currentTarget.currentTime = 0;
              }}
            />
          ) : (
            <ProgressiveImage
              src={getPreviewUrl(slug, photo.id, photo.file_type)}
              blurDataUrl={photo.blur_placeholder}
              alt={photo.original_filename}
              className="w-full h-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.02]"
              loading="lazy"
            />
          )}

          <div className={`absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/55 to-transparent pointer-events-none transition-opacity duration-150 ${controlsRevealClass}`} />

          {showSelection && onToggleSelection && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleSelection(photo.id);
              }}
              className={`absolute top-2 left-2 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all duration-150 ${
                isSelected
                  ? 'bg-blue-600 border-blue-600 text-white opacity-100 pointer-events-auto'
                  : `bg-black/40 border-white/70 text-transparent hover:text-white ${controlsRevealClass}`
              }`}
              aria-label={isSelected ? 'Deselect photo' : 'Select photo'}
            >
              <Check className="w-4 h-4" />
            </button>
          )}

          {showAddToFavorites && onToggleFavorite && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite(photo.id, userFavorites.has(photo.id));
              }}
              className={`absolute top-2 right-2 bg-black/45 backdrop-blur-sm text-white p-1.5 rounded-full transition-all duration-150 hover:bg-black/60 ${controlsRevealClass}`}
              title={userFavorites.has(photo.id) ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart className={`w-4 h-4 ${userFavorites.has(photo.id) ? 'fill-red-500 text-red-500' : ''}`} />
            </button>
          )}

          {showFeatured && onToggleFeatured && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFeatured(photo.id, photo.is_featured);
              }}
              className={`absolute ${showAddToFavorites ? 'right-12' : 'right-2'} top-2 backdrop-blur-sm text-white p-1.5 rounded-full transition-all duration-150 ${
                photo.is_featured ? 'bg-yellow-500/90 hover:bg-yellow-500' : 'bg-black/45 hover:bg-black/60'
              } ${controlsRevealClass}`}
              title={photo.is_featured ? 'Remove from featured' : 'Mark as featured'}
            >
              <Star className={`w-4 h-4 ${photo.is_featured ? 'fill-white' : ''}`} />
            </button>
          )}

          <div className={`absolute left-3 right-3 bottom-2 text-white transition-opacity duration-150 ${controlsRevealClass}`}>
            <p className="text-[11px] sm:text-xs truncate font-medium">{photo.original_filename}</p>
          </div>
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-2 sm:mb-4 relative group bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow-md hover:shadow-lg active:scale-[0.98] transition-all">
      <Link
        to={`/p/${slug}/${photo.id}`}
        state={fromFavorites && favoritePhotos ? {
          fromFavorites: true,
          favoritePhotos,
          sortBy
        } : sortBy ? {
          sortBy
        } : undefined}
        className="block relative aspect-[16/9] overflow-hidden"
        onClick={() => {
          // Save current scroll position before navigating
          sessionStorage.setItem(`gallery_scroll_${slug}`, window.scrollY.toString());
        }}
      >
        {isVideo ? (
          <video
            src={getPreviewUrl(slug, photo.id, photo.file_type)}
            className="w-full h-full object-cover object-center"
            muted
            playsInline
            onMouseEnter={(e) => e.currentTarget.play()}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }}
          />
        ) : (
          <ProgressiveImage
            src={getPreviewUrl(slug, photo.id, photo.file_type)}
            blurDataUrl={photo.blur_placeholder}
            alt={photo.original_filename}
            className="w-full h-full object-cover object-center"
            loading="lazy"
          />
        )}
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
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 active:bg-gray-400 dark:active:bg-gray-500'
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
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 active:bg-gray-400 dark:active:bg-gray-500'
                  }`}
                  title={userFavorites.has(photo.id) ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Heart className={`w-3 h-3 sm:w-4 sm:h-4 ${userFavorites.has(photo.id) ? 'fill-white' : ''}`} />
                  {!showSelection && <span>{userFavorites.has(photo.id) ? 'Favorited' : 'Favorite'}</span>}
                </button>
              )}
              {showFeatured && onToggleFeatured && (
                <button
                  onClick={() => onToggleFeatured(photo.id, photo.is_featured)}
                  className={`${showSelection || showAddToFavorites ? 'px-2 py-2' : 'flex-1 px-3 py-2'} rounded-lg text-xs sm:text-sm flex items-center ${showSelection || showAddToFavorites ? 'gap-1' : 'justify-center gap-1.5'} font-medium transition-all active:scale-95 ${
                    photo.is_featured
                      ? 'bg-yellow-500 text-white shadow-sm'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 active:bg-gray-400 dark:active:bg-gray-500'
                  }`}
                  title={photo.is_featured ? 'Remove from featured' : 'Mark as featured'}
                >
                  <Star className={`w-3 h-3 sm:w-4 sm:h-4 ${photo.is_featured ? 'fill-white' : ''}`} />
                  {!(showSelection || showAddToFavorites) && <span>{photo.is_featured ? 'Featured' : 'Feature'}</span>}
                </button>
              )}
            </div>
          )}
          
          {/* Download buttons row */}
          <div className="flex gap-1 sm:gap-2">
            <button
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  await downloadOriginal(slug, photo.id);
                } catch (error) {
                  console.error('Download failed:', error);
                }
              }}
              className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs sm:text-sm hover:bg-blue-700 active:bg-blue-800 active:scale-95 transition-all text-center flex items-center justify-center gap-1.5 font-medium shadow-sm"
            >
              <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span className="hidden sm:inline">Original</span>
              <span className="sm:hidden">Full</span>
            </button>
            {!isVideo && (
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    await downloadSmall(slug, photo.id);
                  } catch (error) {
                    console.error('Download failed:', error);
                  }
                }}
                className="flex-1 px-3 py-2 bg-purple-600 text-white rounded-lg text-xs sm:text-sm hover:bg-purple-700 active:bg-purple-800 active:scale-95 transition-all text-center flex items-center justify-center gap-1.5 font-medium shadow-sm"
              >
                <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Small
              </button>
            )}
            {/* Remove from favorites button in same row */}
            {showRemoveFavorite && onRemoveFavorite && (
              <button
                onClick={() => onRemoveFavorite(photo.id)}
                className="px-2 py-2 text-red-500 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 active:bg-red-200 dark:active:bg-red-900/40 rounded-lg transition-all active:scale-95"
                title="Remove from favorites"
              >
                <Heart className="w-4 h-4 fill-current" />
              </button>
            )}
          </div>
        </div>
        {/* Photo info */}
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {photo.original_filename}
        </p>
        {photo.capture_time && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {new Date(photo.capture_time).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
};

export default PhotoCard;
