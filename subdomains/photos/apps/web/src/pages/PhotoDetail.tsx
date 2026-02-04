import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getEvent, getPhoto, getPhotos, loginToEvent, getPreviewUrl, getOriginalUrl, getIgUrl } from '../api';
import type { Event, Photo } from '../types';

const PhotoDetail: React.FC = () => {
  const { slug, photoId } = useParams<{ slug: string; photoId: string }>();
  const navigate = useNavigate();
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
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  useEffect(() => {
    if (slug && photoId) {
      loadPhoto();
    }
  }, [slug]);

  // Update photo when photoId changes in URL (for browser back/forward)
  useEffect(() => {
    if (photoId && allPhotos.length > 0) {
      const index = allPhotos.findIndex(p => p.id === photoId);
      if (index >= 0 && index !== currentIndex) {
        setCurrentIndex(index);
        setPhoto(allPhotos[index]);
      }
    }
  }, [photoId, allPhotos]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') navigateToPrevious();
      if (e.key === 'ArrowRight') navigateToNext();
      if (e.key === 'Escape') navigate(`/events/${slug}`);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, allPhotos, slug]);

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
        const index = allPhotosData.findIndex(p => p.id === photoId);
        setCurrentIndex(index);
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

  const navigateToNext = () => {
    if (currentIndex >= 0 && currentIndex < allPhotos.length - 1) {
      const nextIndex = currentIndex + 1;
      const nextPhoto = allPhotos[nextIndex];
      setCurrentIndex(nextIndex);
      setPhoto(nextPhoto);
      // Update URL without reload
      window.history.pushState(null, '', `/p/${slug}/${nextPhoto.id}`);
    }
  };

  const navigateToPrevious = () => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      const prevPhoto = allPhotos[prevIndex];
      setCurrentIndex(prevIndex);
      setPhoto(prevPhoto);
      // Update URL without reload
      window.history.pushState(null, '', `/p/${slug}/${prevPhoto.id}`);
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

  return (
    <div className="min-h-screen bg-gray-900 pb-safe">
      {/* Header - Mobile optimized */}
      <div className="sticky top-0 z-50 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3">
          <div className="flex justify-between items-center">
            <button
              onClick={() => navigate(`/events/${slug}`)}
              className="text-white hover:text-gray-300 flex items-center text-sm sm:text-base"
            >
              <span className="text-xl mr-1">←</span>
              <span className="hidden sm:inline">Back to Gallery</span>
              <span className="sm:hidden">Back</span>
            </button>
            
            {/* Photo counter */}
            {currentIndex >= 0 && (
              <div className="text-white text-sm">
                {currentIndex + 1} / {allPhotos.length}
              </div>
            )}
            
            {/* Desktop download buttons */}
            <div className="hidden md:flex gap-2">
              <a
                href={getOriginalUrl(slug!, photo?.id || photoId!)}
                download
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Original
              </a>
              <a
                href={getIgUrl(slug!, photo?.id || photoId!)}
                download
                className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition text-sm flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Small
              </a>
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
        <div className="relative bg-black rounded-lg overflow-hidden">
          {/* Navigation buttons - Desktop */}
          {currentIndex > 0 && (
            <button
              onClick={navigateToPrevious}
              className="hidden md:block absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/75 text-white p-3 rounded-full transition"
              aria-label="Previous photo"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          
          {currentIndex < allPhotos.length - 1 && currentIndex >= 0 && (
            <button
              onClick={navigateToNext}
              className="hidden md:block absolute right-4 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/75 text-white p-3 rounded-full transition"
              aria-label="Next photo"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
          
          {/* Main image with swipe support */}
          <img
            src={getPreviewUrl(slug!, photo?.id || photoId!)}
            alt={photo?.original_filename}
            className="w-full h-auto max-h-[70vh] md:max-h-[80vh] object-contain"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
        </div>

        {/* Mobile download buttons */}
        <div className="md:hidden mt-4 flex gap-2">
          <a
            href={getOriginalUrl(slug!, photo?.id || photoId!)}
            download
            className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-center font-medium flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Original
          </a>
          <a
            href={getIgUrl(slug!, photo?.id || photoId!)}
            download
            className="flex-1 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition text-center font-medium flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Small
          </a>
        </div>
        
        {/* Navigation hint for mobile */}
        <div className="md:hidden mt-4 text-center text-gray-400 text-sm">
          ← Swipe to navigate →
        </div>

        {/* Details section - collapsible on mobile */}
        <div className={`mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 ${showDetails ? 'block' : 'hidden md:grid'}`}>
          {/* Photo Info */}
          <div className="bg-gray-800 rounded-lg p-4 md:p-6">
            <h3 className="text-base md:text-lg font-semibold text-white mb-3 md:mb-4">📷 Photo Info</h3>
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
    </div>
  );
};

export default PhotoDetail;
