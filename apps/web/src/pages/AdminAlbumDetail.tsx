import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { X, Plus } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getAlbum, removePhotoFromAlbum, updateAlbum, addPhotosToAlbum, getEvents, getPhotos, getPreviewUrl } from '../api';
import type { Album, AlbumPhoto } from '../api';
import type { Event, Photo } from '../types';

const AdminAlbumDetail: React.FC = () => {
  const { albumId } = useParams<{ albumId: string }>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEventSlug, setSelectedEventSlug] = useState<string | null>(null);
  const [eventPhotos, setEventPhotos] = useState<Photo[]>([]);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [loadingEventPhotos, setLoadingEventPhotos] = useState(false);

  useEffect(() => {
    if (albumId) loadData();
  }, [albumId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await getAlbum(parseInt(albumId!, 10));
      setAlbum(data.album);
      setPhotos(data.photos);
      setError(null);
    } catch (err) {
      setError('Failed to load album');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (photoId: string) => {
    if (!album) return;
    try {
      await removePhotoFromAlbum(album.id, photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch (err) {
      setError('Failed to remove photo');
      console.error(err);
    }
  };

  const handleSetCover = async (photoId: string) => {
    if (!album) return;
    try {
      await updateAlbum(album.id, { coverPhotoId: photoId });
      setAlbum({ ...album, cover_photo_id: photoId });
    } catch (err) {
      setError('Failed to set cover photo');
      console.error(err);
    }
  };

  const openAddModal = async () => {
    setShowAddModal(true);
    setSelectedPhotoIds(new Set());
    if (events.length === 0) {
      try {
        const data = await getEvents();
        setEvents(data);
      } catch (err) {
        console.error('Failed to load events:', err);
      }
    }
  };

  const selectEvent = async (slug: string) => {
    setSelectedEventSlug(slug);
    setEventPhotos([]);
    setLoadingEventPhotos(true);
    try {
      const data = await getPhotos(slug);
      setEventPhotos(data);
    } catch (err) {
      console.error('Failed to load event photos:', err);
    } finally {
      setLoadingEventPhotos(false);
    }
  };

  const togglePhotoSelection = (photoId: string) => {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const handleAddSelected = async () => {
    if (!album || selectedPhotoIds.size === 0) return;
    try {
      await addPhotosToAlbum(album.id, Array.from(selectedPhotoIds));
      setShowAddModal(false);
      await loadData();
    } catch (err) {
      setError('Failed to add photos to album');
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Navbar />
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link to="/admin/albums" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
          ← Back to Albums
        </Link>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        {album && (
          <div className="mb-8">
            <div className="flex justify-between items-start flex-wrap gap-3">
              <div>
                <h1 className="text-4xl font-bold text-gray-900 dark:text-white">{album.name}</h1>
                {album.description && <p className="text-gray-600 dark:text-gray-400 mt-2">{album.description}</p>}
                <p className="text-sm text-gray-500 mt-1">{photos.length} photos</p>
              </div>
              <button
                onClick={openAddModal}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add Photos
              </button>
            </div>
          </div>
        )}

        {photos.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400">No photos in this album yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {photos.map((photo) => (
              <div key={photo.id} className="relative bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden group">
                <div className="aspect-square">
                  <img
                    src={getPreviewUrl(photo.event_slug, photo.id, photo.file_type, photo.cache_version)}
                    alt={photo.original_filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={() => handleSetCover(photo.id)}
                    className="px-2 py-1 bg-blue-600 text-white rounded text-xs"
                  >
                    Set as cover
                  </button>
                  <button
                    onClick={() => handleRemove(photo.id)}
                    className="p-1.5 bg-red-600 text-white rounded"
                    title="Remove from album"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showAddModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
              <div className="p-6 border-b flex justify-between items-center">
                <h2 className="text-2xl font-bold">Add Photos</h2>
                <button onClick={() => setShowAddModal(false)} className="text-gray-500 hover:text-gray-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">Choose event</label>
                <select
                  value={selectedEventSlug || ''}
                  onChange={(e) => selectEvent(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg mb-4"
                >
                  <option value="">Select an event…</option>
                  {events.map((ev) => (
                    <option key={ev.slug} value={ev.slug}>{ev.name}</option>
                  ))}
                </select>

                {loadingEventPhotos ? (
                  <div className="text-center py-8">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                  </div>
                ) : eventPhotos.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {eventPhotos.map((photo) => (
                      <div
                        key={photo.id}
                        onClick={() => togglePhotoSelection(photo.id)}
                        className={`aspect-square rounded-lg overflow-hidden cursor-pointer ring-4 ${
                          selectedPhotoIds.has(photo.id) ? 'ring-blue-500' : 'ring-transparent'
                        }`}
                      >
                        <img
                          src={getPreviewUrl(selectedEventSlug!, photo.id, photo.file_type, photo.cache_version)}
                          alt={photo.original_filename}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                ) : selectedEventSlug ? (
                  <p className="text-gray-500 text-sm">No photos in this event.</p>
                ) : null}
              </div>
              <div className="p-6 border-t flex gap-3">
                <button
                  onClick={handleAddSelected}
                  disabled={selectedPhotoIds.size === 0}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                >
                  Add {selectedPhotoIds.size > 0 ? `${selectedPhotoIds.size} ` : ''}Photo{selectedPhotoIds.size === 1 ? '' : 's'}
                </button>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminAlbumDetail;
