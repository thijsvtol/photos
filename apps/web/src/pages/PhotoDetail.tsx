import React, { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { Maximize, Minimize, Share2, X, Heart, Play, Pause, Pencil, MoreVertical, Star, Trash2, ArrowLeft, Download, Info, Volume2, VolumeX, Users, Check } from 'lucide-react';

import SEO from '../components/SEO';
import EditorErrorBoundary from '../components/EditorErrorBoundary';
const ImageEditorModal = lazy(() => import('../components/ImageEditorModal'));
const VideoEditorModal = lazy(() => import('../components/VideoEditorModal'));
import { getEvent, getPhoto, getPhotos, loginToEvent, getPreviewUrl, getOriginalUrl, getCastPreviewUrl, downloadOriginal, downloadSmall, downloadInstagram, replacePhoto, toggleFavorite as toggleFavoriteAPI, getUserFavoriteIds, setPhotoFeatured, deletePhoto, getCollaborators, getNamedPeople, tagPeopleOnPhoto, removePersonFromPhoto } from '../api';
import type { NamedPerson } from '../api';
import { createPreview } from '../imageUtils';
import type { Event, Photo } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { config } from '../config';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { haptics } from '../utils/haptics';
import { trackPhotoView, trackPhotoDownload, trackFavorite } from '../services/analytics';
import CastButton from '../components/CastButton';
import { castService } from '../services/castService';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';

const PhotoDetail: React.FC = () => {
  const { slug, photoId } = useParams<{ slug: string; photoId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, login, user } = useAuth();
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const isNative = Capacitor.isNativePlatform();
  const [event, setEvent] = useState<Event | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [allPhotos, setAllPhotos] = useState<Photo[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [isSlideshow, setIsSlideshow] = useState(false);
  const [slideshowSpeed, setSlideshowSpeed] = useState(3000); // milliseconds
  const [preloadedImages, setPreloadedImages] = useState<Set<string>>(new Set());
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const [previousPhoto, setPreviousPhoto] = useState<Photo | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [collaboratorRole, setCollaboratorRole] = useState<'viewer' | 'uploader' | 'editor' | 'admin' | null>(null);
  const [cacheBuster, setCacheBuster] = useState<number>(0);
  // "Tag people" editor state — lets an admin/editor correct/add who is in a photo (multiple
  // people per photo are supported, since a photo can genuinely contain several people, and
  // automatic face detection sometimes misses someone entirely, e.g. turned away or occluded).
  const [showPeopleEditor, setShowPeopleEditor] = useState(false);
  const [namedPeople, setNamedPeople] = useState<NamedPerson[]>([]);
  const [namedPeopleLoading, setNamedPeopleLoading] = useState(false);
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<number>>(new Set());
  const [savingPeopleTags, setSavingPeopleTags] = useState(false);
  const [peopleSearchQuery, setPeopleSearchQuery] = useState('');
  const [removingPersonId, setRemovingPersonId] = useState<number | null>(null);
  // Custom video player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPaused, setVideoPaused] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoBuffered, setVideoBuffered] = useState(0);
  const [videoBuffering, setVideoBuffering] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const videoRetryCountRef = useRef(0);
  const videoRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [seekIndicator, setSeekIndicator] = useState<'left' | 'right' | null>(null);
  const videoControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoTapCountRef = useRef(0);
  const videoTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoTapXRef = useRef(0);
  const videoProgressDraggingRef = useRef(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const swipeVelocityRef = useRef(0);
  const swipeLastXRef = useRef<number | null>(null);
  const swipeLastTimeRef = useRef<number | null>(null);
  const swipeNavigateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const isSwipingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);

  // Pinch-to-zoom state
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomTranslate, setZoomTranslate] = useState({ x: 0, y: 0 });
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const pinchCenter = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });
  const isPinching = useRef(false);
  const isPanning = useRef(false);
  const lastTapTime = useRef(0);
  const lastZoomBoundaryHaptic = useRef(0);
  // True only when the OS/browser itself has zoomed the page (visualViewport.scale > 1),
  // e.g. via accessibility zoom or a pinch gesture that wasn't fully suppressed by
  // preventDefault. This is intentionally separate from `isZoomed` (our own CSS
  // transform-based pinch/double-tap zoom): the two used to share one state, and
  // the interval below polling this every 50ms would immediately stomp `isZoomed`
  // back to false mid-gesture, causing the pan touch handlers to be detached and
  // reattached constantly (dropping chunks of the drag), which looked like the
  // photo being "cropped"/unreachable at its edges when zoomed in.
  const [isNativeViewportZoomed, setIsNativeViewportZoomed] = useState(false);

  // Reset zoom when photo changes
  useEffect(() => {
    setZoomScale(1);
    setZoomTranslate({ x: 0, y: 0 });
    // Reset transient video state when navigating to a different item so
    // controls/progress/buffering don't carry over from the previous video.
    setVideoProgress(0);
    setVideoBuffered(0);
    setVideoDuration(0);
    setVideoBuffering(false);
    setVideoPaused(false);
    setVideoError(false);
    videoRetryCountRef.current = 0;
    if (videoRetryTimeoutRef.current) {
      clearTimeout(videoRetryTimeoutRef.current);
      videoRetryTimeoutRef.current = null;
    }
  }, [photoId]);

  // Auto-retry a failed video load a few times with backoff before showing a
  // manual retry button, mirroring components/ProgressiveVideo.tsx. Previously
  // there was no onError handler at all here, so a failed load just left a
  // permanently blank <video> element with no feedback or way to recover.
  const VIDEO_AUTO_RETRY_LIMIT = 3;
  const VIDEO_AUTO_RETRY_BASE_DELAY_MS = 800;
  const handleVideoError = useCallback(() => {
    setVideoBuffering(false);
    if (videoRetryCountRef.current < VIDEO_AUTO_RETRY_LIMIT) {
      videoRetryCountRef.current += 1;
      const delay = VIDEO_AUTO_RETRY_BASE_DELAY_MS * videoRetryCountRef.current;
      videoRetryTimeoutRef.current = setTimeout(() => {
        videoRef.current?.load();
      }, delay);
    } else {
      setVideoError(true);
    }
  }, []);

  const handleVideoManualRetry = useCallback(() => {
    videoRetryCountRef.current = 0;
    setVideoError(false);
    setVideoBuffering(false);
    videoRef.current?.load();
  }, []);

  // Cleanup pending retry timeout on unmount
  useEffect(() => {
    return () => {
      if (videoRetryTimeoutRef.current) clearTimeout(videoRetryTimeoutRef.current);
    };
  }, []);

  const imageContainerCallbackRef = useCallback((node: HTMLDivElement | null) => {
    imageContainerRef.current = node;
    if (node) {
      setContainerReady(true);
    }
  }, []);
  const slideshowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preloadRefs = useRef<{ [key: string]: HTMLImageElement }>({});
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [containerReady, setContainerReady] = useState(false);
  const handlersAttachedRef = useRef<boolean>(false);
  const navigateNextRef = useRef<(() => void) | null>(null);
  const navigatePrevRef = useRef<(() => void) | null>(null);

  // Fullscreen viewer overlay state
  const [showOverlay, setShowOverlay] = useState(true);
  const [showInfoSheet, setShowInfoSheet] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [videoMuted, setVideoMuted] = useState(true);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the actual <video> element's muted property in sync with state.
  // React only applies the `muted` attribute on initial mount, so subsequent
  // toggles of videoMuted must be pushed to the DOM node imperatively.
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = videoMuted;
    }
  }, [videoMuted, photoId]);

  // Check if we came from favorites page, timeline, or search results — each can restrict
  // next/prev navigation to a subset of the event's photos instead of the full gallery.
  const fromFavorites = location.state?.fromFavorites;
  const fromTimeline = location.state?.fromTimeline;
  const fromSearch = location.state?.fromSearch;
  const favoritePhotos = (location.state?.favoritePhotos || []) as Array<{ id: string; slug: string }>;
  // Only this event's photo ids from the search results the user actually clicked from (see
  // Timeline.tsx's per-event-group JustifiedGrid linkState — search is now built into the
  // Timeline page rather than a separate page) — previously fromSearch was never read at all,
  // so next/prev silently fell back to browsing the ENTIRE event instead of just the photos
  // that matched the search (e.g. a specific person filter).
  const searchResultIds = (location.state?.searchResultIds || []) as string[];
  // Only this event's photo ids that actually appear in the Timeline (see Timeline.tsx's
  // `timelinePhotoIdsByEvent` doc comment) — previously `fromTimeline` only ever affected the
  // Back button's destination, never what next/prev actually iterated over, so swiping through
  // photos opened from the Timeline silently browsed that event's ENTIRE gallery instead of
  // just the (possibly filtered, e.g. "Just me") subset shown in the Timeline.
  const timelinePhotoIds = (location.state?.timelinePhotoIds || []) as string[];
  // Full /timeline?q=...&people=... URL to return to — needed since fromSearch alone isn't
  // enough to reconstruct the exact search the user came from.
  const searchUrl = (location.state?.searchUrl || '/timeline') as string;
  const sortBy = location.state?.sortBy || 'date_desc';
  
  // Filter photos based on whether we're viewing favorites, search results, or the timeline.
  // When restricted, only show photos from this event that are in that subset.
  const displayPhotos = fromFavorites && favoritePhotos.length > 0
    ? allPhotos.filter(p => favoritePhotos.some((fav: { id: string; slug: string }) => fav.id === p.id && fav.slug === slug))
    : fromSearch && searchResultIds.length > 0
    ? allPhotos.filter(p => searchResultIds.includes(p.id))
    : fromTimeline && timelinePhotoIds.length > 0
    ? allPhotos.filter(p => timelinePhotoIds.includes(p.id))
    : allPhotos;
  const photosToUse = displayPhotos.length > 0 ? displayPhotos : allPhotos;


  const swipePreviewPhoto = (() => {
    if (swipeOffset === 0 || currentIndex < 0 || photosToUse.length < 2) {
      return null;
    }

    if (swipeOffset < 0) {
      if (currentIndex < photosToUse.length - 1) {
        return photosToUse[currentIndex + 1];
      }
      return photosToUse[0] ?? null;
    }

    if (currentIndex > 0) {
      return photosToUse[currentIndex - 1];
    }

    return photosToUse[photosToUse.length - 1] ?? null;
  })();

  const swipePreviewUrl = swipePreviewPhoto
    ? getPreviewUrl(slug!, swipePreviewPhoto.id, swipePreviewPhoto.file_type, swipePreviewPhoto.cache_version)
    : null;
  const showSwipePreview = Boolean(
    swipePreviewPhoto &&
    swipePreviewUrl &&
    (swipePreviewPhoto.file_type === 'video/mp4' || preloadedImages.has(swipePreviewUrl))
  );

  const canEditMedia = !!user?.isAdmin || collaboratorRole === 'editor' || collaboratorRole === 'admin';
  const canDeleteMedia = !!user?.isAdmin || collaboratorRole === 'editor' || collaboratorRole === 'admin';
  const canFeatureMedia = !!user?.isAdmin || collaboratorRole === 'admin';

  useEffect(() => {
    const loadRole = async () => {
      if (!slug || !user?.email) {
        setCollaboratorRole(null);
        return;
      }

      try {
        const collaborators = await getCollaborators(slug);
        const me = collaborators.find((collaborator) => collaborator.email.toLowerCase() === user.email.toLowerCase());
        setCollaboratorRole((me?.role as 'viewer' | 'uploader' | 'editor' | 'admin' | undefined) || null);
      } catch {
        setCollaboratorRole(null);
      }
    };

    void loadRole();
  }, [slug, user?.email]);

  useEffect(() => {
    if (slug && photoId) {
      loadPhoto();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Update photo when photoId changes in URL (for browser back/forward)
  useEffect(() => {
    if (!photoId || allPhotos.length === 0) return;

    const index = photosToUse.findIndex(p => p.id === photoId);
    if (index < 0 || index === currentIndex) return;

    setCurrentIndex(index);
    const photoInList = photosToUse[index];
    if (!photoInList) return;

    // The gallery list never includes `.people` (see Photo.people's doc comment in types.ts),
    // so navigating between photos (swipe/next/prev) would otherwise show "No one tagged yet"
    // for every photo except the very first one loaded. Fetch the single-photo detail in the
    // background to pick up its real people list once ready, guarded by `cancelled` so a fast
    // swipe-through doesn't attach a stale response to whatever photo is showing by the time it
    // resolves.
    setPhoto(photoInList);
    setImageLoaded(false); // Reset for new image

    let cancelled = false;
    getPhoto(slug!, photoId).then((fullPhoto) => {
      if (cancelled) return;
      setPhoto((prev) => (prev && prev.id === photoId ? { ...prev, people: fullPhoto.people } : prev));
    }).catch(() => {
      // Best-effort only — the photo itself is already showing from the list; a failed
      // people fetch just means the People section stays empty until the next load.
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoId, allPhotos, displayPhotos]);

  // Preload adjacent images for smooth navigation
  useEffect(() => {
    // While editing, avoid background preview fetches to keep network activity deterministic.
    if (showEditor) return;
    if (!photo || displayPhotos.length === 0) return;

    const loadedUrls: string[] = [];
    const preloadCache = preloadRefs.current;

    const preloadImage = (photoToPreload: Photo) => {
      const url = getPreviewUrl(slug!, photoToPreload.id, photoToPreload.file_type, photoToPreload.cache_version);
      
      // Skip if already preloaded or is a video
      if (preloadedImages.has(url) || photoToPreload.file_type === 'video/mp4') return;

      // Create and cache the image
      const img = new Image();
      img.src = url;
      preloadCache[url] = img;
      
      img.onload = () => {
        loadedUrls.push(url);
        setPreloadedImages(prev => {
          const newSet = new Set(prev);
          newSet.add(url);
          // Limit Set size to prevent memory buildup (keep last 20 images)
          if (newSet.size > 20) {
            const firstItem = Array.from(newSet)[0];
            newSet.delete(firstItem);
            // Clean up the preload ref
            delete preloadCache[firstItem];
          }
          return newSet;
        });
      };
      
      img.onerror = () => {
        // Silently handle preload errors - the main image load will show error if needed
        delete preloadCache[url];
      };
    };

    // Preload next 3 photos for smooth swiping
    for (let i = 1; i <= 3; i++) {
      const nextIdx = currentIndex + i;
      if (nextIdx < photosToUse.length) {
        preloadImage(photosToUse[nextIdx]);
      } else if (nextIdx >= photosToUse.length && photosToUse.length > 0) {
        preloadImage(photosToUse[nextIdx - photosToUse.length]);
      }
    }

    // Preload previous 2 photos
    for (let i = 1; i <= 2; i++) {
      const prevIdx = currentIndex - i;
      if (prevIdx >= 0) {
        preloadImage(photosToUse[prevIdx]);
      } else if (prevIdx < 0 && photosToUse.length > 1) {
        preloadImage(photosToUse[photosToUse.length + prevIdx]);
      }
    }

    // Cleanup function
    return () => {
      // Remove event handlers from images that were loaded during this effect
      loadedUrls.forEach(url => {
        const img = preloadCache[url];
        if (img) {
          img.onload = null;
          img.onerror = null;
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, displayPhotos, allPhotos, photo, slug, preloadedImages, showEditor]);

  // Check if current photo is favorited
  useEffect(() => {
    const loadFavoriteStatus = async () => {
      if (photo && isAuthenticated) {
        try {
          const favorites = await getUserFavoriteIds();
          setIsFavorited(favorites.some(f => f.photoId === photo.id));
        } catch (err) {
          console.error('Failed to load favorite status:', err);
          setIsFavorited(false);
        }
      } else {
        setIsFavorited(false);
      }
    };
    loadFavoriteStatus();
  }, [photo, isAuthenticated]);

  // Slideshow timer
  useEffect(() => {
    if (isSlideshow && imageLoaded) {
      slideshowTimerRef.current = setTimeout(() => {
        navigateNextRef.current?.();
      }, slideshowSpeed);
    }
    
    return () => {
      if (slideshowTimerRef.current) {
        clearTimeout(slideshowTimerRef.current);
      }
    };
  }, [isSlideshow, currentIndex, slideshowSpeed, imageLoaded]);

  // Keep an active Cast session in sync with the currently viewed photo —
  // whether the user swipes/navigates manually or the slideshow above
  // auto-advances — instead of only casting whatever photo was on screen
  // when casting started. Uses the (much smaller/faster-loading) preview
  // rather than the full original — same as album casting — since a TV
  // display doesn't benefit from full original resolution and the original
  // (especially RAW/high-res camera files) was causing slow loads/long
  // black gaps between photos.
  useEffect(() => {
    if (!photo || !slug) return;
    if (!castService.isConnected()) return;

    castService.loadMedia({
      type: photo.file_type === 'video/mp4' ? 'video' : 'photo',
      url: getCastPreviewUrl(slug, photo.id, photo.file_type, photo.cache_version),
      title: photo.original_filename,
    }).catch((err) => console.error('[PhotoDetail] Failed to update cast media:', err));
  }, [photo, slug]);

  // Keyboard navigation - using refs for stable event handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigatePrevRef.current?.();
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateNextRef.current?.();
      }
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        toggleSlideshow();
      }
      if (e.key === 'Escape') {
        if (showInfoSheet) {
          setShowInfoSheet(false);
        } else if (showDownloadMenu) {
          setShowDownloadMenu(false);
        } else if (isSlideshow) {
          setIsSlideshow(false);
        } else {
          navigate(fromFavorites ? '/favorites' : fromTimeline ? '/timeline' : fromSearch ? searchUrl : `/events/${slug}`);
        }
      }
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      if (e.key === 'i' || e.key === 'I') setShowInfoSheet(prev => !prev);
      if (e.key === '?' || e.key === 'h' || e.key === 'H') setShowKeyboardHelp(prev => !prev);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isFullscreen, fromFavorites, isSlideshow]);

  // Continuously monitor zoom state
  useEffect(() => {
    const checkZoom = () => {
      checkIfZoomed();
    };
    
    // Check zoom state very frequently for responsive behavior
    const interval = setInterval(checkZoom, 50);
    
    // Also check on viewport resize events
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', checkZoom);
      window.visualViewport.addEventListener('scroll', checkZoom);
    }
    
    return () => {
      clearInterval(interval);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', checkZoom);
        window.visualViewport.removeEventListener('scroll', checkZoom);
      }
    };
  }, []);

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
      if (swipeNavigateTimeoutRef.current) {
        clearTimeout(swipeNavigateTimeoutRef.current);
      }
      if (slideshowTimerRef.current) {
        clearTimeout(slideshowTimerRef.current);
      }
      if (overlayTimerRef.current) {
        clearTimeout(overlayTimerRef.current);
      }
    };
  }, []);

  const loadPhoto = async () => {
    try {
      setLoading(true);
      const eventData = await getEvent(slug!);
      setEvent(eventData);
      
      try {
        const photoData = await getPhoto(slug!, photoId!);
        setPhoto(photoData);
        setAuthenticated(true);
        
        // Load all photos for navigation with the same sort order
        const allPhotosData = await getPhotos(slug!, sortBy);
        setAllPhotos(allPhotosData);
        
        // Find index in the appropriate list
        const photosToUse = fromFavorites && favoritePhotos.length > 0
          ? allPhotosData.filter(p => favoritePhotos.some((fav: { id: string; slug: string }) => fav.id === p.id && fav.slug === slug))
          : fromSearch && searchResultIds.length > 0
          ? allPhotosData.filter(p => searchResultIds.includes(p.id))
          : fromTimeline && timelinePhotoIds.length > 0
          ? allPhotosData.filter(p => timelinePhotoIds.includes(p.id))
          : allPhotosData;
        const index = photosToUse.findIndex(p => p.id === photoId);
        setCurrentIndex(index);
        
        // Update photo with the version from allPhotos which includes all EXIF data.
        // The gallery list endpoint never includes `.people` (only the single-photo detail
        // fetch above does — see api.ts's Photo.people doc comment), so carry it over from
        // photoData rather than letting this overwrite silently drop it (previously caused
        // "No one tagged yet" to show for a photo that DOES have tagged people).
        if (index >= 0 && photosToUse[index]) {
          setPhoto({ ...photosToUse[index], people: photoData.people });
        }
        
        // Track photo view
        trackPhotoView(parseInt(photoId!), slug!);
      } catch {
        setAuthenticated(false);
      }
      
      setError(null);
    } catch (err) {
      setError('Failed to load photo');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await loginToEvent(slug!, password);
      setAuthenticated(true);
      setLoginError(null);
      await loadPhoto();
    } catch (err) {
      setLoginError('Invalid password');
      console.error(err);
    }
  };

  const toggleSlideshow = () => {
    setIsSlideshow(!isSlideshow);
  };

  const navigateToNext = useCallback(() => {
    // When viewing favorites, always navigate through the favoritePhotos list across all events
    if (fromFavorites && favoritePhotos.length > 0) {
      const currentFavIndex = favoritePhotos.findIndex((fav: { id: string; slug: string }) => fav.id === photoId && fav.slug === slug);
      if (currentFavIndex >= 0 && currentFavIndex < favoritePhotos.length - 1) {
        const nextFav = favoritePhotos[currentFavIndex + 1];
        navigate(`/p/${nextFav.slug}/${nextFav.id}`, { 
          state: { fromFavorites: true, favoritePhotos } 
        });
      } else if (currentFavIndex === favoritePhotos.length - 1) {
        // Loop back to first favorite
        const firstFav = favoritePhotos[0];
        navigate(`/p/${firstFav.slug}/${firstFav.id}`, { 
          state: { fromFavorites: true, favoritePhotos } 
        });
      }
    } else {
      // Normal event gallery navigation
      if (currentIndex >= 0 && currentIndex < photosToUse.length - 1) {
        const nextIndex = currentIndex + 1;
        const nextPhoto = photosToUse[nextIndex];
        
        // Cancel any in-progress transition
        if (transitionTimeoutRef.current) {
          clearTimeout(transitionTimeoutRef.current);
          transitionTimeoutRef.current = null;
        }
        
        // Keep current photo visible for cross-fade
        setPreviousPhoto(photo);
        
        // Start transition with slide animation
        setIsTransitioning(true);
        setSlideDirection('left'); // Sliding left = next photo
        
        // Check if image is preloaded
        const imageUrl = getPreviewUrl(slug!, nextPhoto.id, nextPhoto.file_type, nextPhoto.cache_version);
        const isPreloaded = preloadedImages.has(imageUrl);
        
        setCurrentIndex(nextIndex);
        setPhoto(nextPhoto);
        setImageLoaded(isPreloaded); // If preloaded, mark as loaded immediately
        
        // Preserve the navigation-context state (fromTimeline/fromSearch/etc) across this
        // in-place navigate — previously omitted here, which silently dropped `location.state`
        // on every `replace: true` call. Since this component doesn't remount between photos
        // (same route, different :photoId param), `photosToUse` re-derives itself from
        // `location.state` on every render — so after the FIRST next/prev, the context was
        // already gone and browsing silently fell back to the event's entire gallery instead of
        // staying restricted to the Timeline/search subset the user actually came from. This was
        // the reported "next photo goes to the whole album, not the Timeline" bug.
        navigate(`/p/${slug}/${nextPhoto.id}`, { replace: true, state: location.state });
        
        // End transition and reset slide direction
        transitionTimeoutRef.current = setTimeout(() => {
          setPreviousPhoto(null); // Clear previous photo after transition
          setIsTransitioning(false);
          setSlideDirection(null);
          transitionTimeoutRef.current = null;
        }, 200);
      } else if (currentIndex === photosToUse.length - 1 && photosToUse.length > 0) {
        // Loop back to first photo
        const firstPhoto = photosToUse[0];
        const imageUrl = getPreviewUrl(slug!, firstPhoto.id, firstPhoto.file_type, firstPhoto.cache_version);
        const isPreloaded = preloadedImages.has(imageUrl);
        
        if (transitionTimeoutRef.current) {
          clearTimeout(transitionTimeoutRef.current);
          transitionTimeoutRef.current = null;
        }
        
        // Keep current photo visible for cross-fade
        setPreviousPhoto(photo);
        
        setIsTransitioning(true);
        setSlideDirection('left');
        setCurrentIndex(0);
        setPhoto(firstPhoto);
        setImageLoaded(isPreloaded);
        
        // See the preceding navigate() call's comment for why `state: location.state` is required.
        navigate(`/p/${slug}/${firstPhoto.id}`, { replace: true, state: location.state });
        transitionTimeoutRef.current = setTimeout(() => {
          setPreviousPhoto(null);
          setIsTransitioning(false);
          setSlideDirection(null);
          transitionTimeoutRef.current = null;
        }, 200);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTransitioning, fromFavorites, favoritePhotos, photoId, slug, navigate, displayPhotos, allPhotos, currentIndex, preloadedImages, photo, location.state]);

  const navigateToPrevious = useCallback(() => {
    // When viewing favorites, always navigate through the favoritePhotos list across all events
    if (fromFavorites && favoritePhotos.length > 0) {
      const currentFavIndex = favoritePhotos.findIndex((fav: { id: string; slug: string }) => fav.id === photoId && fav.slug === slug);
      if (currentFavIndex > 0) {
        const prevFav = favoritePhotos[currentFavIndex - 1];
        navigate(`/p/${prevFav.slug}/${prevFav.id}`, { 
          state: { fromFavorites: true, favoritePhotos } 
        });
      } else if (currentFavIndex === 0) {
        // Loop back to last favorite
        const lastFav = favoritePhotos[favoritePhotos.length - 1];
        navigate(`/p/${lastFav.slug}/${lastFav.id}`, { 
          state: { fromFavorites: true, favoritePhotos } 
        });
      }
    } else {
      // Normal event gallery navigation
      if (currentIndex > 0) {
        const prevIndex = currentIndex - 1;
        const prevPhoto = photosToUse[prevIndex];
        
        // Cancel any in-progress transition
        if (transitionTimeoutRef.current) {
          clearTimeout(transitionTimeoutRef.current);
          transitionTimeoutRef.current = null;
        }
        
        // Keep current photo visible for cross-fade
        setPreviousPhoto(photo);
        
        // Start transition with slide animation
        setIsTransitioning(true);
        setSlideDirection('right'); // Sliding right = previous photo
        
        // Check if image is preloaded
        const imageUrl = getPreviewUrl(slug!, prevPhoto.id, prevPhoto.file_type, prevPhoto.cache_version);
        const isPreloaded = preloadedImages.has(imageUrl);
        
        setCurrentIndex(prevIndex);
        setPhoto(prevPhoto);
        setImageLoaded(isPreloaded); // If preloaded, mark as loaded immediately
        
        // See navigateToNext()'s matching comment for why `state: location.state` is required
        // here — omitting it silently drops the fromTimeline/fromSearch/etc context after the
        // FIRST navigation.
        navigate(`/p/${slug}/${prevPhoto.id}`, { replace: true, state: location.state });
        
        // End transition and reset slide direction
        transitionTimeoutRef.current = setTimeout(() => {
          setPreviousPhoto(null); // Clear previous photo after transition
          setIsTransitioning(false);
          setSlideDirection(null);
          transitionTimeoutRef.current = null;
        }, 200);
      } else if (currentIndex === 0 && photosToUse.length > 1) {
        // Loop back to last photo
        const lastPhoto = photosToUse[photosToUse.length - 1];
        const imageUrl = getPreviewUrl(slug!, lastPhoto.id, lastPhoto.file_type, lastPhoto.cache_version);
        const isPreloaded = preloadedImages.has(imageUrl);
        
        if (transitionTimeoutRef.current) {
          clearTimeout(transitionTimeoutRef.current);
          transitionTimeoutRef.current = null;
        }
        
        // Keep current photo visible for cross-fade
        setPreviousPhoto(photo);
        
        setIsTransitioning(true);
        setSlideDirection('right');
        setCurrentIndex(photosToUse.length - 1);
        setPhoto(lastPhoto);
        setImageLoaded(isPreloaded);
        
        navigate(`/p/${slug}/${lastPhoto.id}`, { replace: true, state: location.state });
        transitionTimeoutRef.current = setTimeout(() => {
          setPreviousPhoto(null);
          setIsTransitioning(false);
          setSlideDirection(null);
          transitionTimeoutRef.current = null;
        }, 200);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTransitioning, fromFavorites, favoritePhotos, photoId, slug, navigate, displayPhotos, allPhotos, currentIndex, preloadedImages, photo, location.state]);

  // Keep refs updated for stable event handlers
  navigateNextRef.current = navigateToNext;
  navigatePrevRef.current = navigateToPrevious;

  // Check if the image container is zoomed (only using visualViewport)
  const checkIfZoomed = (): boolean => {
    // Check visualViewport scale (mobile browsers)
    let isViewportZoomed = false;
    const hasViewport = typeof window !== 'undefined' && window.visualViewport;
    
    if (hasViewport) {
      // Lower threshold to catch even slight zooms (>= 1.01 instead of > 1.01)
      isViewportZoomed = window.visualViewport!.scale >= 1.01;
    }
    
    setIsNativeViewportZoomed(isViewportZoomed);
    return isViewportZoomed;
  };

  // Native touch handlers with stable references using useCallback
  // CRITICAL: No dependencies that change - these must be stable function references
  // --- Custom video player logic ---
  const resetVideoControlsTimer = useCallback(() => {
    if (videoControlsTimerRef.current) clearTimeout(videoControlsTimerRef.current);
    setShowOverlay(true);
    videoControlsTimerRef.current = setTimeout(() => {
      if (!videoRef.current?.paused) {
        setShowOverlay(false);
      }
    }, 3000);
  }, []);

  const handleVideoTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (videoProgressDraggingRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clientX = 'touches' in e ? e.changedTouches[0].clientX : e.clientX;
    const tapX = clientX - rect.left;
    const tapZone = tapX / rect.width;

    videoTapCountRef.current += 1;
    videoTapXRef.current = tapZone;

    if (videoTapTimerRef.current) clearTimeout(videoTapTimerRef.current);

    videoTapTimerRef.current = setTimeout(() => {
      const count = videoTapCountRef.current;
      videoTapCountRef.current = 0;

      if (count === 1) {
        // Single tap: toggle play/pause
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) {
          v.play();
          setVideoPaused(false);
        } else {
          v.pause();
          setVideoPaused(true);
        }
        resetVideoControlsTimer();
      } else if (count >= 2) {
        // Double tap: seek ±10s
        const v = videoRef.current;
        if (!v) return;
        if (videoTapXRef.current < 0.35) {
          v.currentTime = Math.max(0, v.currentTime - 10);
          setSeekIndicator('left');
          haptics.light();
        } else if (videoTapXRef.current > 0.65) {
          v.currentTime = Math.min(v.duration, v.currentTime + 10);
          setSeekIndicator('right');
          haptics.light();
        }
        resetVideoControlsTimer();
        setTimeout(() => setSeekIndicator(null), 600);
      }
    }, 250);
  }, [resetVideoControlsTimer]);

  const handleVideoTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || videoProgressDraggingRef.current) return;
    setVideoProgress(v.currentTime);
    if (v.buffered.length > 0) {
      setVideoBuffered(v.buffered.end(v.buffered.length - 1));
    }
  }, []);

  const handleVideoSeek = useCallback((e: React.MouseEvent | React.TouchEvent, bar: HTMLDivElement) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const rect = bar.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration;
    setVideoProgress(v.currentTime);
    resetVideoControlsTimer();
  }, [resetVideoControlsTimer]);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Clean up video timers
  useEffect(() => {
    return () => {
      if (videoControlsTimerRef.current) clearTimeout(videoControlsTimerRef.current);
      if (videoTapTimerRef.current) clearTimeout(videoTapTimerRef.current);
    };
  }, []);

  const getSwipeResistance = (deltaX: number, width: number): number => {
    const normalizedDistance = Math.min(Math.abs(deltaX) / Math.max(width, 1), 1);
    return Math.max(0.58, 0.92 - normalizedDistance * 0.28);
  };

  const handleTouchStartNative = React.useCallback((e: TouchEvent) => {
    // Double-tap to zoom
    if (e.touches.length === 1) {
      const now = Date.now();
      const timeSinceLastTap = now - lastTapTime.current;
      lastTapTime.current = now;
      
      if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
        // Double tap detected
        e.preventDefault();
        if (zoomScale > 1) {
          setZoomScale(1);
          setZoomTranslate({ x: 0, y: 0 });
          setIsZoomed(false);
        } else {
          setZoomScale(2.5);
          // Zoom toward tap point
          const rect = imageContainerRef.current?.getBoundingClientRect();
          if (rect) {
            const x = e.touches[0].clientX - rect.left - rect.width / 2;
            const y = e.touches[0].clientY - rect.top - rect.height / 2;
            setZoomTranslate({ x: -x * 1.5, y: -y * 1.5 });
          }
          setIsZoomed(true);
        }
        touchStartX.current = null;
        return;
      }
    }

    // Pinch-to-zoom (two fingers)
    if (e.touches.length === 2) {
      e.preventDefault();
      isPinching.current = true;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistance.current = Math.hypot(dx, dy);
      pinchStartScale.current = zoomScale;
      pinchCenter.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
      // Clear swipe tracking
      touchStartX.current = null;
      touchStartY.current = null;
      touchEndX.current = null;
      isSwipingRef.current = false;
      setIsSwiping(false);
      setSwipeOffset(0);
      return;
    }

    // Single-finger: pan when zoomed, or swipe when not zoomed
    if (e.touches.length === 1) {
      if (zoomScale > 1) {
        // Pan mode
        isPanning.current = true;
        panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        translateStart.current = { ...zoomTranslate };
        return;
      }

      // Swipe navigation (only when not zoomed)
      if (swipeNavigateTimeoutRef.current) {
        clearTimeout(swipeNavigateTimeoutRef.current);
        swipeNavigateTimeoutRef.current = null;
      }

      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      touchEndX.current = e.touches[0].clientX;
      swipeLastXRef.current = e.touches[0].clientX;
      swipeLastTimeRef.current = performance.now();
      swipeVelocityRef.current = 0;
      setSwipeOffset(0);
      isSwipingRef.current = false;
      setIsSwiping(false);
    }
  }, [zoomScale, zoomTranslate]);

  const handleTouchMoveNative = React.useCallback((e: TouchEvent) => {
    // Pinch zoom
    if (e.touches.length === 2 && isPinching.current && pinchStartDistance.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.hypot(dx, dy);
      const rawScale = pinchStartScale.current * (distance / pinchStartDistance.current);
      const newScale = Math.max(1, Math.min(5, rawScale));
      // Haptic feedback when hitting zoom boundaries
      if ((rawScale <= 1 || rawScale >= 5) && Date.now() - lastZoomBoundaryHaptic.current > 300) {
        lastZoomBoundaryHaptic.current = Date.now();
        haptics.light();
      }
      setZoomScale(newScale);
      setIsZoomed(newScale > 1.05);
      return;
    }

    // Pan when zoomed
    if (e.touches.length === 1 && isPanning.current && zoomScale > 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - panStart.current.x;
      const dy = e.touches[0].clientY - panStart.current.y;
      // Clamp translation so the image doesn't leave the viewport. Fall back to
      // the actual viewport dimensions (not an arbitrary guess) if the container
      // hasn't been measured yet, so panning isn't over-constrained on small screens.
      //
      // The zoomed content's on-screen pixel shift equals zoomTranslate.{x,y}
      // directly, NOT divided by zoomScale — the transform is
      // `scale(zoomScale) translate(x/zoomScale, y/zoomScale)`, and that
      // `/zoomScale` in the translate exactly cancels the outer scale()'s
      // multiplication (CSS composes right-to-left: translate happens in the
      // element's local/unscaled space, then gets multiplied by the scale).
      // So the max pan distance for the scaled content to still fully cover
      // the container is `containerWidth * (zoomScale - 1) / 2` — previously
      // this was ALSO divided by zoomScale, under-shooting the true edge by
      // that same factor (e.g. at 2.5x zoom, only ~40% of the way to the
      // actual image edge was reachable) — this was the long-standing
      // "can pan a bit but never reach the true edges" bug.
      const container = imageContainerRef.current;
      const containerWidth = container?.clientWidth || window.innerWidth;
      const containerHeight = container?.clientHeight || window.innerHeight;
      const maxX = (containerWidth * (zoomScale - 1)) / 2;
      const maxY = (containerHeight * (zoomScale - 1)) / 2;
      setZoomTranslate({
        x: Math.max(-maxX, Math.min(maxX, translateStart.current.x + dx)),
        y: Math.max(-maxY, Math.min(maxY, translateStart.current.y + dy)),
      });
      return;
    }

    // Swipe navigation (only when not zoomed)
    if (e.touches.length === 1 && touchStartX.current !== null && zoomScale <= 1) {
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const deltaX = currentX - touchStartX.current;
      const deltaY = touchStartY.current !== null ? currentY - touchStartY.current : 0;
      const now = performance.now();
      const containerWidth = imageContainerRef.current?.clientWidth || window.innerWidth || 1;

      if (swipeLastXRef.current !== null && swipeLastTimeRef.current !== null) {
        const timeDelta = Math.max(now - swipeLastTimeRef.current, 1);
        swipeVelocityRef.current = (currentX - swipeLastXRef.current) / timeDelta;
      }

      swipeLastXRef.current = currentX;
      swipeLastTimeRef.current = now;

      touchEndX.current = currentX;

      // Only hijack when gesture is primarily horizontal.
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        e.preventDefault();
        isSwipingRef.current = true;
        setIsSwiping(true);
        setSwipeOffset(deltaX * getSwipeResistance(deltaX, containerWidth));
      }
    }
  }, [zoomScale]);

  const handleTouchEndNative = React.useCallback(() => {
    // End pinch
    if (isPinching.current) {
      isPinching.current = false;
      pinchStartDistance.current = null;
      // Snap back to 1 if barely zoomed
      if (zoomScale < 1.1) {
        setZoomScale(1);
        setZoomTranslate({ x: 0, y: 0 });
        setIsZoomed(false);
      }
      return;
    }

    // End pan
    if (isPanning.current) {
      isPanning.current = false;
      return;
    }

    // Check if we should navigate based on swipe
    if (touchStartX.current !== null && touchEndX.current !== null) {
      const diff = touchStartX.current - touchEndX.current;
      const containerWidth = imageContainerRef.current?.clientWidth || window.innerWidth || 320;
      const threshold = Math.min(96, Math.max(48, containerWidth * 0.18));
      const absVelocity = Math.abs(swipeVelocityRef.current);
      const shouldNavigate = isSwipingRef.current && (Math.abs(diff) > threshold || absVelocity > 0.42);
      
      isSwipingRef.current = false;
      setIsSwiping(false);

      if (shouldNavigate) {
        const targetOffset = diff > 0 ? -containerWidth * 0.92 : containerWidth * 0.92;
        setSwipeOffset(targetOffset);

        if (swipeNavigateTimeoutRef.current) {
          clearTimeout(swipeNavigateTimeoutRef.current);
        }

        swipeNavigateTimeoutRef.current = setTimeout(() => {
          if (diff > 0) {
            navigateNextRef.current?.();
          } else {
            navigatePrevRef.current?.();
          }
          setSwipeOffset(0);
          swipeNavigateTimeoutRef.current = null;
        }, 80);
      } else {
        // Snap back smoothly if threshold not reached.
        setSwipeOffset(0);
      }
    }
    
    // Reset touch tracking
    touchStartX.current = null;
    touchStartY.current = null;
    touchEndX.current = null;
    swipeLastXRef.current = null;
    swipeLastTimeRef.current = null;
    swipeVelocityRef.current = 0;
  }, [zoomScale]);

  const handleTouchCancelNative = React.useCallback(() => {
    touchStartX.current = null;
    touchStartY.current = null;
    touchEndX.current = null;
    swipeLastXRef.current = null;
    swipeLastTimeRef.current = null;
    swipeVelocityRef.current = 0;
    setSwipeOffset(0);
    isSwipingRef.current = false;
    setIsSwiping(false);
  }, []);

  // Conditionally attach/detach touch handlers based on NATIVE (OS/browser-level)
  // zoom state only. Our own custom pinch/double-tap zoom (zoomScale/zoomTranslate,
  // driven by these very handlers) has no native fallback to hand off to — it's a
  // CSS transform, not a scrollable region — so the handlers must stay attached
  // throughout a custom zoom/pan gesture. They only need to step aside when the
  // actual browser/OS has zoomed the viewport (visualViewport), since in that case
  // native touch panning genuinely takes over.
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container || !containerReady) return;

    if (isNativeViewportZoomed) {
      if (handlersAttachedRef.current) {
        container.removeEventListener('touchstart', handleTouchStartNative);
        container.removeEventListener('touchmove', handleTouchMoveNative);
        container.removeEventListener('touchend', handleTouchEndNative);
        container.removeEventListener('touchcancel', handleTouchCancelNative);
        handlersAttachedRef.current = false;
      }
    } else {
      if (!handlersAttachedRef.current) {
        container.addEventListener('touchstart', handleTouchStartNative, { passive: false });
        container.addEventListener('touchmove', handleTouchMoveNative, { passive: false });
        container.addEventListener('touchend', handleTouchEndNative, { passive: false });
        container.addEventListener('touchcancel', handleTouchCancelNative, { passive: false });
        handlersAttachedRef.current = true;
      }
    }

    return () => {
      if (handlersAttachedRef.current && container) {
        container.removeEventListener('touchstart', handleTouchStartNative);
        container.removeEventListener('touchmove', handleTouchMoveNative);
        container.removeEventListener('touchend', handleTouchEndNative);
        container.removeEventListener('touchcancel', handleTouchCancelNative);
        handlersAttachedRef.current = false;
      }
    };
  }, [isNativeViewportZoomed, containerReady, handleTouchStartNative, handleTouchMoveNative, handleTouchEndNative, handleTouchCancelNative]);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const sharePhoto = async (platform?: string) => {
    const domain = Capacitor.isNativePlatform() ? `https://${config.domain}` : window.location.origin;
    const url = `${domain}/p/${slug}/${photoId}`;
    const text = `Check out this photo from ${event?.name}`;
    
    // Use Capacitor native share on mobile app
    if (!platform && Capacitor.isNativePlatform()) {
      try {
        const shareOptions: { title?: string; text?: string; url?: string; dialogTitle?: string; files?: string[] } = {
          title: event?.name || 'Photo',
          text: text,
          url: url,
          dialogTitle: 'Share photo',
        };

        // Try to download the image and include it as a file
        try {
          const imageUrl = getPreviewUrl(slug!, photo?.id || photoId!, photo?.file_type, photo?.cache_version);
          const response = await fetch(imageUrl);
          const blob = await response.blob();
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
            reader.readAsDataURL(blob);
          });
          const ext = photo?.file_type === 'video/mp4' ? 'mp4' : 'jpg';
          const fileName = `share_photo.${ext}`;
          const saved = await Filesystem.writeFile({
            path: fileName,
            data: base64,
            directory: Directory.Cache,
          });
          shareOptions.files = [saved.uri];
        } catch {
          // Could not include file, share without it
        }

        await Share.share(shareOptions);
        return;
      } catch (err) {
        if ((err as Error).message !== 'Share canceled') {
          console.error('Native share error:', err);
        }
        return;
      }
    }

    // Use OS share sheet (works on desktop and mobile browsers)
    if (!platform && navigator.share) {
      try {
        await navigator.share({
          title: event?.name || 'Photo',
          text: text,
          url: url,
        });
        return;
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Error sharing:', err);
        }
        return;
      }
    }
    
    // Fall back to clipboard copy if share API not available
    if (!platform) {
      await navigator.clipboard.writeText(url);
      toast.showSuccess('Link copied to clipboard!');
      return;
    }

    // Platform-specific sharing
    switch (platform) {
      case 'twitter':
        window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank');
        break;
      case 'facebook':
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
        break;
      case 'whatsapp':
        window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank');
        break;
      default:
        await navigator.clipboard.writeText(url);
        toast.showSuccess('Link copied to clipboard!');
        break;
    }
  };

  const toggleFavorite = async () => {
    if (!photo || !slug) return;
    
    // Require authentication for favorites
    if (!isAuthenticated) {
      const shouldLogin = await confirm(
        'Login Required',
        'You need to be logged in to save favorites. Would you like to login now?'
      );
      if (shouldLogin) {
        login();
      }
      return;
    }
    
    try {
      await toggleFavoriteAPI(photo.id, isFavorited);
      await haptics.light();
      setIsFavorited(!isFavorited);
      
      // Track favorite action
      trackFavorite(photo.id, isFavorited ? 'remove' : 'add');
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
      toast.showError('Failed to update favorite. Please try again.');
    }
  };

  const handleEditorSave = async (editedBlob: Blob) => {
    if (!slug || !photo) return;
    try {
      let previewBlob: Blob;
      
      // Generate preview based on file type
      if (photo.file_type === 'video/mp4') {
        // For videos, create a still frame preview (using first frame)
        // Using createPreview with a simple approach - just use the original for now
        // In production, could extract first video frame
        previewBlob = editedBlob;
      } else {
        // For images, create a downsized preview
        const editedFile = new File([editedBlob], 'edited.jpg', { type: 'image/jpeg' });
        previewBlob = await createPreview(editedFile);
      }
      
      // Upload both original and preview to replace the current photo
      await replacePhoto(slug, photo.id, editedBlob, previewBlob);
      
      const mediaType = photo.file_type === 'video/mp4' ? 'video' : 'photo';
      toast.showSuccess(`${mediaType} saved successfully!`);
      setShowEditor(false);
      
      // Force reload the photo to show the updated version
      setImageLoaded(false);
      setCacheBuster(Date.now());
      await loadPhoto();
    } catch (err) {
      console.error('Failed to save edited media:', err);
      // Surface the real reason so mobile failures are diagnosable instead of
      // showing a generic message.
      let detail = '';
      if (err && typeof err === 'object') {
        const anyErr = err as { response?: { status?: number; data?: unknown }; message?: string };
        if (anyErr.response?.status) {
          const data = anyErr.response.data;
          const serverMsg =
            typeof data === 'string'
              ? data
              : data && typeof data === 'object' && 'error' in data
                ? String((data as { error: unknown }).error)
                : '';
          detail = ` (${anyErr.response.status}${serverMsg ? `: ${serverMsg}` : ''})`;
        } else if (anyErr.message) {
          detail = ` (${anyErr.message})`;
        }
      }
      toast.showError(`Failed to save${detail}. Please try again.`);
    }
  };

  const handleDownloadOriginal = () => {
    if (!slug || !photo) return;
    downloadOriginal(slug, photo.id);
    trackPhotoDownload(photo.id, slug, false, 1);
  };

  const handleDownloadSmall = () => {
    if (!slug || !photo) return;
    downloadSmall(slug, photo.id);
    trackPhotoDownload(photo.id, slug, false, 1);
  };

  const handleDownloadInstagram = () => {
    if (!slug || !photo) return;
    downloadInstagram(slug, photo.id);
    trackPhotoDownload(photo.id, slug, false, 1);
  };

  const handleOpenPeopleEditor = async () => {
    if (!photo) return;
    setSelectedPersonIds(new Set((photo.people || []).map((p) => p.id)));
    setPeopleSearchQuery('');
    setShowPeopleEditor(true);
    setNamedPeopleLoading(true);
    try {
      const people = await getNamedPeople();
      setNamedPeople(people);
    } catch (err) {
      console.error('Failed to load people list', err);
      toast.showError('Failed to load people list');
    } finally {
      setNamedPeopleLoading(false);
    }
  };

  const handleTogglePersonSelection = (personId: number) => {
    setSelectedPersonIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      return next;
    });
  };

  const handleSavePeopleTags = async () => {
    if (!photo) return;
    setSavingPeopleTags(true);
    try {
      const updatedPeople = await tagPeopleOnPhoto(photo.id, Array.from(selectedPersonIds));
      setPhoto((prev) => (prev ? { ...prev, people: updatedPeople } : prev));
      setShowPeopleEditor(false);
    } catch (err) {
      console.error('Failed to save people tags', err);
      toast.showError('Failed to save people tags');
    } finally {
      setSavingPeopleTags(false);
    }
  };

  // Quick single-click "unattach" from a person chip in the People section — separate from the
  // full "Tag people" editor's Save flow because that flow only ever replaces MANUAL tags (see
  // tagPeopleOnPhoto()'s doc comment); a person who's on the photo purely via automatic face
  // detection would otherwise stay attached even after being deselected there. This calls the
  // dedicated remove endpoint instead, which undoes both possible sources of attachment.
  const handleRemovePersonFromPhoto = async (personId: number) => {
    if (!photo) return;
    setRemovingPersonId(personId);
    try {
      const updatedPeople = await removePersonFromPhoto(photo.id, personId);
      setPhoto((prev) => (prev ? { ...prev, people: updatedPeople } : prev));
    } catch (err) {
      console.error('Failed to remove person from photo', err);
      toast.showError('Failed to remove person from photo');
    } finally {
      setRemovingPersonId(null);
    }
  };

  const handleToggleFeatured = async () => {
    if (!photo || !canFeatureMedia) return;

    const nextFeaturedState = !photo.is_featured;
    try {
      await setPhotoFeatured(photo.id, nextFeaturedState);
      await haptics.light();

      setPhoto((prev) => (prev ? { ...prev, is_featured: nextFeaturedState } : prev));
      setAllPhotos((prev) => prev.map((p) => (
        p.id === photo.id ? { ...p, is_featured: nextFeaturedState } : p
      )));

      toast.showSuccess(nextFeaturedState ? 'Photo marked as featured' : 'Featured status removed');
      setShowMobileMenu(false);
    } catch (err) {
      console.error('Failed to update featured status:', err);
      await haptics.error();
      toast.showError('Failed to update featured status. You may need admin access.');
    }
  };

  const handleDeletePhoto = async () => {
    if (!photo || !canDeleteMedia || !slug) return;

    const confirmed = await confirm(
      'Delete Photo',
      'Are you sure you want to delete this photo? This action cannot be undone.',
      { variant: 'danger' }
    );

    if (!confirmed) return;

    const currentPhotoId = photo.id;

    try {
      await deletePhoto(currentPhotoId);
      await haptics.success();
      toast.showSuccess('Photo deleted successfully');
      setShowMobileMenu(false);

      // Immediately stop and detach any playing video so its audio/frame
      // can never linger after the item it belongs to has been deleted and
      // we've navigated away from it (React unmounting the <video> element
      // later in the same tick isn't always enough to stop playback
      // instantly, e.g. right after deleting a video itself).
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }

      const remainingPhotos = allPhotos.filter((p) => p.id !== currentPhotoId);
      setAllPhotos(remainingPhotos);
      const remainingDisplayPhotos = fromFavorites && favoritePhotos.length > 0
        ? remainingPhotos.filter((p) => favoritePhotos.some((fav: { id: string; slug: string }) => fav.id === p.id && fav.slug === slug))
        : fromSearch && searchResultIds.length > 0
        ? remainingPhotos.filter((p) => searchResultIds.includes(p.id))
        : fromTimeline && timelinePhotoIds.length > 0
        ? remainingPhotos.filter((p) => timelinePhotoIds.includes(p.id))
        : remainingPhotos;

      if (remainingDisplayPhotos.length > 0) {
        const currentDisplayIndex = Math.max(0, (displayPhotos.length > 0 ? displayPhotos : allPhotos).findIndex((p) => p.id === currentPhotoId));
        const nextIndex = Math.min(currentDisplayIndex, remainingDisplayPhotos.length - 1);
        const nextPhoto = remainingDisplayPhotos[nextIndex];

        // Set the next photo's state synchronously here instead of relying
        // solely on the photoId-driven effect below (which only fires on
        // the *next* render once the URL has updated). Without this, there
        // is a render where `allPhotos` already excludes the deleted photo
        // but `photo` still refers to it, which can briefly re-render the
        // deleted media (e.g. a video) before the effect catches up.
        setPreviousPhoto(null);
        setCurrentIndex(nextIndex);
        setPhoto(nextPhoto);
        setImageLoaded(false);
        setVideoProgress(0);
        setVideoBuffered(0);
        setVideoDuration(0);
        setVideoBuffering(false);
        setVideoPaused(false);

        navigate(`/p/${slug}/${nextPhoto.id}`, {
          replace: true,
          state: location.state,
        });
      } else {
        navigate(fromFavorites ? '/favorites' : fromTimeline ? '/timeline' : fromSearch ? searchUrl : `/events/${slug}`, { replace: true });
      }
    } catch (err) {
      console.error('Failed to delete photo:', err);
      await haptics.error();
      toast.showError('Failed to delete photo. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded">
          {error}
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">{event?.name}</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">This photo is password protected. Please enter the event password to view it.</p>
          
          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-4"
              required
            />
            
            {loginError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
                {loginError}
              </div>
            )}
            
            <button
              type="submit"
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Unlock Photo
            </button>
          </form>
          
          <Link to="/events" className="block mt-4 text-center text-blue-600 hover:text-blue-700">
            ← Back to Events
          </Link>
        </div>
      </div>
    );
  }

  const structuredData = photo ? {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    contentUrl: getPreviewUrl(slug!, photo.id, photo.file_type, photo.cache_version),
    name: `Photo from ${event?.name}`,
    caption: `Photo from ${event?.name} event${photo.city ? ` in ${photo.city}` : ''}`,
    creator: {
      '@type': 'Person',
      name: config.brandName
    },
    datePublished: photo.capture_time || photo.uploaded_at,
    uploadDate: photo.uploaded_at,
    exifData: [
      photo.camera_model && { '@type': 'PropertyValue', name: 'Camera', value: photo.camera_model },
      photo.lens_model && { '@type': 'PropertyValue', name: 'Lens', value: photo.lens_model },
      photo.iso && { '@type': 'PropertyValue', name: 'ISO', value: photo.iso },
      photo.aperture && { '@type': 'PropertyValue', name: 'Aperture', value: photo.aperture },
      photo.shutter_speed && { '@type': 'PropertyValue', name: 'Shutter Speed', value: photo.shutter_speed },
      photo.focal_length && { '@type': 'PropertyValue', name: 'Focal Length', value: photo.focal_length }
    ].filter(Boolean)
  } : undefined;

  const photoDescription = photo
    ? `Photo from ${event?.name}${photo.city ? ` in ${photo.city}` : ''}. ${photo.camera_model ? `Shot with ${photo.camera_model}${photo.lens_model ? ` and ${photo.lens_model}` : ''}.` : ''}`
    : '';

  return (
    <div className="fixed inset-0 bg-black z-50 overflow-hidden" ref={containerRef} style={{ overscrollBehavior: 'none' }} data-no-pull-refresh>
      {ConfirmDialog}
      {photo && (
        <SEO
          title={`Photo from ${event?.name} - ${config.appName}`}
          description={photoDescription}
          keywords={`${event?.name}, photo, ${photo.city || ''}, event photography, ${photo.camera_model || ''}`}
          url={`${window.location.origin}/events/${slug}/${photoId}`}
          type="article"
          image={getPreviewUrl(slug!, photo.id, photo.file_type, photo.cache_version)}
          structuredData={structuredData}
        />
      )}

      {/* Full-screen media area */}
      <div
        ref={imageContainerCallbackRef}
        className={`absolute inset-0 flex items-center justify-center select-none overflow-hidden`}
        style={{
          touchAction: isNative ? 'none' : ((isZoomed || isNativeViewportZoomed) ? 'pan-x pan-y pinch-zoom' : 'pan-y pinch-zoom'),
          overscrollBehavior: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* Swipe preview photo */}
        {showSwipePreview && swipePreviewPhoto && swipePreviewUrl && (
          <div
            className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none"
            style={{
              transform: swipeOffset < 0
                ? `translate3d(calc(100% + ${swipeOffset}px), 0, 0)`
                : `translate3d(calc(-100% + ${swipeOffset}px), 0, 0)`,
              transition: isSwiping ? 'none' : 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease-out',
              opacity: Math.min(1, Math.max(0.38, Math.abs(swipeOffset) / 180)),
              willChange: 'transform, opacity',
            }}
          >
            {swipePreviewPhoto.file_type === 'video/mp4' ? (
              <div className="relative flex items-center justify-center w-full h-full">
                <img
                  src={swipePreviewPhoto.blur_placeholder || ''}
                  alt={swipePreviewPhoto.original_filename}
                  className={`max-w-full max-h-full object-contain ${swipePreviewPhoto.blur_placeholder ? 'blur-lg' : ''}`}
                  draggable={false}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-black/50 backdrop-blur-sm rounded-full p-4">
                    <Play className="w-8 h-8 text-white fill-white" />
                  </div>
                </div>
              </div>
            ) : (
              <img
                src={swipePreviewUrl}
                alt={swipePreviewPhoto.original_filename}
                className="max-w-full max-h-full object-contain"
                draggable={false}
              />
            )}
          </div>
        )}

        {/* Current media with slide animation */}
        <div
          key={`${photo?.id}-${slideDirection}`}
          className={`relative z-10 flex items-center justify-center w-full h-full ${
            slideDirection === 'left' ? 'animate-slide-in-right' :
            slideDirection === 'right' ? 'animate-slide-in-left' : ''
          }`}
          style={{
            transform: `translate3d(${swipeOffset}px, 0, 0)`,
            transition: isSwiping ? 'none' : 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease-out',
            opacity: Math.max(0.88, 1 - Math.abs(swipeOffset) / 1200),
            willChange: 'transform, opacity',
          }}
        >
          {showEditor ? (
            <div className="w-full h-full" />
          ) : photo?.file_type === 'video/mp4' ? (
            <div
              className="relative w-full h-full flex items-center justify-center"
              onClick={handleVideoTap}
              onTouchEnd={(e) => {
                if (!videoProgressDraggingRef.current) {
                  handleVideoTap(e);
                }
                e.preventDefault();
              }}
            >
              <video
                ref={videoRef}
                src={getPreviewUrl(slug!, photo?.id || photoId!, photo?.file_type, photo?.cache_version)}
                autoPlay
                muted={videoMuted}
                playsInline
                loop={!isSlideshow}
                preload="metadata"
                poster={photo?.blur_placeholder || undefined}
                className="max-w-full max-h-full object-contain"
                onTimeUpdate={handleVideoTimeUpdate}
                onWaiting={() => setVideoBuffering(true)}
                onStalled={() => setVideoBuffering(true)}
                onCanPlay={() => setVideoBuffering(false)}
                onPlaying={() => setVideoBuffering(false)}
                onLoadedMetadata={(e) => {
                  setVideoDuration(e.currentTarget.duration);
                  setVideoPaused(false);
                  resetVideoControlsTimer();
                }}
                onPlay={() => {
                  setVideoPaused(false);
                  resetVideoControlsTimer();
                }}
                onPause={() => {
                  setVideoPaused(true);
                  setShowOverlay(true);
                }}
                onEnded={() => {
                  // Slideshow mode: the shared advance-timer effect never
                  // fires for videos (it gates on `imageLoaded`, which only
                  // ever gets set true by the <img> branch's onLoad below),
                  // so without this, a looping video (see `loop` above)
                  // would just repeat forever and never let the slideshow
                  // continue to the next photo/video — including on a
                  // connected Cast receiver, which mirrors whatever photo is
                  // currently displayed here.
                  if (isSlideshow) {
                    navigateNextRef.current?.();
                  }
                }}
                onError={handleVideoError}
              />

              {/* Double-tap seek indicators */}
              {seekIndicator === 'left' && (
                <div className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/60 backdrop-blur-sm rounded-full px-4 py-3 text-white text-sm font-medium animate-fade-in pointer-events-none flex items-center gap-1.5">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.334 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" /></svg>
                  10s
                </div>
              )}
              {seekIndicator === 'right' && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/60 backdrop-blur-sm rounded-full px-4 py-3 text-white text-sm font-medium animate-fade-in pointer-events-none flex items-center gap-1.5">
                  10s
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" /></svg>
                </div>
              )}

              {/* Center play/pause indicator */}
              {videoPaused && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black/50 backdrop-blur-sm rounded-full p-5">
                    <Play className="w-10 h-10 text-white fill-white" />
                  </div>
                </div>
              )}
              {/* Buffering spinner — shown while the video is waiting for data */}
              {videoBuffering && !videoPaused && !videoError && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                </div>
              )}
              {/* Playback error — shown after auto-retries are exhausted */}
              {videoError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white gap-3">
                  <Info className="w-8 h-8 opacity-70" />
                  <p className="text-sm opacity-90">This video couldn't be played</p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleVideoManualRetry();
                    }}
                    className="px-4 py-2 bg-white/15 hover:bg-white/25 rounded-full text-sm font-medium transition"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div
              className="relative w-full h-full flex items-center justify-center"
              onClick={() => { if (zoomScale <= 1) setShowOverlay(prev => !prev); }}
              style={{
                transform: `scale(${zoomScale}) translate(${zoomTranslate.x / zoomScale}px, ${zoomTranslate.y / zoomScale}px)`,
                transition: isPinching.current || isPanning.current ? 'none' : 'transform 0.2s ease-out',
                transformOrigin: 'center center',
              }}
            >
              {/* Previous photo for cross-fade effect */}
              {previousPhoto && previousPhoto.file_type !== 'video/mp4' && (
                <img
                  src={getPreviewUrl(slug!, previousPhoto.id, previousPhoto.file_type, previousPhoto.cache_version)}
                  alt="Previous"
                  className={`max-w-full max-h-full object-contain absolute transition-opacity duration-300 ${
                    imageLoaded ? 'opacity-0' : 'opacity-100'
                  }`}
                />
              )}

              {/* Blur placeholder */}
              {photo?.blur_placeholder && !imageLoaded && (
                <img
                  src={photo.blur_placeholder}
                  alt="Loading..."
                  className="max-w-full max-h-full object-contain blur-xl transition-opacity duration-200"
                />
              )}

              {/* Main image */}
              <img
                src={getPreviewUrl(slug!, photo?.id || photoId!, photo?.file_type, cacheBuster || photo?.cache_version)}
                alt={photo?.original_filename}
                className={`max-w-full max-h-full object-contain transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'} ${photo?.blur_placeholder && !imageLoaded ? 'absolute' : ''}`}
                onLoad={() => setImageLoaded(true)}
                loading="eager"
                decoding="async"
                fetchPriority="high"
              />
            </div>
          )}
        </div>
      </div>

      {/* Top overlay bar */}
      <div
        className={`absolute top-0 inset-x-0 z-30 transition-all duration-300 ${
          showOverlay && !showInfoSheet ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'
        }`}
      >
        <div className="bg-gradient-to-b from-black/80 via-black/40 to-transparent px-4 pb-12 pt-3">
          <div className="flex items-center justify-between">
            {/* Back button */}
            <button
              onClick={() => navigate(fromFavorites ? '/favorites' : fromTimeline ? '/timeline' : fromSearch ? searchUrl : `/events/${slug}`)}
              className="text-white p-2 -ml-2 hover:bg-white/10 rounded-full transition"
              aria-label="Back"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>

            {/* Photo counter */}
            {currentIndex >= 0 && (
              <div className="text-white/90 text-sm font-medium">
                {fromFavorites && favoritePhotos.length > 0
                  ? `${(favoritePhotos.findIndex((fav: { id: string; slug: string }) => fav.id === photoId && fav.slug === slug) + 1) || 1} / ${favoritePhotos.length}`
                  : `${currentIndex + 1} / ${displayPhotos.length > 0 ? displayPhotos.length : allPhotos.length}`
                }
                {fromFavorites && <span className="ml-1 text-red-400">♥</span>}
              </div>
            )}

            {/* More menu */}
            <div className="relative">
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="text-white p-2 -mr-2 hover:bg-white/10 rounded-full transition"
                aria-label="More options"
              >
                <MoreVertical className="w-6 h-6" />
              </button>

              {showMobileMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowMobileMenu(false)} />
                  <div className="absolute top-full right-0 mt-1 z-40 bg-gray-800/95 backdrop-blur-md rounded-xl shadow-2xl border border-white/10 py-1.5 min-w-[220px]">
                    <button
                      onClick={() => {
                        setShowMobileMenu(false);
                        toggleSlideshow();
                      }}
                      className="w-full px-4 py-2.5 text-white text-sm font-medium flex items-center gap-3 hover:bg-white/10 transition"
                    >
                      {isSlideshow ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                      {isSlideshow ? 'Stop Slideshow' : 'Start Slideshow'}
                    </button>

                    {isSlideshow && (
                      <div className="px-4 py-2 space-y-1">
                        <div className="text-gray-400 text-xs mb-1">Speed</div>
                        {[{ label: 'Fast (2s)', ms: 2000 }, { label: 'Normal (3s)', ms: 3000 }, { label: 'Slow (5s)', ms: 5000 }, { label: 'Very Slow (10s)', ms: 10000 }].map(opt => (
                          <button
                            key={opt.ms}
                            onClick={() => setSlideshowSpeed(opt.ms)}
                            className={`w-full px-3 py-1.5 text-left text-xs rounded transition ${
                              slideshowSpeed === opt.ms ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => {
                        setShowMobileMenu(false);
                        toggleFullscreen();
                      }}
                      className="w-full px-4 py-2.5 text-white text-sm font-medium flex items-center gap-3 hover:bg-white/10 transition"
                    >
                      {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                      {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                    </button>

                    <button
                      onClick={() => {
                        setShowMobileMenu(false);
                        setShowKeyboardHelp(true);
                      }}
                      className="w-full px-4 py-2.5 text-white text-sm font-medium flex items-center gap-3 hover:bg-white/10 transition"
                    >
                      <span className="w-5 h-5 flex items-center justify-center text-base font-bold">?</span>
                      Keyboard Shortcuts
                    </button>

                    {canEditMedia && (
                      <>
                        <div className="my-1.5 border-t border-white/10" />
                        <button
                          onClick={() => {
                            setShowMobileMenu(false);
                            setShowEditor(true);
                          }}
                          className="w-full px-4 py-2.5 text-white text-sm font-medium flex items-center gap-3 hover:bg-white/10 transition"
                        >
                          <Pencil className="w-5 h-5" />
                          Edit {photo?.file_type === 'video/mp4' ? 'Video' : 'Photo'}
                        </button>

                        {canFeatureMedia && (
                          <button
                            onClick={() => {
                              setShowMobileMenu(false);
                              void handleToggleFeatured();
                            }}
                            className="w-full px-4 py-2.5 text-white text-sm font-medium flex items-center gap-3 hover:bg-white/10 transition"
                          >
                            <Star className={`w-5 h-5 ${photo?.is_featured ? 'fill-yellow-400 text-yellow-400' : ''}`} />
                            {photo?.is_featured ? 'Unfeature' : 'Feature'}
                          </button>
                        )}

                        {canDeleteMedia && (
                          <button
                            onClick={() => {
                              setShowMobileMenu(false);
                              void handleDeletePhoto();
                            }}
                            className="w-full px-4 py-2.5 text-red-400 text-sm font-medium flex items-center gap-3 hover:bg-red-500/10 transition"
                          >
                            <Trash2 className="w-5 h-5" />
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom overlay bar */}
      <div
        className={`absolute bottom-0 inset-x-0 z-30 transition-all duration-300 ${
          showOverlay && !showInfoSheet ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pt-12 pb-4 pb-safe">
          {/* Video controls */}
          {photo?.file_type === 'video/mp4' && (
            <div
              className="mb-3"
              onClick={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              {/* Progress bar */}
              <div
                className="relative h-8 flex items-center cursor-pointer group/progress touch-none"
                onMouseDown={(e) => {
                  videoProgressDraggingRef.current = true;
                  handleVideoSeek(e, e.currentTarget as HTMLDivElement);
                  const bar = e.currentTarget as HTMLDivElement;
                  const onMove = (ev: MouseEvent) => handleVideoSeek(ev as unknown as React.MouseEvent, bar);
                  const onUp = () => {
                    videoProgressDraggingRef.current = false;
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                  };
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }}
                onTouchStart={(e) => {
                  videoProgressDraggingRef.current = true;
                  handleVideoSeek(e, e.currentTarget as HTMLDivElement);
                }}
                onTouchMove={(e) => {
                  if (videoProgressDraggingRef.current) {
                    handleVideoSeek(e, e.currentTarget as HTMLDivElement);
                  }
                }}
                onTouchEnd={() => {
                  videoProgressDraggingRef.current = false;
                }}
              >
                <div className="absolute left-0 right-0 h-1 group-hover/progress:h-1.5 bg-white/30 rounded-full transition-all">
                  {/* Buffered */}
                  <div
                    className="absolute top-0 left-0 h-full bg-white/40 rounded-full"
                    style={{ width: videoDuration ? `${(videoBuffered / videoDuration) * 100}%` : '0%' }}
                  />
                  {/* Progress */}
                  <div
                    className="absolute top-0 left-0 h-full bg-white rounded-full"
                    style={{ width: videoDuration ? `${(videoProgress / videoDuration) * 100}%` : '0%' }}
                  />
                </div>
                {/* Scrubber handle */}
                <div
                  className="absolute w-3.5 h-3.5 bg-white rounded-full shadow-lg -translate-x-1/2 opacity-0 group-hover/progress:opacity-100 transition-opacity"
                  style={{ left: videoDuration ? `${(videoProgress / videoDuration) * 100}%` : '0%' }}
                />
              </div>

              {/* Time + controls row */}
              <div className="flex items-center justify-between text-white text-xs">
                <div className="flex items-center gap-3">
                  <button
                    className="p-1.5 hover:bg-white/20 rounded-full transition"
                    onClick={(e) => {
                      e.stopPropagation();
                      const v = videoRef.current;
                      if (!v) return;
                      if (v.paused) { v.play(); setVideoPaused(false); }
                      else { v.pause(); setVideoPaused(true); }
                      resetVideoControlsTimer();
                    }}
                  >
                    {videoPaused ? <Play className="w-5 h-5 fill-white" /> : <Pause className="w-5 h-5" />}
                  </button>
                  <span className="tabular-nums">{formatTime(videoProgress)} / {formatTime(videoDuration)}</span>
                </div>
                <button
                  className="p-1.5 hover:bg-white/20 rounded-full transition"
                  onClick={(e) => {
                    e.stopPropagation();
                    setVideoMuted((m) => !m);
                  }}
                >
                  {videoMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-around">
            <button
              onClick={toggleFavorite}
              className="flex flex-col items-center gap-1 text-white/90 p-2 hover:bg-white/10 rounded-xl transition active:scale-95"
            >
              <Heart className={`w-6 h-6 ${isFavorited ? 'fill-red-500 text-red-500' : ''}`} />
              <span className="text-[10px] font-medium">{isFavorited ? 'Saved' : 'Favorite'}</span>
            </button>

            <button
              onClick={() => sharePhoto()}
              className="flex flex-col items-center gap-1 text-white/90 p-2 hover:bg-white/10 rounded-xl transition active:scale-95"
            >
              <Share2 className="w-6 h-6" />
              <span className="text-[10px] font-medium">Share</span>
            </button>

            <CastButton
              slug={slug!}
              getMedia={() => ({
                type: photo?.file_type === 'video/mp4' ? 'video' : 'photo',
                url: photo ? getCastPreviewUrl(slug!, photo.id, photo.file_type, photo.cache_version) : '',
                title: photo?.original_filename,
              })}
            />

            <div className="relative">
              <button
                onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                className="flex flex-col items-center gap-1 text-white/90 p-2 hover:bg-white/10 rounded-xl transition active:scale-95"
              >
                <Download className="w-6 h-6" />
                <span className="text-[10px] font-medium">Download</span>
              </button>

              {showDownloadMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowDownloadMenu(false)} />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-40 bg-gray-800/95 backdrop-blur-md rounded-xl shadow-2xl border border-white/10 py-1.5 min-w-[180px]">
                    <button
                      onClick={() => { handleDownloadOriginal(); setShowDownloadMenu(false); }}
                      className="w-full px-4 py-2.5 text-white text-sm font-medium flex items-center gap-3 hover:bg-white/10 transition"
                    >
                      <span className="text-blue-400">●</span> Original
                    </button>
                    {photo?.file_type !== 'video/mp4' && (
                      <>
                        <button
                          onClick={() => { handleDownloadSmall(); setShowDownloadMenu(false); }}
                          className="w-full px-4 py-2.5 text-white text-sm font-medium flex items-center gap-3 hover:bg-white/10 transition"
                        >
                          <span className="text-purple-400">●</span> Small
                        </button>
                        <button
                          onClick={() => { handleDownloadInstagram(); setShowDownloadMenu(false); }}
                          className="w-full px-4 py-2.5 text-white text-sm font-medium flex items-center gap-3 hover:bg-white/10 transition"
                        >
                          <span className="text-pink-400">●</span> Instagram
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => { setShowInfoSheet(true); setShowOverlay(false); }}
              className="flex flex-col items-center gap-1 text-white/90 p-2 hover:bg-white/10 rounded-xl transition active:scale-95"
            >
              <Info className="w-6 h-6" />
              <span className="text-[10px] font-medium">Info</span>
            </button>
          </div>
        </div>
      </div>

      {/* Info Bottom Sheet */}
      {showInfoSheet && (
        <div className="fixed inset-0 z-40" onClick={() => setShowInfoSheet(false)}>
          <div className="absolute inset-0 bg-black/60 transition-opacity" />
          <div
            className="absolute bottom-0 inset-x-0 max-h-[85vh] bg-gray-900 rounded-t-2xl overflow-hidden flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet header */}
            <div className="sticky top-0 bg-gray-900 px-4 py-3 border-b border-white/10 shrink-0">
              <div className="w-10 h-1 bg-gray-600 rounded-full mx-auto mb-3" />
              <div className="flex items-center justify-between">
                <h3 className="text-white text-lg font-semibold">Details</h3>
                <button
                  onClick={() => setShowInfoSheet(false)}
                  className="text-gray-400 hover:text-white p-1 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Sheet content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Photo Info */}
              <div>
                <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                  📷 Photo Info
                  {photo?.favorites_count && photo.favorites_count > 0 ? (
                    <span className="flex items-center gap-1 text-red-500 text-sm ml-auto">
                      <Heart className="w-4 h-4 fill-current" />
                      {photo.favorites_count}
                    </span>
                  ) : null}
                </h4>
                <dl className="space-y-2.5 text-sm">
                  <div>
                    <dt className="text-gray-500 text-xs">Captured</dt>
                    <dd className="text-white">{photo?.capture_time ? new Date(photo.capture_time).toLocaleString() : 'Unknown'}</dd>
                  </div>
                  {photo?.width && photo?.height && (
                    <div>
                      <dt className="text-gray-500 text-xs">Dimensions</dt>
                      <dd className="text-white">{photo.width} × {photo.height} pixels</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-gray-500 text-xs">Filename</dt>
                    <dd className="text-white text-xs break-all">{photo?.original_filename}</dd>
                  </div>
                  {photo?.uploader_name && (
                    <div>
                      <dt className="text-gray-500 text-xs">Uploaded by</dt>
                      <dd className="text-white text-xs">{photo.uploader_name}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* People tagged on this photo */}
              {((photo?.people && photo.people.length > 0) || canEditMedia) && (
                <div>
                  <h4 className="text-white font-medium mb-3 flex items-center gap-2">
                    <Users className="w-4 h-4" /> People
                  </h4>
                  {photo?.people && photo.people.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {photo.people.map((p) => (
                        <span
                          key={p.id}
                          className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-gray-800 text-white text-sm rounded-full"
                        >
                          {p.name}
                          {canEditMedia && (
                            <button
                              onClick={() => handleRemovePersonFromPhoto(p.id)}
                              disabled={removingPersonId === p.id}
                              className="text-gray-400 hover:text-white disabled:opacity-50 rounded-full p-0.5 hover:bg-white/10 transition"
                              aria-label={`Remove ${p.name} from this photo`}
                              title={`Remove ${p.name} from this photo`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm mb-2">No one tagged yet.</p>
                  )}
                  {canEditMedia && (
                    <button
                      onClick={handleOpenPeopleEditor}
                      className="text-blue-400 hover:text-blue-300 text-xs font-medium transition"
                    >
                      {photo?.people && photo.people.length > 0 ? 'Edit people' : 'Tag people'}
                    </button>
                  )}
                </div>
              )}

              {/* Camera Settings */}
              {(photo?.iso || photo?.aperture || photo?.shutter_speed || photo?.focal_length) && (
                <div>
                  <h4 className="text-white font-medium mb-3">⚙️ Camera Settings</h4>
                  <dl className="grid grid-cols-2 gap-2.5 text-sm">
                    {photo.iso && (
                      <div>
                        <dt className="text-gray-500 text-xs">ISO</dt>
                        <dd className="text-white">{photo.iso}</dd>
                      </div>
                    )}
                    {photo.aperture && (
                      <div>
                        <dt className="text-gray-500 text-xs">Aperture</dt>
                        <dd className="text-white">{photo.aperture}</dd>
                      </div>
                    )}
                    {photo.shutter_speed && (
                      <div>
                        <dt className="text-gray-500 text-xs">Exposure Time</dt>
                        <dd className="text-white">{photo.shutter_speed}</dd>
                      </div>
                    )}
                    {photo.focal_length && (
                      <div>
                        <dt className="text-gray-500 text-xs">Focal Length</dt>
                        <dd className="text-white">{photo.focal_length}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Equipment */}
              {(photo?.camera_make || photo?.camera_model || photo?.lens_model) && (
                <div>
                  <h4 className="text-white font-medium mb-3">📸 Equipment</h4>
                  <dl className="space-y-2.5 text-sm">
                    {(photo.camera_make || photo.camera_model) && (
                      <div>
                        <dt className="text-gray-500 text-xs">Device Model</dt>
                        <dd className="text-white">{[photo.camera_make, photo.camera_model].filter(Boolean).join(' ')}</dd>
                      </div>
                    )}
                    {photo.lens_model && (
                      <div>
                        <dt className="text-gray-500 text-xs">Lens</dt>
                        <dd className="text-white break-all">{photo.lens_model}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              {/* Download section */}
              <div>
                <h4 className="text-white font-medium mb-3">💾 Download</h4>
                <div className="flex gap-2.5">
                  <button
                    onClick={handleDownloadOriginal}
                    className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition active:scale-[0.98]"
                  >
                    Original
                  </button>
                  {photo?.file_type !== 'video/mp4' && (
                    <>
                      <button
                        onClick={handleDownloadSmall}
                        className="flex-1 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition active:scale-[0.98]"
                      >
                        Small
                      </button>
                      <button
                        onClick={handleDownloadInstagram}
                        className="flex-1 py-2.5 bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500 text-white rounded-lg text-sm font-medium hover:opacity-90 transition active:scale-[0.98]"
                      >
                        Instagram
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Editor Modal */}
      {showEditor && photo && slug && photo.file_type !== 'video/mp4' && (
        <EditorErrorBoundary onClose={() => setShowEditor(false)}>
          <Suspense fallback={
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-900">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
                <p className="mt-4 text-gray-400">Loading editor...</p>
              </div>
            </div>
          }>
            <ImageEditorModal
              imageUrl={getOriginalUrl(slug, photo.id, photo.file_type, cacheBuster || photo.cache_version)}
              nativeWidth={photo.width ?? undefined}
              nativeHeight={photo.height ?? undefined}
              onSave={handleEditorSave}
              onClose={() => setShowEditor(false)}
            />
          </Suspense>
        </EditorErrorBoundary>
      )}

      {/* Video Editor Modal */}
      {showEditor && photo && slug && photo.file_type === 'video/mp4' && (
        <EditorErrorBoundary onClose={() => setShowEditor(false)}>
          <Suspense fallback={
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-900">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
                <p className="mt-4 text-gray-400">Loading video editor...</p>
              </div>
            </div>
          }>
            <VideoEditorModal
              videoUrl={getOriginalUrl(slug, photo.id, photo.file_type, cacheBuster || photo.cache_version)}
              onSave={handleEditorSave}
              onClose={() => setShowEditor(false)}
            />
          </Suspense>
        </EditorErrorBoundary>
      )}

      {/* Tag People Modal */}
      {showPeopleEditor && (
        <div
          className="fixed inset-0 bg-black/75 flex items-center justify-center z-[100] p-4"
          onClick={() => !savingPeopleTags && setShowPeopleEditor(false)}
        >
          <div
            className="bg-gray-800 rounded-lg p-6 max-w-md w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5" /> Tag people
              </h2>
              <button
                onClick={() => setShowPeopleEditor(false)}
                disabled={savingPeopleTags}
                className="text-gray-400 hover:text-white disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <input
              type="text"
              value={peopleSearchQuery}
              onChange={(e) => setPeopleSearchQuery(e.target.value)}
              placeholder="Search people..."
              className="mb-3 w-full px-3 py-2 bg-gray-700 text-white rounded-lg text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
            />

            <div className="flex-1 overflow-y-auto space-y-1 -mx-1 px-1">
              {namedPeopleLoading ? (
                <p className="text-gray-400 text-sm py-4 text-center">Loading people...</p>
              ) : namedPeople.length === 0 ? (
                <p className="text-gray-400 text-sm py-4 text-center">
                  No named people yet — name someone in Admin → People first.
                </p>
              ) : (
                namedPeople
                  .filter((p) => p.name.toLowerCase().includes(peopleSearchQuery.trim().toLowerCase()))
                  .map((p) => {
                    const selected = selectedPersonIds.has(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleTogglePersonSelection(p.id)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition ${
                          selected ? 'bg-blue-600 text-white' : 'bg-gray-700/60 text-gray-200 hover:bg-gray-700'
                        }`}
                      >
                        <span>{p.name}</span>
                        {selected && <Check className="w-4 h-4 shrink-0" />}
                      </button>
                    );
                  })
              )}
            </div>

            <div className="flex gap-2.5 mt-4 shrink-0">
              <button
                onClick={() => setShowPeopleEditor(false)}
                disabled={savingPeopleTags}
                className="flex-1 py-2.5 bg-gray-700 text-white rounded-lg text-sm font-medium hover:bg-gray-600 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePeopleTags}
                disabled={savingPeopleTags}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >
                {savingPeopleTags ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Help Modal */}
      {showKeyboardHelp && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-[100] p-4" onClick={() => setShowKeyboardHelp(false)}>
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">⌨️ Keyboard Shortcuts</h2>
              <button onClick={() => setShowKeyboardHelp(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Navigate photos</span>
                <span className="bg-gray-700 px-3 py-1 rounded text-white font-mono">← →</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Play/Pause slideshow</span>
                <span className="bg-gray-700 px-3 py-1 rounded text-white font-mono">SPACE</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Toggle fullscreen</span>
                <span className="bg-gray-700 px-3 py-1 rounded text-white font-mono">F</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Show details</span>
                <span className="bg-gray-700 px-3 py-1 rounded text-white font-mono">I</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Show this help</span>
                <span className="bg-gray-700 px-3 py-1 rounded text-white font-mono">? or H</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Exit / Go back</span>
                <span className="bg-gray-700 px-3 py-1 rounded text-white font-mono">ESC</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PhotoDetail;
