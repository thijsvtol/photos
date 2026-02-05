import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Download } from 'lucide-react';
import Masonry from 'react-masonry-css';
import Navbar from '../components/Navbar';
import ProgressiveImage from '../components/ProgressiveImage';
import { getPhoto, requestZip } from '../api';
import type { Photo } from '../types';

interface PhotoWithEvent extends Photo {
  event_slug: string;
}

const MyFavorites: React.FC = () => {
  const [photos, setPhotos] = useState<PhotoWithEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      setLoading(true);
      
      // Get favorite photo IDs from localStorage
      const favoritesStr = localStorage.getItem('user_favorites');
      if (!favoritesStr) {
        setPhotos([]);
        setLoading(false);
        return;
      }
      
      const favorites = JSON.parse(favoritesStr) as Array<{ photoId: string; slug: string; timestamp: number }>;
      
      // Load photo details for each favorite
      const photoPromises = favorites.map(async (fav) => {
        try {
          const photo = await getPhoto(fav.slug, fav.photoId);
          return { ...photo, event_slug: fav.slug } as PhotoWithEvent;
        } catch (err) {
          console.error(`Failed to load photo ${fav.photoId}:`, err);
          return null;
        }
      });
      
      const loadedPhotos = await Promise.all(photoPromises);
      const validPhotos = loadedPhotos.filter((p): p is PhotoWithEvent => p !== null && p.event_slug !== undefined);
      
      // Sort by timestamp (most recently favorited first)
      const sortedPhotos = validPhotos.sort((a, b) => {
        const aFav = favorites.find(f => f.photoId === a.id);
        const bFav = favorites.find(f => f.photoId === b.id);
        return (bFav?.timestamp || 0) - (aFav?.timestamp || 0);
      });
      
      setPhotos(sortedPhotos);
      setError(null);
    } catch (err) {
      setError('Failed to load your favorites');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const removeFavorite = (photoId: string) => {
    const favoritesStr = localStorage.getItem('user_favorites');
    if (favoritesStr) {
      const favorites = JSON.parse(favoritesStr) as Array<{ photoId: string; slug: string; timestamp: number }>;
      const updated = favorites.filter(f => f.photoId !== photoId);
      localStorage.setItem('user_favorites', JSON.stringify(updated));
      setPhotos(photos.filter(p => p.id !== photoId));
    }
  };

  const downloadAllFavorites = async () => {
    if (photos.length === 0) {
      alert('No favorites to download');
      return;
    }

    if (photos.length > 50) {
      alert('Maximum 50 photos can be downloaded at once. Please remove some favorites first.');
      return;
    }

    setDownloading(true);
    try {
      // Group photos by event
      const photosByEvent = photos.reduce((acc, photo) => {
        if (!acc[photo.event_slug]) {
          acc[photo.event_slug] = [];
        }
        acc[photo.event_slug].push(photo.id);
        return acc;
      }, {} as Record<string, string[]>);

      const timestamp = new Date().toISOString().split('T')[0];

      // Download ZIP for each event
      for (const [slug, photoIds] of Object.entries(photosByEvent)) {
        const zipBlob = await requestZip(slug, photoIds);
        
        // Create download link
        const url = window.URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `favorites_${slug}_${timestamp}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        // Small delay between downloads to avoid issues
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      alert(`Downloaded ${Object.keys(photosByEvent).length} ZIP file(s)`);
    } catch (error) {
      console.error('Error downloading favorites:', error);
      alert('Failed to download some files. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 flex items-center gap-2">
              <Heart className="w-8 h-8 fill-red-500 text-red-500" />
              My Favorites
            </h1>
            <p className="text-gray-600 mt-2">
              {photos.length} photo{photos.length !== 1 ? 's' : ''} you've favorited
            </p>
          </div>
          {photos.length > 0 && (
            <button
              onClick={downloadAllFavorites}
              disabled={downloading}
              className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Download className="w-5 h-5" />
              {downloading ? 'Downloading...' : 'Download All'}
            </button>
          )}
        </div>

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            <p className="mt-4 text-gray-600">Loading your favorites...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {!loading && !error && photos.length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <Heart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 text-lg mb-2">No favorites yet</p>
            <p className="text-gray-500 text-sm mb-6">Click the heart icon on photos to add them to your favorites</p>
            <Link
              to="/events"
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Browse Photos
            </Link>
          </div>
        )}

        {!loading && !error && photos.length > 0 && (
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
                <Link 
                  to={`/p/${photo.event_slug}/${photo.id}`} 
                  state={{ 
                    fromFavorites: true, 
                    favoritePhotos: photos.map(p => ({ id: p.id, slug: p.event_slug })) 
                  }}
                  className="block relative"
                >
                  <ProgressiveImage
                    src={`/media/${photo.event_slug}/preview/${photo.id}.jpg`}
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
                </Link>
                <div className="p-3 flex justify-between items-center">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 truncate">{photo.original_filename}</p>
                    {photo.capture_time && (
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(photo.capture_time).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => removeFavorite(photo.id)}
                    className="ml-2 p-2 text-red-500 hover:bg-red-50 rounded-full transition"
                    title="Remove from favorites"
                  >
                    <Heart className="w-5 h-5 fill-current" />
                  </button>
                </div>
              </div>
            ))}
          </Masonry>
        )}
      </div>
    </div>
  );
};

export default MyFavorites;
