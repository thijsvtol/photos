import React, { useEffect, useState } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { Share2 } from 'lucide-react';
import Masonry from 'react-masonry-css';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PhotoCard from '../components/PhotoCard';
import { getEvent, getPhotos, loginToEvent, getPreviewUrl, requestZip, setPhotoFeatured } from '../api';
import type { Event, Photo } from '../types';

const EventGallery: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const isAdminView = location.pathname.startsWith('/admin');
  const [event, setEvent] = useState<Event | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('date_desc');
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [userFavorites, setUserFavorites] = useState<Set<string>>(new Set());
  const [showShareMenu, setShowShareMenu] = useState(false);

  useEffect(() => {
    if (slug) {
      loadEvent();
    }
  }, [slug]);

  useEffect(() => {
    // Load user favorites from localStorage
    const favoritesStr = localStorage.getItem('user_favorites');
    if (favoritesStr) {
      const favorites = JSON.parse(favoritesStr) as Array<{ photoId: string; slug: string; timestamp: number }>;
      const favoriteIds = new Set(favorites.map(f => f.photoId));
      setUserFavorites(favoriteIds);
    }
  }, []);

  useEffect(() => {
    // Load selected photos from localStorage (for download selection)
    if (slug) {
      const stored = localStorage.getItem(`favorites_${slug}`);
      if (stored) {
        setSelectedPhotos(new Set(JSON.parse(stored)));
      }
    }
  }, [slug]);

  useEffect(() => {
    // Save selected photos to localStorage
    if (slug) {
      localStorage.setItem(`favorites_${slug}`, JSON.stringify(Array.from(selectedPhotos)));
    }
  }, [selectedPhotos, slug]);

  const loadEvent = async () => {
    try {
      setLoading(true);
      const eventData = await getEvent(slug!);
      setEvent(eventData);
      
      // If event doesn't require password, load photos immediately
      if (!eventData.requires_password) {
        try {
          const photoData = await getPhotos(slug!, sortBy);
          setPhotos(photoData);
          setAuthenticated(true);
        } catch (err) {
          console.error('Failed to load photos for public event:', err);
        }
      } else {
        // Try to load photos (will succeed if already authenticated)
        try {
          const photoData = await getPhotos(slug!, sortBy);
          setPhotos(photoData);
          setAuthenticated(true);
        } catch {
          // Not authenticated yet
          setAuthenticated(false);
        }
      }
      
      setError(null);
    } catch (err) {
      setError('Failed to load event');
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
      await loadPhotos();
    } catch (err) {
      setLoginError('Invalid password');
      console.error(err);
    }
  };

  const loadPhotos = async () => {
    try {
      const photoData = await getPhotos(slug!, sortBy);
      setPhotos(photoData);
    } catch (err) {
      console.error(err);
    }
  };

  // Reload photos when sort changes
  useEffect(() => {
    if (authenticated && slug) {
      loadPhotos();
    }
  }, [sortBy]);

  const toggleSelection = (photoId: string) => {
    const newSelected = new Set(selectedPhotos);
    if (newSelected.has(photoId)) {
      newSelected.delete(photoId);
    } else {
      newSelected.add(photoId);
    }
    setSelectedPhotos(newSelected);
  };

  const toggleFavorite = (photoId: string, isFavorited: boolean) => {
    const favoritesStr = localStorage.getItem('user_favorites');
    let favorites = favoritesStr ? JSON.parse(favoritesStr) as Array<{ photoId: string; slug: string; timestamp: number }> : [];
    
    if (isFavorited) {
      // Remove from favorites
      favorites = favorites.filter(f => f.photoId !== photoId);
    } else {
      // Add to favorites
      favorites.push({ photoId, slug: slug!, timestamp: Date.now() });
    }
    
    localStorage.setItem('user_favorites', JSON.stringify(favorites));
    
    // Update local state
    const favoriteIds = new Set(favorites.map(f => f.photoId));
    setUserFavorites(favoriteIds);
  };

  const toggleFeatured = async (photoId: string, currentStatus: boolean) => {
    try {
      await setPhotoFeatured(photoId, !currentStatus);
      // Update local state
      setPhotos(photos.map(p => 
        p.id === photoId ? { ...p, is_featured: !currentStatus } : p
      ));
    } catch (err) {
      console.error('Failed to toggle featured status:', err);
      alert('Failed to update featured status. You may need admin access.');
    }
  };

  const downloadSelected = async () => {
    const selected = Array.from(selectedPhotos);
    if (selected.length === 0) {
      alert('No photos selected');
      return;
    }
    
    if (selected.length > 50) {
      alert('Maximum 50 photos can be downloaded at once');
      return;
    }
    
    try {
      // Request ZIP file from server
      const zipBlob = await requestZip(slug!, selected);
      
      // Create download link
      const url = window.URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().split('T')[0];
      a.download = `${slug}_${timestamp}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading ZIP:', error);
      alert('Failed to download ZIP file');
    }
  };

  const shareEvent = async (platform?: string) => {
    const url = `${window.location.origin}/events/${slug}`;
    const text = `Check out ${event?.name} photo gallery`;
    
    // Use native share API on mobile if available and no platform specified
    if (!platform && 'share' in navigator) {
      try {
        const shareData: any = {
          title: event?.name || 'Photo Gallery',
          text: text,
          url: url,
        };
        
        // Try to include a representative photo from the album
        if (photos.length > 0) {
          try {
            // Use first photo or first featured photo as representative
            const representativePhoto = photos.find(p => p.is_featured) || photos[0];
            const imageUrl = getPreviewUrl(slug!, representativePhoto.id);
            
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const fileName = `${slug}-preview.jpg`;
            const file = new File([blob], fileName, { type: blob.type });
            
            // Check if we can share files
            if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
              shareData.files = [file];
            }
          } catch (err) {
            console.log('Could not include photo in share, sharing URL only:', err);
          }
        }
        
        await (navigator as any).share(shareData);
        setShowShareMenu(false);
        return;
      } catch (err) {
        // User cancelled or share failed
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

  if (!authenticated && event?.requires_password) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">{event?.name}</h1>
          <p className="text-gray-600 mb-6">This event is password protected. Please enter the password to view photos.</p>
          
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
              Unlock Gallery
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
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8 flex-grow w-full">
        <div className="mb-6 sm:mb-8">
          <Link to="/events" className="text-blue-600 hover:text-blue-700 mb-3 sm:mb-4 inline-block text-sm sm:text-base">
            ← Back to Events
          </Link>
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1">
              <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">{event?.name}</h1>
              {event && !event.requires_password && (
                <span className="inline-block mt-2 px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
                  Public Gallery
                </span>
              )}
            </div>
            {/* Share button */}
            <div className="relative">
              <button
                onClick={() => {
                  if ('share' in navigator) {
                    shareEvent();
                  } else {
                    setShowShareMenu(!showShareMenu);
                  }
                }}
                className="px-3 py-2 sm:px-4 sm:py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2 text-sm font-medium"
                aria-label="Share album"
              >
                <Share2 className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="hidden sm:inline">Share</span>
              </button>
              
              {/* Desktop share menu dropdown */}
              {showShareMenu && !('share' in navigator) && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden z-30">
                  <button
                    onClick={() => shareEvent('twitter')}
                    className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 transition flex items-center gap-2"
                  >
                    <span>🐦</span> Twitter
                  </button>
                  <button
                    onClick={() => shareEvent('facebook')}
                    className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 transition flex items-center gap-2"
                  >
                    <span>📘</span> Facebook
                  </button>
                  <button
                    onClick={() => shareEvent('whatsapp')}
                    className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 transition flex items-center gap-2"
                  >
                    <span>💬</span> WhatsApp
                  </button>
                  <button
                    onClick={() => shareEvent('copy')}
                    className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 transition flex items-center gap-2"
                  >
                    <span>🔗</span> Copy Link
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sort & Filter Options - Mobile optimized */}
        <div className="bg-white rounded-lg shadow p-3 sm:p-4 mb-6">
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:gap-4 sm:items-center">
            <div className="flex-1 sm:flex-none">
              <label className="block text-sm font-medium text-gray-700 mb-1">Sort by</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="date_desc">Date (Newest First)</option>
                <option value="date_asc">Date (Oldest First)</option>
                <option value="name_asc">Name (A-Z)</option>
                <option value="name_desc">Name (Z-A)</option>
              </select>
            </div>
            {selectedPhotos.size > 0 && (
              <button
                onClick={downloadSelected}
                className="w-full sm:w-auto px-6 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 active:scale-95 transition-all sm:ml-auto text-sm font-semibold shadow-md flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span className="hidden sm:inline">Download Selected</span>
                <span className="sm:hidden">Download</span>
                <span>({selectedPhotos.size})</span>
              </button>
            )}
          </div>
        </div>

        {/* Gallery */}
        {photos.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600">No photos found.</p>
          </div>
        ) : (
          <Masonry
            breakpointCols={{
              default: 4,
              1536: 4,
              1280: 3,
              1024: 3,
              768: 2,
              400: 1
            }}
            className="flex -ml-2 sm:-ml-4 w-auto"
            columnClassName="pl-2 sm:pl-4 bg-clip-padding"
          >
            {photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                slug={slug!}
                showSelection={true}
                isSelected={selectedPhotos.has(photo.id)}
                onToggleSelection={toggleSelection}
                showAddToFavorites={true}
                onToggleFavorite={toggleFavorite}
                showFeatured={isAdminView}
                onToggleFeatured={toggleFeatured}
                userFavorites={userFavorites}
              />
            ))}
          </Masonry>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default EventGallery;
