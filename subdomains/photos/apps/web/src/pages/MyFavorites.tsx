import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Download } from 'lucide-react';
import Masonry from 'react-masonry-css';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PhotoCard from '../components/PhotoCard';
import SEO from '../components/SEO';
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
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <SEO
        title="My Favorites - Thijs van Tol Photos"
        description="Your personal collection of favorite photos from various events. Private collection not indexed by search engines."
        url="https://photos.thijsvtol.nl/favorites"
      />
      <Navbar />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8 flex-grow w-full">
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
              className="w-full sm:w-auto px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 active:scale-95 transition-all disabled:bg-gray-400 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center justify-center gap-2 font-semibold shadow-md"
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
          <div className="text-center py-16 px-4 bg-white rounded-xl shadow-lg">
            <Heart className="w-20 h-20 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-900 text-xl font-semibold mb-2">No favorites yet</p>
            <p className="text-gray-500 text-base mb-8 max-w-md mx-auto">Click the heart icon on photos to add them to your favorites</p>
            <Link
              to="/events"
              className="inline-block px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 active:scale-95 transition-all font-semibold shadow-md"
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
              <PhotoCard
                key={photo.id}
                photo={photo}
                slug={photo.event_slug}
                fromFavorites={true}
                favoritePhotos={photos.map(p => ({ id: p.id, slug: p.event_slug }))}
                showRemoveFavorite={true}
                onRemoveFavorite={removeFavorite}
              />
            ))}
          </Masonry>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default MyFavorites;
