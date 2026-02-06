import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { Maximize, Minimize, Share2, X, Heart, Play, Pause } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import SEO from '../components/SEO';
import { getEvent, getPhoto, getPhotos, loginToEvent, getPreviewUrl, downloadOriginal, downloadSmall } from '../api';
import type { Event, Photo } from '../types';

const PhotoDetail: React.FC = () => {
  const { slug, photoId } = useParams<{ slug: string; photoId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [event, setEvent] = useState<Event | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [allPhotos, setAllPhotos] = useState<Photo[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [isSlideshow, setIsSlideshow] = useState(false);
  const [slideshowSpeed, setSlideshowSpeed] = useState(3000); // milliseconds
  const [showSlideshowSettings, setShowSlideshowSettings] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const slideshowTimerRef = useRef<number | null>(null);

  // Check if we came from favorites page
  const fromFavorites = location.state?.fromFavorites;
  const favoritePhotos = (location.state?.favoritePhotos || []) as Array<{ id: string; slug: string }>;
  
  // Filter photos based on whether we're viewing favorites
  // When in favorites mode, only show photos from this event that are in favorites
  const displayPhotos = fromFavorites && favoritePhotos.length > 0
    ? allPhotos.filter(p => favoritePhotos.some((fav: { id: string; slug: string }) => fav.id === p.id && fav.slug === slug))
    : allPhotos;

  useEffect(() => {
    if (slug && photoId) {
      loadPhoto();
    }
  }, [slug]);

  // Update photo when photoId changes in URL (for browser back/forward)
  useEffect(() => {
    if (photoId && allPhotos.length > 0) {
      const photosToUse = displayPhotos.length > 0 ? displayPhotos : allPhotos;
      const index = photosToUse.findIndex(p => p.id === photoId);
      if (index >= 0 && index !== currentIndex) {
        setCurrentIndex(index);
        const photoInList = photosToUse[index];
        if (photoInList) {
          setPhoto(photoInList);
          setImageLoaded(false); // Reset for new image
        }
      }
    }
  }, [photoId, allPhotos, displayPhotos]);

  // Check if current photo is favorited
  useEffect(() => {
    if (photo) {
      const favoritesStr = localStorage.getItem('user_favorites');
      if (favoritesStr) {
        const favorites = JSON.parse(favoritesStr) as Array<{ photoId: string; slug: string; timestamp: number }>;
        setIsFavorited(favorites.some(f => f.photoId === photo.id));
      } else {
        setIsFavorited(false);
      }
    }
  }, [photo]);

  // Slideshow timer
  useEffect(() => {
    if (isSlideshow && imageLoaded) {
      slideshowTimerRef.current = setTimeout(() => {
        navigateToNext();
      }, slideshowSpeed);
    }
    
    return () => {
      if (slideshowTimerRef.current) {
        clearTimeout(slideshowTimerRef.current);
      }
    };
  }, [isSlideshow, currentIndex, slideshowSpeed, imageLoaded]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') navigateToPrevious();
      if (e.key === 'ArrowRight') navigateToNext();
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        toggleSlideshow();
      }
      if (e.key === 'Escape') {
        if (isSlideshow) {
          setIsSlideshow(false);
        } else if (isFullscreen) {
          exitFullscreen();
        } else {
          navigate(fromFavorites ? '/favorites' : `/events/${slug}`);
        }
      }
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      if (e.key === 'i' || e.key === 'I') setShowDetails(!showDetails);
      if (e.key === '?' || e.key === 'h' || e.key === 'H') setShowKeyboardHelp(!showKeyboardHelp);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, displayPhotos, slug, isFullscreen, showDetails, showKeyboardHelp, fromFavorites, isSlideshow]);

  const loadPhoto = async () => {
    try {
      setLoading(true);
      const eventData = await getEvent(slug!);
      setEvent(eventData);
      
      try {
        const photoData = await getPhoto(slug!, photoId!);
        setPhoto(photoData);
        setAuthenticated(true);
        
        // Load all photos for navigation
        const allPhotosData = await getPhotos(slug!);
        setAllPhotos(allPhotosData);
        
        // Find index in the appropriate list
        const photosToUse = fromFavorites && favoritePhotos.length > 0
          ? allPhotosData.filter(p => favoritePhotos.some((fav: { id: string; slug: string }) => fav.id === p.id && fav.slug === slug))
          : allPhotosData;
        const index = photosToUse.findIndex(p => p.id === photoId);
        setCurrentIndex(index);
        
        // Update photo with the version from allPhotos which includes all EXIF data
        if (index >= 0 && photosToUse[index]) {
          setPhoto(photosToUse[index]);
        }
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
    if (!isSlideshow) {
      setShowDetails(false); // Hide details when starting slideshow
    } else {
      setShowSlideshowSettings(false); // Hide settings when stopping
    }
  };

  const navigateToNext = () => {
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
      const photosToUse = displayPhotos.length > 0 ? displayPhotos : allPhotos;
      if (currentIndex >= 0 && currentIndex < photosToUse.length - 1) {
        const nextIndex = currentIndex + 1;
        const nextPhoto = photosToUse[nextIndex];
        setCurrentIndex(nextIndex);
        setPhoto(nextPhoto);
        setImageLoaded(false);
        window.history.pushState(null, '', `/p/${slug}/${nextPhoto.id}`);
      } else if (currentIndex === photosToUse.length - 1 && photosToUse.length > 0) {
        // Loop back to first photo
        const firstPhoto = photosToUse[0];
        setCurrentIndex(0);
        setPhoto(firstPhoto);
        setImageLoaded(false);
        window.history.pushState(null, '', `/p/${slug}/${firstPhoto.id}`);
      }
    }
  };

  const navigateToPrevious = () => {
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
      const photosToUse = displayPhotos.length > 0 ? displayPhotos : allPhotos;
      if (currentIndex > 0) {
        const prevIndex = currentIndex - 1;
        const prevPhoto = photosToUse[prevIndex];
        setCurrentIndex(prevIndex);
        setPhoto(prevPhoto);
        setImageLoaded(false);
        window.history.pushState(null, '', `/p/${slug}/${prevPhoto.id}`);
      }
    }
  };

  // Touch handlers for swipe gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;
    
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50; // minimum swipe distance
    
    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        // Swiped left - next photo
        navigateToNext();
      } else {
        // Swiped right - previous photo
        navigateToPrevious();
      }
    }
    
    touchStartX.current = null;
    touchEndX.current = null;
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const exitFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const sharePhoto = async (platform?: string) => {
    const url = `${window.location.origin}/p/${slug}/${photoId}`;
    const text = `Check out this photo from ${event?.name}`;
    
    // Use native share API on mobile if available and no platform specified
    if (!platform && 'share' in navigator) {
      try {
        // Try to fetch and share the photo file
        const imageUrl = getPreviewUrl(slug!, photo?.id || photoId!);
        const shareData: any = {
          title: event?.name || 'Photo',
          text: text,
          url: url,
        };
        
        // Try to include the photo if canShare supports files
        try {
          const response = await fetch(imageUrl);
          const blob = await response.blob();
          const fileName = photo?.original_filename || 'photo.jpg';
          const file = new File([blob], fileName, { type: blob.type });
          
          // Check if we can share files
          if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
            shareData.files = [file];
          }
        } catch (err) {
          // Could not include photo file, continue with URL only share
        }
        
        await (navigator as any).share(shareData);
        setShowShareMenu(false);
        return;
      } catch (err) {
        // User cancelled or share failed, fall back to menu
        if ((err as Error).name !== 'AbortError') {
          console.error('Error sharing:', err);
        }
        return;
      }
    }
    
    // Fall back to platform-specific sharing
    switch (platform) {
      case 'twitter':
        window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank');
        break;
      case 'facebook':
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
        break;
      case 'instagram':
        // Instagram doesn't support direct URL sharing, so copy link with instruction
        navigator.clipboard.writeText(url);
        alert('Link copied! Open Instagram and paste in your story or bio.');
        break;
      case 'snapchat':
        // Snapchat web share (limited support)
        window.open(`https://www.snapchat.com/scan?attachmentUrl=${encodeURIComponent(url)}`, '_blank');
        break;
      case 'whatsapp':
        window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank');
        break;
      case 'copy':
        navigator.clipboard.writeText(url);
        alert('Link copied to clipboard!');
        break;
    }
    setShowShareMenu(false);
  };

  const toggleFavorite = () => {
    if (!photo || !slug) return;
    
    const favoritesStr = localStorage.getItem('user_favorites');
    const favorites = favoritesStr ? JSON.parse(favoritesStr) as Array<{ photoId: string; slug: string; timestamp: number }> : [];
    
    const existingIndex = favorites.findIndex(f => f.photoId === photo.id);
    
    if (existingIndex >= 0) {
      // Remove from favorites
      favorites.splice(existingIndex, 1);
      setIsFavorited(false);
    } else {
      // Add to favorites
      favorites.push({ photoId: photo.id, slug, timestamp: Date.now() });
      setIsFavorited(true);
    }
    
    localStorage.setItem('user_favorites', JSON.stringify(favorites));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">{event?.name}</h1>
          <p className="text-gray-600 mb-6">This photo is password protected. Please enter the event password to view it.</p>
          
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
    contentUrl: getPreviewUrl(slug!, photo.id),
    name: `Photo from ${event?.name}`,
    caption: `Photo from ${event?.name} event${photo.city ? ` in ${photo.city}` : ''}`,
    creator: {
      '@type': 'Person',
      name: 'Thijs van Tol'
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
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {photo && (
        <SEO
          title={`Photo from ${event?.name} - Thijs van Tol Photos`}
          description={photoDescription}
          keywords={`${event?.name}, photo, ${photo.city || ''}, event photography, ${photo.camera_model || ''}`}
          url={`https://photos.thijsvtol.nl/events/${slug}/${photoId}`}
          type="article"
          image={getPreviewUrl(slug!, photo.id)}
          structuredData={structuredData}
        />
      )}
      <Navbar />
      {/* Header - Mobile optimized */}
      <div className="sticky top-0 z-50 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3">
          <div className="flex justify-between items-center">
            <button
              onClick={() => navigate(fromFavorites ? '/favorites' : `/events/${slug}`)}
              className="text-white hover:text-gray-300 flex items-center text-sm sm:text-base"
            >
              <span className="text-xl mr-1">←</span>
              <span className="hidden sm:inline">Back to {fromFavorites ? 'Favorites' : 'Gallery'}</span>
              <span className="sm:hidden">Back</span>
            </button>
            
            {/* Photo counter */}
            {currentIndex >= 0 && (
              <div className="text-white text-sm">
                {fromFavorites && favoritePhotos.length > 0
                  ? `${(favoritePhotos.findIndex((fav: { id: string; slug: string }) => fav.id === photoId && fav.slug === slug) + 1) || 1} / ${favoritePhotos.length}`
                  : `${currentIndex + 1} / ${displayPhotos.length > 0 ? displayPhotos.length : allPhotos.length}`
                }
                {fromFavorites && <span className="ml-1 text-red-400">♥</span>}
              </div>
            )}
            
            {/* Desktop download buttons */}
            <div className="hidden md:flex gap-2">
              <button
                onClick={() => downloadOriginal(slug!, photo?.id || photoId!)}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Original
              </button>
              <button
                onClick={() => downloadSmall(slug!, photo?.id || photoId!)}
                className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition text-sm flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Small
              </button>
            </div>
            
            {/* Mobile menu button */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="md:hidden text-white px-3 py-1.5 bg-gray-700 rounded-lg text-sm"
            >
              {showDetails ? 'Hide' : 'Info'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-4">
        {/* Photo viewer with navigation */}
        <div 
          ref={containerRef}
          className={`relative bg-black rounded-lg overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50 rounded-none' : ''}`}
        >
          {/* Action buttons - Desktop only */}
          <div className="hidden md:flex absolute top-4 right-4 z-20 gap-2 items-center">
            {/* Favorite button */}
            <button
              onClick={toggleFavorite}
              className="bg-black/50 hover:bg-black/75 text-white p-2 rounded-full transition backdrop-blur-sm w-9 h-9 flex items-center justify-center"
              aria-label="Favorite"
            >
              <Heart className={`w-5 h-5 ${isFavorited ? 'fill-red-500 text-red-500' : ''}`} />
            </button>
            
            {/* Share button */}
            <div className="relative">
              <button
                onClick={() => setShowShareMenu(!showShareMenu)}
                className="bg-black/50 hover:bg-black/75 text-white p-2 rounded-full transition backdrop-blur-sm w-9 h-9 flex items-center justify-center"
                aria-label="Share"
              >
                <Share2 className="w-5 h-5" />
              </button>
              
              {/* Share menu dropdown */}
              {showShareMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-gray-800 rounded-lg shadow-xl border border-gray-700 overflow-hidden z-30">
                  <button
                    onClick={() => sharePhoto('twitter')}
                    className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition flex items-center gap-2"
                  >
                    <span>🐦</span> Twitter
                  </button>
                  <button
                    onClick={() => sharePhoto('facebook')}
                    className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition flex items-center gap-2"
                  >
                    <span>📘</span> Facebook
                  </button>
                  <button
                    onClick={() => sharePhoto('instagram')}
                    className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition flex items-center gap-2"
                  >
                    <span>📷</span> Instagram
                  </button>
                  <button
                    onClick={() => sharePhoto('snapchat')}
                    className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition flex items-center gap-2"
                  >
                    <span>👻</span> Snapchat
                  </button>
                  <button
                    onClick={() => sharePhoto('whatsapp')}
                    className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition flex items-center gap-2"
                  >
                    <span>💬</span> WhatsApp
                  </button>
                  <button
                    onClick={() => sharePhoto('copy')}
                    className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition flex items-center gap-2"
                  >
                    <span>🔗</span> Copy Link
                  </button>
                </div>
              )}
            </div>
            
            {/* Fullscreen button */}
            <button
              onClick={toggleFullscreen}
              className="bg-black/50 hover:bg-black/75 text-white p-2 rounded-full transition backdrop-blur-sm w-9 h-9 flex items-center justify-center"
              aria-label="Fullscreen"
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>

            {/* Slideshow button */}
            <div className="relative">
              <button
                onClick={() => {
                  toggleSlideshow();
                  if (!isSlideshow) {
                    setShowSlideshowSettings(true);
                  }
                }}
                className={`bg-black/50 hover:bg-black/75 text-white p-2 rounded-full transition backdrop-blur-sm w-9 h-9 flex items-center justify-center ${
                  isSlideshow ? 'ring-2 ring-blue-500' : ''
                }`}
                aria-label="Slideshow"
              >
                {isSlideshow ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              
              {/* Slideshow settings dropdown */}
              {isSlideshow && showSlideshowSettings && (
                <div className="absolute right-0 mt-2 w-48 bg-gray-800 rounded-lg shadow-xl border border-gray-700 p-3">
                  <div className="text-white text-sm mb-2">Speed</div>
                  <div className="space-y-1">
                    <button
                      onClick={() => {
                        setSlideshowSpeed(2000);
                        setShowSlideshowSettings(false);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-sm rounded transition ${
                        slideshowSpeed === 2000 ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      Fast (2s)
                    </button>
                    <button
                      onClick={() => {
                        setSlideshowSpeed(3000);
                        setShowSlideshowSettings(false);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-sm rounded transition ${
                        slideshowSpeed === 3000 ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      Normal (3s)
                    </button>
                    <button
                      onClick={() => {
                        setSlideshowSpeed(5000);
                        setShowSlideshowSettings(false);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-sm rounded transition ${
                        slideshowSpeed === 5000 ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      Slow (5s)
                    </button>
                    <button
                      onClick={() => {
                        setSlideshowSpeed(10000);
                        setShowSlideshowSettings(false);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-sm rounded transition ${
                        slideshowSpeed === 10000 ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      Very Slow (10s)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Help button */}
            <button
              onClick={() => setShowKeyboardHelp(true)}
              className="bg-black/50 hover:bg-black/75 text-white p-2 rounded-full transition backdrop-blur-sm w-9 h-9 flex items-center justify-center"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (? or H)"
            >
              <span className="text-base font-bold leading-none">?</span>
            </button>
            
            {/* Close button (only in fullscreen) */}
            {isFullscreen && (
              <button
                onClick={exitFullscreen}
                className="bg-black/50 hover:bg-black/75 text-white p-2 rounded-full transition backdrop-blur-sm w-9 h-9 flex items-center justify-center"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
          
          {/* Navigation buttons - Desktop */}
          {/* Always show previous button - logic will handle looping */}
          {(fromFavorites && favoritePhotos.length > 1) || (!fromFavorites && currentIndex > 0) ? (
            <button
              onClick={navigateToPrevious}
              className="hidden md:block absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/75 text-white p-3 rounded-full transition"
              aria-label="Previous photo"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : null}
          
          {/* Always show next button - logic will handle looping */}
          {(fromFavorites && favoritePhotos.length > 1) || (!fromFavorites && currentIndex < allPhotos.length - 1 && currentIndex >= 0) ? (
            <button
              onClick={navigateToNext}
              className="hidden md:block absolute right-4 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/75 text-white p-3 rounded-full transition"
              aria-label="Next photo"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : null}
          
          {/* Main image with swipe support and progressive loading */}
          <div className="relative">
            {photo?.blur_placeholder && !imageLoaded && (
              <img
                src={photo.blur_placeholder}
                alt="Loading..."
                className={`w-full h-auto ${isFullscreen ? 'max-h-screen' : 'max-h-[70vh] md:max-h-[80vh]'} object-contain blur-xl`}
              />
            )}
            <img
              src={getPreviewUrl(slug!, photo?.id || photoId!)}
              alt={photo?.original_filename}
              className={`w-full h-auto ${isFullscreen ? 'max-h-screen' : 'max-h-[70vh] md:max-h-[80vh]'} object-contain transition-opacity duration-500 ${imageLoaded ? 'opacity-100' : 'opacity-0'} ${photo?.blur_placeholder && !imageLoaded ? 'absolute inset-0' : ''}`}
              onLoad={() => setImageLoaded(true)}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            />
          </div>
        </div>

        {/* Mobile Action Bar */}
        <div className="md:hidden mt-4 space-y-3">
          {/* Quick actions */}
          <div className="flex gap-2 justify-center">
            {/* Favorite button */}
            <button
              onClick={toggleFavorite}
              className="px-4 py-2.5 bg-gray-800 text-white rounded-lg transition flex items-center gap-2 min-w-[110px] justify-center"
              aria-label="Favorite"
            >
              <Heart className={`w-5 h-5 ${isFavorited ? 'fill-red-500 text-red-500' : ''}`} />
              <span className="text-sm font-medium">{isFavorited ? 'Favorited' : 'Favorite'}</span>
            </button>
            
            {/* Share button */}
            <button
              onClick={() => {
                // Use native share on mobile if available
                if ('share' in navigator) {
                  sharePhoto();
                } else {
                  setShowShareMenu(!showShareMenu);
                }
              }}
              className="px-4 py-2.5 bg-gray-800 text-white rounded-lg transition flex items-center gap-2 min-w-[110px] justify-center"
              aria-label="Share"
            >
              <Share2 className="w-5 h-5" />
              <span className="text-sm font-medium">Share</span>
            </button>
            
            {/* Slideshow button */}
            <button
              onClick={toggleSlideshow}
              className={`px-4 py-2.5 bg-gray-800 text-white rounded-lg transition flex items-center gap-2 min-w-[110px] justify-center ${
                isSlideshow ? 'ring-2 ring-blue-500' : ''
              }`}
              aria-label="Slideshow"
            >
              {isSlideshow ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              <span className="text-sm font-medium">{isSlideshow ? 'Pause' : 'Play'}</span>
            </button>
          </div>
          
          {/* Download buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => downloadOriginal(slug!, photo?.id || photoId!)}
              className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition text-center font-medium flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span className="text-sm">Original</span>
            </button>
            <button
              onClick={() => downloadSmall(slug!, photo?.id || photoId!)}
              className="flex-1 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 active:bg-purple-800 transition text-center font-medium flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span className="text-sm">Small</span>
            </button>
          </div>
          
          {/* Navigation hint */}
          <div className="text-center text-gray-400 text-sm">
            ← Swipe to navigate →
          </div>
        </div>

        {/* Mobile Share Menu Bottom Sheet - only shown if native share is not available */}
        {showShareMenu && !('share' in navigator) && (
          <div className="md:hidden fixed inset-0 bg-black/50 z-50" onClick={() => setShowShareMenu(false)}>
            <div className="absolute bottom-0 left-0 right-0 bg-gray-800 rounded-t-2xl p-4" onClick={(e) => e.stopPropagation()}>
              <div className="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4"></div>
              <h3 className="text-white text-lg font-semibold mb-4">Share Photo</h3>
              <div className="space-y-2">
                <button
                  onClick={() => sharePhoto('twitter')}
                  className="w-full px-4 py-3 text-left text-white bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-lg transition flex items-center gap-3"
                >
                  <span className="text-2xl">🐦</span>
                  <span>Share on Twitter</span>
                </button>
                <button
                  onClick={() => sharePhoto('facebook')}
                  className="w-full px-4 py-3 text-left text-white bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-lg transition flex items-center gap-3"
                >
                  <span className="text-2xl">📘</span>
                  <span>Share on Facebook</span>
                </button>
                <button
                  onClick={() => sharePhoto('whatsapp')}
                  className="w-full px-4 py-3 text-left text-white bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-lg transition flex items-center gap-3"
                >
                  <span className="text-2xl">💬</span>
                  <span>Share on WhatsApp</span>
                </button>
                <button
                  onClick={() => sharePhoto('copy')}
                  className="w-full px-4 py-3 text-left text-white bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-lg transition flex items-center gap-3"
                >
                  <span className="text-2xl">🔗</span>
                  <span>Copy Link</span>
                </button>
              </div>
              <button
                onClick={() => setShowShareMenu(false)}
                className="w-full mt-4 px-4 py-3 bg-gray-900 text-white rounded-lg font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Details section - collapsible on mobile */}
        <div className={`mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 ${showDetails ? 'block' : 'hidden md:grid'}`}>
          {/* Photo Info */}
          <div className="bg-gray-800 rounded-lg p-4 md:p-6">
            <div className="flex justify-between items-center mb-3 md:mb-4">
              <h3 className="text-base md:text-lg font-semibold text-white">📷 Photo Info</h3>
              {photo?.favorites_count && photo.favorites_count > 0 ? (
                <div className="flex items-center gap-1 text-red-500">
                  <Heart className="w-4 h-4 fill-current" />
                  <span className="text-sm">{photo.favorites_count}</span>
                </div>
              ) : null}
            </div>
            <dl className="space-y-2 text-sm md:text-base">
              <div>
                <dt className="text-gray-400 text-xs md:text-sm">Captured</dt>
                <dd className="text-white">
                  {photo?.capture_time ? new Date(photo.capture_time).toLocaleString() : 'Unknown'}
                </dd>
              </div>
              {photo?.width && photo?.height && (
                <div>
                  <dt className="text-gray-400 text-xs md:text-sm">Dimensions</dt>
                  <dd className="text-white">{photo.width} × {photo.height} pixels</dd>
                </div>
              )}
              <div>
                <dt className="text-gray-400 text-xs md:text-sm">Filename</dt>
                <dd className="text-white text-xs md:text-sm break-all">{photo?.original_filename}</dd>
              </div>
            </dl>
          </div>

          {/* Camera Settings */}
          {(photo?.iso || photo?.aperture || photo?.shutter_speed || photo?.focal_length) && (
            <div className="bg-gray-800 rounded-lg p-4 md:p-6">
              <h3 className="text-base md:text-lg font-semibold text-white mb-3 md:mb-4">⚙️ Camera Settings</h3>
              <dl className="space-y-2 text-sm md:text-base">
                {photo.iso && (
                  <div>
                    <dt className="text-gray-400 text-xs md:text-sm">ISO</dt>
                    <dd className="text-white">{photo.iso}</dd>
                  </div>
                )}
                {photo.aperture && (
                  <div>
                    <dt className="text-gray-400 text-xs md:text-sm">Aperture</dt>
                    <dd className="text-white">{photo.aperture}</dd>
                  </div>
                )}
                {photo.shutter_speed && (
                  <div>
                    <dt className="text-gray-400 text-xs md:text-sm">Exposure Time</dt>
                    <dd className="text-white">{photo.shutter_speed}</dd>
                  </div>
                )}
                {photo.focal_length && (
                  <div>
                    <dt className="text-gray-400 text-xs md:text-sm">Focal Length</dt>
                    <dd className="text-white">{photo.focal_length}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Camera & Lens */}
          {(photo?.camera_make || photo?.camera_model || photo?.lens_model) && (
            <div className="bg-gray-800 rounded-lg p-4 md:p-6 md:col-span-2">
              <h3 className="text-base md:text-lg font-semibold text-white mb-3 md:mb-4">📸 Equipment</h3>
              <dl className="space-y-2 text-sm md:text-base">
                {(photo.camera_make || photo.camera_model) && (
                  <div>
                    <dt className="text-gray-400 text-xs md:text-sm">Device Model</dt>
                    <dd className="text-white">
                      {[photo.camera_make, photo.camera_model].filter(Boolean).join(' ')}
                    </dd>
                  </div>
                )}
                {photo.lens_model && (
                  <div>
                    <dt className="text-gray-400 text-xs md:text-sm">Lens</dt>
                    <dd className="text-white break-all">{photo.lens_model}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>

      {/* Keyboard Help Modal */}
      {showKeyboardHelp && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-[100] p-4" onClick={() => setShowKeyboardHelp(false)}>
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">⌨️ Keyboard Shortcuts</h2>
              <button onClick={() => setShowKeyboardHelp(false)} className="text-gray-400 hover:text-white">
                ✕
              </button>
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
                <span className="text-gray-300">Toggle photo info</span>
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
      <Footer />
    </div>
  );
};

export default PhotoDetail;
