import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Users, Pencil, Trash2, Check, X, UserPlus } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getPerson, updatePerson, deletePerson, getPreviewUrl, searchUsers } from '../api';
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
  const [linkEmailInput, setLinkEmailInput] = useState('');
  const [linkSuggestions, setLinkSuggestions] = useState<Array<{ email: string; name: string | null }>>([]);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const linkSearchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  const handleLinkEmailChange = (value: string) => {
    setLinkEmailInput(value);
    setLinkError(null);
    if (linkSearchTimeout.current) clearTimeout(linkSearchTimeout.current);
    if (value.trim().length < 2) {
      setLinkSuggestions([]);
      return;
    }
    linkSearchTimeout.current = setTimeout(async () => {
      try {
        setLinkSuggestions(await searchUsers(value));
      } catch (err) {
        console.error('Failed to search users:', err);
      }
    }, 300);
  };

  const handleLinkAccount = async (email: string) => {
    if (!person) return;
    try {
      setLinking(true);
      setLinkError(null);
      await updatePerson(person.id, { linkedUserEmail: email });
      const data = await getPerson(person.id);
      setPerson(data.person);
      setLinkEmailInput('');
      setLinkSuggestions([]);
    } catch (err: any) {
      setLinkError(err.response?.data?.error || 'Failed to link account');
      console.error(err);
    } finally {
      setLinking(false);
    }
  };

  const handleUnlinkAccount = async () => {
    if (!person) return;
    try {
      setLinking(true);
      setLinkError(null);
      await updatePerson(person.id, { linkedUserEmail: null });
      setPerson({ ...person, linked_user_email: null, linked_user_name: null });
    } catch (err) {
      setLinkError('Failed to unlink account');
      console.error(err);
    } finally {
      setLinking(false);
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
                    placeholder="Full name (e.g. Jane Doe)"
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
        <p className="text-sm text-gray-500 mb-2">
          Full name is admin-only — if this person's account is linked below, they'll only ever
          see their first name on the Timeline's "Just me" filter toggle.
        </p>

        {person && (
          <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
              <UserPlus className="w-4 h-4" /> Linked account
            </h2>
            {person.linked_user_email ? (
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Linked to <strong>{person.linked_user_name || person.linked_user_email}</strong>{' '}
                  ({person.linked_user_email}) — a "Just me" filter toggle now appears for them
                  on the Timeline.
                </p>
                <button
                  onClick={handleUnlinkAccount}
                  disabled={linking}
                  className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition disabled:opacity-50"
                >
                  Unlink
                </button>
              </div>
            ) : (
              <div className="relative">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  Link this person to an existing account so they get a "Just me" filter toggle
                  on the Timeline.
                </p>
                <input
                  type="text"
                  value={linkEmailInput}
                  onChange={(e) => handleLinkEmailChange(e.target.value)}
                  placeholder="Search by email…"
                  disabled={linking}
                  className="w-full max-w-sm px-3 py-2 border rounded-lg text-sm"
                />
                {linkSuggestions.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full max-w-sm bg-white dark:bg-gray-700 border rounded-lg shadow-lg">
                    {linkSuggestions.map((u) => (
                      <li key={u.email}>
                        <button
                          onClick={() => handleLinkAccount(u.email)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-600"
                        >
                          {u.name ? `${u.name} — ${u.email}` : u.email}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {linkError && <p className="text-sm text-red-600 mt-2">{linkError}</p>}
              </div>
            )}
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
