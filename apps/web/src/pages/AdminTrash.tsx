import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getTrash, restorePhoto, permanentlyDeletePhoto, emptyTrash, getPreviewUrl } from '../api';
import type { TrashPhoto } from '../api';

const AdminTrash: React.FC = () => {
  const [photos, setPhotos] = useState<TrashPhoto[]>([]);
  const [retentionDays, setRetentionDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const [deletingPhoto, setDeletingPhoto] = useState<TrashPhoto | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await getTrash();
      setPhotos(data.photos);
      setRetentionDays(data.retentionDays);
      setError(null);
    } catch (err) {
      setError('Failed to load trash');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (photoId: string) => {
    try {
      await restorePhoto(photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      setSuccess('Photo restored');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to restore photo');
      console.error(err);
    }
  };

  const handlePermanentDelete = async (photoId: string) => {
    try {
      await permanentlyDeletePhoto(photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      setDeletingPhoto(null);
      setSuccess('Photo permanently deleted');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to permanently delete photo');
      console.error(err);
    }
  };

  const handleEmptyTrash = async () => {
    try {
      const result = await emptyTrash();
      setPhotos([]);
      setConfirmingEmpty(false);
      setSuccess(`Permanently deleted ${result.deletedCount} photo${result.deletedCount === 1 ? '' : 's'}`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to empty trash');
      console.error(err);
    }
  };

  const daysLeft = (deletedAt: string | null | undefined): number => {
    if (!deletedAt) return retentionDays;
    const deletedMs = new Date(deletedAt.replace(' ', 'T') + 'Z').getTime();
    const purgeMs = deletedMs + retentionDays * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.ceil((purgeMs - Date.now()) / (24 * 60 * 60 * 1000)));
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link to="/admin" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
            ← Back to Admin
          </Link>
          <div className="flex justify-between items-center flex-wrap gap-3">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <Trash2 className="w-8 h-8" /> Trash
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                Photos are kept here for {retentionDays} days before being permanently deleted.
              </p>
            </div>
            {photos.length > 0 && (
              <button
                onClick={() => setConfirmingEmpty(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
              >
                Empty Trash
              </button>
            )}
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

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            <p className="mt-4 text-gray-600">Loading trash...</p>
          </div>
        ) : photos.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400">Trash is empty</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {photos.map((photo) => (
              <div key={photo.id} className="relative bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden group">
                <div className="aspect-square">
                  <img
                    src={getPreviewUrl(photo.event_slug, photo.id, photo.file_type, photo.cache_version)}
                    alt={photo.original_filename}
                    className="w-full h-full object-cover opacity-75"
                    loading="lazy"
                  />
                </div>
                <div className="absolute top-2 left-2 bg-gray-900/80 text-white px-2 py-1 rounded text-xs">
                  {daysLeft(photo.deleted_at)}d left
                </div>
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={() => handleRestore(photo.id)}
                    className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm flex items-center gap-1"
                    title="Restore"
                  >
                    <RotateCcw className="w-4 h-4" /> Restore
                  </button>
                  <button
                    onClick={() => setDeletingPhoto(photo)}
                    className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition text-sm"
                    title="Delete forever"
                  >
                    Delete Forever
                  </button>
                </div>
                <div className="p-2">
                  <p className="text-xs text-gray-600 dark:text-gray-400 truncate">{photo.original_filename}</p>
                  <p className="text-xs text-gray-400 truncate">{photo.event_name}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {deletingPhoto && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4 text-red-600 flex items-center gap-2">
                  <AlertTriangle className="w-6 h-6" /> Delete Forever
                </h2>
                <p className="mb-4 text-gray-700">
                  Permanently delete <strong>{deletingPhoto.original_filename}</strong>? This cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handlePermanentDelete(deletingPhoto.id)}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                  >
                    Delete Forever
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

        {confirmingEmpty && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4 text-red-600 flex items-center gap-2">
                  <AlertTriangle className="w-6 h-6" /> Empty Trash
                </h2>
                <p className="mb-4 text-gray-700">
                  Permanently delete all {photos.length} photo{photos.length === 1 ? '' : 's'} in Trash? This cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleEmptyTrash}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                  >
                    Empty Trash
                  </button>
                  <button
                    onClick={() => setConfirmingEmpty(false)}
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

export default AdminTrash;
