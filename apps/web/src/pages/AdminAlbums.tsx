import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderPlus, Images, Trash2 } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getAlbums, createAlbum, deleteAlbum, getPreviewUrl } from '../api';
import type { Album } from '../api';

const AdminAlbums: React.FC = () => {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [newAlbumDescription, setNewAlbumDescription] = useState('');
  const [deletingAlbum, setDeletingAlbum] = useState<Album | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await getAlbums();
      setAlbums(data);
      setError(null);
    } catch (err) {
      setError('Failed to load albums');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlbumName.trim()) return;
    try {
      await createAlbum(newAlbumName.trim(), newAlbumDescription.trim() || undefined);
      setNewAlbumName('');
      setNewAlbumDescription('');
      setShowCreateForm(false);
      await loadData();
    } catch (err) {
      setError('Failed to create album');
      console.error(err);
    }
  };

  const handleDelete = async (albumId: number) => {
    try {
      await deleteAlbum(albumId);
      setAlbums((prev) => prev.filter((a) => a.id !== albumId));
      setDeletingAlbum(null);
    } catch (err) {
      setError('Failed to delete album');
      console.error(err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex justify-between items-center flex-wrap gap-3">
          <div>
            <Link to="/admin" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
              ← Back to Admin
            </Link>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <Images className="w-8 h-8" /> Albums
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Cross-event photo collections, independent of your events.
            </p>
          </div>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
          >
            <FolderPlus className="w-4 h-4" /> New Album
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          </div>
        ) : albums.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400">No albums yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {albums.map((album) => (
              <div key={album.id} className="relative bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden group">
                <Link to={`/admin/albums/${album.id}`}>
                  <div className="aspect-square bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                    {album.cover_photo_id && album.cover_event_slug ? (
                      <img
                        src={getPreviewUrl(album.cover_event_slug, album.cover_photo_id, album.cover_file_type || undefined, album.cover_cache_version || undefined)}
                        alt={album.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <Images className="w-10 h-10 text-gray-400" />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="font-medium text-gray-900 dark:text-white truncate">{album.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{album.photo_count ?? 0} photos</p>
                  </div>
                </Link>
                <button
                  onClick={() => setDeletingAlbum(album)}
                  className="absolute top-2 right-2 p-1.5 bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition"
                  title="Delete album"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {showCreateForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <form onSubmit={handleCreate} className="p-6">
                <h2 className="text-2xl font-bold mb-4">New Album</h2>
                <input
                  type="text"
                  value={newAlbumName}
                  onChange={(e) => setNewAlbumName(e.target.value)}
                  placeholder="Album name"
                  className="w-full px-3 py-2 border rounded-lg mb-3"
                  autoFocus
                  required
                />
                <textarea
                  value={newAlbumDescription}
                  onChange={(e) => setNewAlbumDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full px-3 py-2 border rounded-lg mb-4"
                  rows={3}
                />
                <div className="flex gap-3">
                  <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {deletingAlbum && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4 text-red-600">Delete Album</h2>
                <p className="mb-4 text-gray-700">
                  Delete <strong>{deletingAlbum.name}</strong>? Photos inside will not be deleted, only removed from this album.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleDelete(deletingAlbum.id)}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setDeletingAlbum(null)}
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

export default AdminAlbums;
