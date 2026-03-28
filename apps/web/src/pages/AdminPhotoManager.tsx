import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getEvent, getPhotos, deletePhoto, setPhotoFeatured, getPreviewUrl } from '../api';
import type { Event, Photo } from '../types';

const AdminPhotoManager: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deletingPhoto, setDeletingPhoto] = useState<Photo | null>(null);

  useEffect(() => {
    if (slug) {
      loadData();
    }
  }, [slug]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [eventData, photosData] = await Promise.all([
        getEvent(slug!),
        getPhotos(slug!),
      ]);
      setEvent(eventData);
      setPhotos(photosData);
      setError(null);
    } catch (err) {
      setError('Failed to load photos');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const togglePhoto = (photoId: string) => {
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
      setSuccess(currentStatus ? 'Removed from featured' : 'Added to featured');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to update featured status');
      console.error(err);
    }
  };

  const selectAll = () => {
    setSelectedPhotos(new Set(photos.map(p => p.id)));
  };

  const deselectAll = () => {
    setSelectedPhotos(new Set());
  };

  const handleDeletePhoto = async (photoId: string) => {
    try {
      await deletePhoto(photoId);
      setSuccess('Photo deleted successfully!');
      setDeletingPhoto(null);
      await loadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to delete photo');
      console.error(err);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedPhotos.size === 0) return;
    
    const confirm = window.confirm(`Delete ${selectedPhotos.size} selected photos? This cannot be undone!`);
    if (!confirm) return;

    try {
      // Delete photos one by one
      let deleted = 0;
      for (const photoId of selectedPhotos) {
        try {
          await deletePhoto(photoId);
          deleted++;
        } catch (err) {
          console.error(`Failed to delete photo ${photoId}:`, err);
        }
      }
      
      setSuccess(`Successfully deleted ${deleted} of ${selectedPhotos.size} photos`);
      setSelectedPhotos(new Set());
      await loadData();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to delete photos');
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link to="/admin" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
            ← Back to Admin
          </Link>
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-4xl font-bold text-gray-900">{event?.name}</h1>
              <p className="text-gray-600 mt-2">Manage photos for this event</p>
            </div>
            <Link
              to={`/admin/events/${slug}/upload`}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              📷 Upload Photos
            </Link>
          </div>
        </div>

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
            {success}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Bulk Action Bar */}
        {selectedPhotos.size > 0 && (
          <div className="bg-blue-50 border border-blue-200 px-4 py-3 rounded mb-4 flex items-center justify-between">
            <span className="text-blue-900 font-medium">
              {selectedPhotos.size} photo{selectedPhotos.size !== 1 ? 's' : ''} selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={deselectAll}
                className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition text-sm"
              >
                Deselect All
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition text-sm"
              >
                🗑️ Delete Selected
              </button>
            </div>
          </div>
        )}

        {/* Photo Stats */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-2xl font-bold text-gray-900">{photos.length}</span>
              <span className="text-gray-600 ml-2">photos in this event</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition text-sm"
              >
                Select All
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            <p className="mt-4 text-gray-600">Loading photos...</p>
          </div>
        ) : photos.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-600 mb-4">No photos in this event yet</p>
            <Link
              to={`/admin/events/${slug}/upload`}
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Upload Photos
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {photos.map((photo) => (
              <div
                key={photo.id}
                className={`relative bg-white rounded-lg shadow overflow-hidden group cursor-pointer ${
                  selectedPhotos.has(photo.id) ? 'ring-4 ring-blue-500' : ''
                }`}
                onClick={() => togglePhoto(photo.id)}
              >
                <div className="aspect-square">
                  <img
                    src={getPreviewUrl(slug!, photo.id, photo.file_type, photo.cache_version)}
                    alt={photo.original_filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                
                {/* Checkbox */}
                <div className="absolute top-2 left-2">
                  <input
                    type="checkbox"
                    checked={selectedPhotos.has(photo.id)}
                    onChange={() => togglePhoto(photo.id)}
                    className="w-5 h-5 rounded"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>

                {/* Featured badge */}
                {!!photo.is_featured && (
                  <div className="absolute top-2 right-2 bg-yellow-400 text-yellow-900 px-2 py-1 rounded text-xs font-bold">
                    ⭐
                  </div>
                )}

                {/* Actions overlay */}
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFeatured(photo.id, photo.is_featured || false);
                    }}
                    className={`px-3 py-2 rounded transition text-sm flex items-center gap-1 ${
                      photo.is_featured
                        ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                        : 'bg-gray-700 text-white hover:bg-gray-600'
                    }`}
                    title={photo.is_featured ? 'Remove from featured' : 'Mark as featured'}
                  >
                    <Star className={`w-4 h-4 ${photo.is_featured ? 'fill-current' : ''}`} />
                    {photo.is_featured ? 'Featured' : 'Feature'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingPhoto(photo);
                    }}
                    className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition text-sm"
                  >
                    🗑️ Delete
                  </button>
                </div>

                {/* Info */}
                <div className="p-2">
                  <p className="text-xs text-gray-600 truncate">{photo.original_filename}</p>
                  {photo.favorites_count > 0 && (
                    <p className="text-xs text-gray-500">❤️ {photo.favorites_count}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deletingPhoto && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4 text-red-600">⚠️ Delete Photo</h2>
                <div className="mb-4">
                  <img
                    src={getPreviewUrl(slug!, deletingPhoto.id, deletingPhoto.file_type, deletingPhoto.cache_version)}
                    alt={deletingPhoto.original_filename}
                    className="w-full rounded"
                  />
                </div>
                <p className="mb-4 text-gray-700">
                  Delete <strong>{deletingPhoto.original_filename}</strong>? This action cannot be undone!
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleDeletePhoto(deletingPhoto.id)}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                  >
                    Delete Permanently
                  </button>
                  <button
                    onClick={() => setDeletingPhoto(null)}
                    className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPhotoManager;
