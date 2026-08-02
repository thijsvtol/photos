import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Users, Pencil, Trash2, Check, X } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getPerson, updatePerson, deletePerson, getPreviewUrl } from '../api';
import type { Person, PersonPhoto } from '../api';

const AdminPersonDetail: React.FC = () => {
  const { personId } = useParams<{ personId: string }>();
  const navigate = useNavigate();
  const [person, setPerson] = useState<Person | null>(null);
  const [photos, setPhotos] = useState<PersonPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (personId) loadData();
  }, [personId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await getPerson(parseInt(personId!, 10));
      setPerson(data.person);
      setPhotos(data.photos);
      setNameInput(data.person.name || '');
      setError(null);
    } catch (err) {
      setError('Failed to load person');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveName = async () => {
    if (!person) return;
    try {
      await updatePerson(person.id, { name: nameInput.trim() || null });
      setPerson({ ...person, name: nameInput.trim() || null });
      setEditingName(false);
    } catch (err) {
      setError('Failed to rename person');
      console.error(err);
    }
  };

  const handleSetCover = async (photoId: string) => {
    if (!person) return;
    try {
      await updatePerson(person.id, { coverPhotoId: photoId });
      setPerson({ ...person, cover_photo_id: photoId });
    } catch (err) {
      setError('Failed to set cover photo');
      console.error(err);
    }
  };

  const handleDelete = async () => {
    if (!person) return;
    try {
      await deletePerson(person.id);
      navigate('/admin/people');
    } catch (err) {
      setError('Failed to delete person');
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
        <Link to="/admin/people" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
          ← Back to People
        </Link>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        {person && (
          <div className="mb-8 flex justify-between items-start flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Users className="w-8 h-8 text-gray-400" />
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Enter a name"
                    className="text-2xl font-bold px-2 py-1 border rounded-lg"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                  />
                  <button onClick={handleSaveName} className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingName(false)} className="p-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="text-4xl font-bold text-gray-900 dark:text-white">{person.name || 'Unnamed'}</h1>
                  <button onClick={() => setEditingName(true)} className="p-2 text-gray-500 hover:text-gray-700">
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => setConfirmingDelete(true)}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> Delete Person
            </button>
          </div>
        )}
        <p className="text-sm text-gray-500 mb-6">{photos.length} photo{photos.length === 1 ? '' : 's'}</p>

        {photos.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400">No photos found for this person.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {photos.map((photo) => (
              <div key={photo.id} className="relative bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden group">
                <Link to={`/p/${photo.event_slug}/${photo.id}`}>
                  <div className="aspect-square">
                    <img
                      src={getPreviewUrl(photo.event_slug, photo.id, photo.file_type, photo.cache_version)}
                      alt={photo.original_filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                </Link>
                <button
                  onClick={() => handleSetCover(photo.id)}
                  className="absolute top-2 right-2 px-2 py-1 bg-blue-600 text-white rounded text-xs opacity-0 group-hover:opacity-100 transition"
                >
                  Set as cover
                </button>
              </div>
            ))}
          </div>
        )}

        {confirmingDelete && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4 text-red-600">Delete Person</h2>
                <p className="mb-4 text-gray-700">
                  Delete this person group? Their faces will be un-grouped (not deleted) and may be
                  re-clustered automatically later.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleDelete}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(false)}
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

export default AdminPersonDetail;
