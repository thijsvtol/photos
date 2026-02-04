import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getEvent, getPhotos, loginToEvent, getPreviewUrl, getOriginalUrl, getIgUrl } from '../api';
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
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (slug) {
      loadEvent();
    }
  }, [slug]);

  useEffect(() => {
    // Load selected photos from localStorage
    const stored = localStorage.getItem(`favorites_${slug}`);
    if (stored) {
      setSelectedPhotos(new Set(JSON.parse(stored)));
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
      
      // Try to load photos (will fail if not authenticated)
      try {
        const photoData = await getPhotos(slug!);
        setPhotos(photoData);
        setAuthenticated(true);
      } catch {
        // Not authenticated yet
        setAuthenticated(false);
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
      const photoData = await getPhotos(slug!, fromDate || undefined, toDate || undefined);
      setPhotos(photoData);
    } catch (err) {
      console.error(err);
    }
  };

  const applyFilters = () => {
    loadPhotos();
  };

  const toggleSelection = (photoId: string) => {
    const newSelected = new Set(selectedPhotos);
    if (newSelected.has(photoId)) {
      newSelected.delete(photoId);
    } else {
      newSelected.add(photoId);
    }
    setSelectedPhotos(newSelected);
  };

  const downloadSelected = () => {
    const selected = Array.from(selectedPhotos);
    if (selected.length > 50) {
      alert('Maximum 50 photos can be downloaded at once');
      return;
    }
    
    // Download each photo individually
    selected.forEach(photoId => {
      const url = getOriginalUrl(slug!, photoId);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${photoId}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link to="/events" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
            ← Back to Events
          </Link>
          <h1 className="text-4xl font-bold text-gray-900">{event?.name}</h1>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <button
              onClick={applyFilters}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Apply Filters
            </button>
            {selectedPhotos.size > 0 && (
              <button
                onClick={downloadSelected}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition ml-auto"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {photos.map((photo) => (
              <div key={photo.id} className="relative group bg-white rounded-lg overflow-hidden shadow-md">
                <Link to={`/p/${slug}/${photo.id}`}>
                  <img
                    src={getPreviewUrl(slug!, photo.id)}
                    alt={photo.original_filename}
                    className="w-full h-64 object-cover"
                    loading="lazy"
                  />
                </Link>
                <div className="p-2">
                  <div className="flex justify-between items-center">
                    <button
                      onClick={() => toggleSelection(photo.id)}
                      className={`px-2 py-1 rounded text-sm ${
                        selectedPhotos.has(photo.id)
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      {selectedPhotos.has(photo.id) ? '✓ Selected' : 'Select'}
                    </button>
                    <div className="flex gap-2">
                      <a
                        href={getOriginalUrl(slug!, photo.id)}
                        download
                        className="px-2 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Original
                      </a>
                      <a
                        href={getIgUrl(slug!, photo.id)}
                        download
                        className="px-2 py-1 bg-purple-600 text-white rounded text-sm hover:bg-purple-700"
                        onClick={(e) => e.stopPropagation()}
                      >
                        IG
                      </a>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {new Date(photo.capture_time).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default EventGallery;
