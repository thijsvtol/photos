import React, { useMemo } from 'react';
import { RowsPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/rows.css';
import { Link } from 'react-router-dom';
import { Heart, Star, Check } from 'lucide-react';
import ProgressiveImage from './ProgressiveImage';
import ProgressiveVideo from './ProgressiveVideo';
import { getPreviewUrl, getVideoPosterUrl } from '../api';
import type { Photo } from '../types';

interface JustifiedGridProps {
  photos: Photo[];
  slug: string;
  targetRowHeight: number;
  spacing?: number;
  selectedPhotos: Set<string>;
  forceControlsVisible: boolean;
  userFavorites: Set<string>;
  supportsHover: boolean;
  sortBy?: string;
  linkState?: Record<string, unknown>;
  onToggleSelection?: (photoId: string) => void;
  onToggleFavorite?: (photoId: string, isFavorited: boolean) => void;
  onToggleFeatured?: (photoId: string, currentStatus: boolean) => void;
  showFeatured?: boolean;
  onLongPress?: () => void;
}

// Extended photo type for react-photo-album
interface AlbumPhoto {
  src: string;
  width: number;
  height: number;
  key: string;
  // Our custom data
  photo: Photo;
}

/** Number of leading photos (top of the grid, typically the first row or two) that get
 *  fetchPriority="high" and skip the near-viewport intersection delay, since the user is
 *  looking at them the moment the page loads. */
const PRIORITY_PHOTO_COUNT = 8;

const JustifiedGridInner: React.FC<JustifiedGridProps> = ({
  photos,
  slug,
  targetRowHeight,
  spacing = 8,
  selectedPhotos,
  forceControlsVisible,
  userFavorites,
  supportsHover,
  sortBy,
  linkState,
  onToggleSelection,
  onToggleFavorite,
  onToggleFeatured,
  showFeatured = false,
}) => {
  const albumPhotos: AlbumPhoto[] = useMemo(
    () =>
      photos
        .map((photo) => ({
          src: getPreviewUrl(slug, photo.id, photo.file_type, photo.cache_version),
          width: photo.width || 1600,
          height: photo.height || 1200,
          key: photo.id,
          photo,
        })),
    [photos, slug]
  );

  if (albumPhotos.length === 0) return null;

  return (
    <RowsPhotoAlbum
      photos={albumPhotos}
      targetRowHeight={targetRowHeight}
      spacing={spacing}
      // singleRowMaxHeight caps how much taller a lone/last-row photo can get relative to the
      // rest of the grid (a row with fewer photos than fit stretches to fill the row width,
      // which otherwise inflates its height well past its neighbors) — kept close to 1x so
      // photos stay visually aligned with the rows around them instead of one row suddenly
      // looming much larger.
      rowConstraints={{ minPhotos: 1, maxPhotos: 6, singleRowMaxHeight: targetRowHeight * 1.2 }}
      render={{
        wrapper: ({ children, style, className }, { photo: albumPhoto }) => {
          const photo = (albumPhoto as AlbumPhoto).photo;
          return (
            <PhotoOverlay
              key={photo.id}
              photo={photo}
              slug={slug}
              style={style}
              wrapperClassName={className}
              isSelected={selectedPhotos.has(photo.id)}
              isFavorited={userFavorites.has(photo.id)}
              forceControlsVisible={forceControlsVisible}
              supportsHover={supportsHover}
              sortBy={sortBy}
              linkState={linkState}
              onToggleSelection={onToggleSelection}
              onToggleFavorite={onToggleFavorite}
              onToggleFeatured={onToggleFeatured}
              showFeatured={showFeatured}
            >
              {children}
            </PhotoOverlay>
          );
        },
        image: (props, { photo: albumPhoto, index }) => {
          const photo = (albumPhoto as AlbumPhoto).photo;
          const isVideo = photo.file_type === 'video/mp4';
          if (isVideo) {
            return (
              <ProgressiveVideo
                src={props.src}
                poster={photo.blur_placeholder}
                posterUrl={getVideoPosterUrl(slug, photo.id, photo.cache_version)}
                className="w-full h-full object-cover"
              />
            );
          }
          return (
            <ProgressiveImage
              src={props.src}
              blurDataUrl={photo.blur_placeholder}
              alt={photo.original_filename}
              className="w-full h-full object-cover"
              loading="lazy"
              priority={index < PRIORITY_PHOTO_COUNT}
            />
          );
        },
      }}
    />
  );
};

const JustifiedGrid = React.memo(JustifiedGridInner);

/** Overlay wrapper for each photo in the justified grid */
interface PhotoOverlayProps {
  photo: Photo;
  slug: string;
  style?: React.CSSProperties;
  /** The `className` react-photo-album computes for this wrapper (e.g.
   *  `react-photo-album--photo`) — MUST be applied to our custom wrapper div, since the
   *  library's actual per-photo width/padding/spacing come from CSS rules keyed on that class
   *  reading CSS custom properties set in `style` (see node_modules/react-photo-album/dist/
   *  styles/rows.css), not from any raw pixel value in `style` itself. Dropping this class
   *  (as an earlier version of this component did) left every photo with no computed width at
   *  all, causing them to render with no visible gap between them regardless of the `spacing`
   *  prop passed to <RowsPhotoAlbum>. */
  wrapperClassName?: string;
  isSelected: boolean;
  isFavorited: boolean;
  forceControlsVisible: boolean;
  supportsHover: boolean;
  sortBy?: string;
  linkState?: Record<string, unknown>;
  onToggleSelection?: (photoId: string) => void;
  onToggleFavorite?: (photoId: string, isFavorited: boolean) => void;
  onToggleFeatured?: (photoId: string, currentStatus: boolean) => void;
  showFeatured: boolean;
  children: React.ReactNode;
}

const PhotoOverlayInner: React.FC<PhotoOverlayProps> = ({
  photo,
  slug,
  style,
  wrapperClassName,
  isSelected,
  isFavorited,
  forceControlsVisible,
  supportsHover,
  sortBy,
  linkState,
  onToggleSelection,
  onToggleFavorite,
  onToggleFeatured,
  showFeatured,
  children,
}) => {
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = React.useRef(false);
  const [touchControlsVisible, setTouchControlsVisible] = React.useState(false);

  // Reset touchControlsVisible when global selection mode changes
  React.useEffect(() => {
    if (forceControlsVisible) {
      setTouchControlsVisible(false);
    }
  }, [forceControlsVisible]);

  // Auto-hide touch controls after 4 seconds if user doesn't interact
  React.useEffect(() => {
    if (!touchControlsVisible) return;
    const timer = setTimeout(() => setTouchControlsVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [touchControlsVisible]);

  React.useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
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
      // Auto-reset suppress after a short window so it can't get stranded
      setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 600);
    }, 380);
  };

  const controlsRevealClass = forceControlsVisible
    ? 'opacity-100 pointer-events-auto'
    : supportsHover
      ? 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
      : touchControlsVisible
        ? 'opacity-100 pointer-events-auto'
        : 'opacity-0 pointer-events-none';

  return (
    <div
      data-photo-card="true"
      data-photo-id={photo.id}
      className={`relative group overflow-hidden rounded-lg md:rounded-xl ring-1 ring-black/5 dark:ring-white/5 ${wrapperClassName || ''}`}
      style={style}
    >
      <Link
        to={`/p/${slug}/${photo.id}`}
        state={{ ...linkState, ...(sortBy ? { sortBy } : undefined) }}
        className="block w-full h-full"
        onClick={(e) => {
          if (!supportsHover && suppressNextClickRef.current) {
            e.preventDefault();
            e.stopPropagation();
            suppressNextClickRef.current = false;
            return;
          }
          // In selection mode on touch devices, tap toggles selection
          // instead of navigating (small checkbox is hard to hit).
          if (!supportsHover && forceControlsVisible && onToggleSelection) {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelection(photo.id);
            return;
          }
          // Reset individual card controls when navigating away
          setTouchControlsVisible(false);
          // Store scroll position and photo ID for back navigation
          sessionStorage.setItem(`gallery_scroll_${slug}`, window.scrollY.toString());
          sessionStorage.setItem(`gallery_photo_${slug}`, photo.id);
        }}
        onTouchStart={startLongPress}
        onTouchEnd={clearLongPressTimer}
        onTouchMove={clearLongPressTimer}
        onTouchCancel={clearLongPressTimer}
      >
        {children}
      </Link>

      {/* Selection checkbox */}
      {onToggleSelection && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelection(photo.id);
          }}
          className={`absolute top-1.5 left-1.5 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-150 z-10 ${
            isSelected
              ? 'bg-blue-600 border-blue-600 text-white opacity-100 pointer-events-auto'
              : `bg-black/30 border-white/70 text-transparent hover:text-white ${controlsRevealClass}`
          }`}
          aria-label={isSelected ? 'Deselect photo' : 'Select photo'}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Favorite heart */}
      {onToggleFavorite && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFavorite(photo.id, isFavorited);
          }}
          className={`absolute top-1.5 right-1.5 bg-black/35 text-white p-1 rounded-full transition-all duration-150 hover:bg-black/55 z-10 ${controlsRevealClass}`}
          title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart className={`w-3.5 h-3.5 ${isFavorited ? 'fill-red-500 text-red-500' : ''}`} />
        </button>
      )}

      {/* Featured star */}
      {showFeatured && onToggleFeatured && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFeatured(photo.id, photo.is_featured);
          }}
          className={`absolute ${onToggleFavorite ? 'right-9' : 'right-1.5'} top-1.5 text-white p-1 rounded-full transition-all duration-150 z-10 ${
            photo.is_featured ? 'bg-yellow-500/90 hover:bg-yellow-500' : 'bg-black/35 hover:bg-black/55'
          } ${controlsRevealClass}`}
          title={photo.is_featured ? 'Remove from featured' : 'Mark as featured'}
        >
          <Star className={`w-3.5 h-3.5 ${photo.is_featured ? 'fill-white' : ''}`} />
        </button>
      )}

      {/* Selected overlay tint */}
      {isSelected && (
        <div className="absolute inset-0 bg-blue-600/15 pointer-events-none z-[5]" />
      )}

      {/* Hover/touch info overlay: capture date + favorite count, bottom gradient */}
      {(supportsHover || touchControlsVisible || forceControlsVisible) && (photo.capture_time || photo.favorites_count > 0) && (
        <div
          className={`absolute inset-x-0 bottom-0 pointer-events-none z-[4] px-2 py-1.5 bg-gradient-to-t from-black/60 via-black/20 to-transparent transition-opacity duration-150 ${
            supportsHover ? 'opacity-0 group-hover:opacity-100' : touchControlsVisible || forceControlsVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className="flex items-center justify-between gap-2 text-white text-[11px] font-medium">
            {photo.capture_time && (
              <span className="truncate drop-shadow">
                {new Date(photo.capture_time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )}
            {photo.favorites_count > 0 && (
              <span className="flex items-center gap-0.5 flex-shrink-0 drop-shadow">
                <Heart className="w-3 h-3 fill-red-500 text-red-500" />
                {photo.favorites_count}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const PhotoOverlay = React.memo(PhotoOverlayInner);

export default JustifiedGrid;
