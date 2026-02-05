import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Heart, Star } from 'lucide-react';
import Masonry from 'react-masonry-css';
import Navbar from '../components/Navbar';
import ProgressiveImage from '../components/ProgressiveImage';
import { getEvent, getPhotos, loginToEvent, getPreviewUrl, getOriginalUrl, getIgUrl, requestZip, setPhotoFeatured } from '../api';
import type { Event, Photo } from '../types';

const EventGallery: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
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
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <Link to="/events" className="text-blue-600 hover:text-blue-700 mb-3 sm:mb-4 inline-block text-sm sm:text-base">
            ← Back to Events
          </Link>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">{event?.name}</h1>
          {event && !event.requires_password && (
            <span className="inline-block mt-2 px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
              Public Gallery
            </span>
          )}
        </div>

        {/* Sort Options - Mobile optimized */}
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
                className="w-full sm:w-auto px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition sm:ml-auto text-sm font-medium"
              >
                Download Selected ({selectedPhotos.size})
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
              <div key={photo.id} className="mb-2 sm:mb-4 relative group bg-white rounded-lg overflow-hidden shadow-md">
                <Link to={`/p/${slug}/${photo.id}`} className="block relative">
                  <ProgressiveImage
                    src={getPreviewUrl(slug!, photo.id)}
                    blurDataUrl={photo.blur_placeholder}
                    alt={photo.original_filename}
                    className="w-full object-cover"
                    loading="lazy"
                    style={{
                      height: photo.height && photo.width 
                        ? `${(photo.height / photo.width) * 100}%` 
                        : 'auto'
                    }}
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
                <div className="p-2">
                  <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2">
                    <div className="flex gap-1">
                      <button
                        onClick={() => toggleSelection(photo.id)}
                        className={`px-2 py-1 rounded text-xs sm:text-sm ${
                          selectedPhotos.has(photo.id)
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300 active:bg-gray-400'
                        }`}
                      >
                        {selectedPhotos.has(photo.id) ? '✓' : 'Select'}
                      </button>
                      <button
                        onClick={() => toggleFeatured(photo.id, photo.is_featured || false)}
                        className={`px-2 py-1 rounded text-xs sm:text-sm flex items-center gap-1 ${
                          photo.is_featured
                            ? 'bg-yellow-500 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300 active:bg-gray-400'
                        }`}
                        title={photo.is_featured ? 'Remove from featured' : 'Mark as featured'}
                      >
                        <Star className={`w-3 h-3 ${photo.is_featured ? 'fill-white' : ''}`} />
                      </button>
                    </div>
                    <div className="flex gap-1 sm:gap-2">
                      <a
                        href={getOriginalUrl(slug!, photo.id)}
                        download
                        className="flex-1 sm:flex-none px-2 py-1 bg-blue-600 text-white rounded text-xs sm:text-sm hover:bg-blue-700 active:bg-blue-800 text-center flex items-center justify-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Original
                      </a>
                      <a
                        href={getIgUrl(slug!, photo.id)}
                        download
                        className="flex-1 sm:flex-none px-2 py-1 bg-purple-600 text-white rounded text-xs sm:text-sm hover:bg-purple-700 active:bg-purple-800 text-center flex items-center justify-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Small
                      </a>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2 hidden sm:block">
                    {new Date(photo.capture_time).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 mt-1 sm:hidden">
                    {new Date(photo.capture_time).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </Masonry>
        )}
      </div>
    </div>
  );
};

export default EventGallery;
