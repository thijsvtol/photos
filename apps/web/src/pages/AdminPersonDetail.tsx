import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Users, Pencil, Trash2, Check, X, UserPlus, GitMerge, MoveRight, UserMinus } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getPerson, updatePerson, deletePerson, getPreviewUrl, searchUsers, getPeople, mergePeople, assignPhotosToPerson, removePersonFromPhoto } from '../api';
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

  // "Combine with another person" — lets an admin merge a second, duplicate person group into
  // this one (same underlying mergePeople() the automatic "Find Merge Suggestions" flow uses,
  // just admin-picked instead of algorithm-suggested — useful when the admin spots a duplicate
  // themselves without waiting for a suggestion scan). allPeople is fetched lazily (only once
  // this section is opened) since it's not needed for the rest of the page.
  const [showCombine, setShowCombine] = useState(false);
  const [allPeople, setAllPeople] = useState<Person[] | null>(null);
  const [combineSearch, setCombineSearch] = useState('');
  const [combining, setCombining] = useState(false);
  const [combineError, setCombineError] = useState<string | null>(null);

  // "Move to another person" — per-photo action to correct a misclustered/never-clustered
  // photo. Also reuses the lazily-fetched allPeople list.
  const [movingPhotoId, setMovingPhotoId] = useState<string | null>(null);
  const [moveSearch, setMoveSearch] = useState('');
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  // "Remove" — unattaches this person from a single photo entirely (both an automatically-
  // detected face assignment and any manual tag — see removePersonFromPhoto()'s doc comment in
  // apps/worker/src/faceClustering.ts), for a photo that doesn't actually contain this person
  // (a false-positive clustering/tagging mistake), as opposed to "Move to…" which reassigns it
  // to a DIFFERENT person.
  const [removingPhotoId, setRemovingPhotoId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

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

  // Fetches the full people list (incl. singles) once, lazily — used by both the "Combine"
  // and per-photo "Move to" pickers below so opening either doesn't require a second load if
  // the admin uses both in the same visit.
  const ensurePeopleLoaded = async () => {
    if (allPeople) return allPeople;
    const data = await getPeople(true);
    setAllPeople(data);
    return data;
  };

  const handleOpenCombine = async () => {
    setCombineError(null);
    setShowCombine(true);
    try {
      await ensurePeopleLoaded();
    } catch (err) {
      setCombineError('Failed to load people');
      console.error(err);
    }
  };

  const handleCombineWith = async (otherPersonId: number) => {
    if (!person) return;
    try {
      setCombining(true);
      setCombineError(null);
      await mergePeople(person.id, [otherPersonId]);
      await loadData();
      setShowCombine(false);
      setCombineSearch('');
    } catch (err) {
      setCombineError('Failed to combine people');
      console.error(err);
    } finally {
      setCombining(false);
    }
  };

  const handleOpenMovePhoto = async (photoId: string) => {
    setMoveError(null);
    setMovingPhotoId(photoId);
    setMoveSearch('');
    try {
      await ensurePeopleLoaded();
    } catch (err) {
      setMoveError('Failed to load people');
      console.error(err);
    }
  };

  const handleMovePhotoTo = async (targetPersonId: number, photoId: string) => {
    try {
      setMoving(true);
      setMoveError(null);
      await assignPhotosToPerson(targetPersonId, [photoId]);
      // This photo no longer belongs to the CURRENT person, so drop it from the list locally
      // rather than waiting for a full reload.
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      setMovingPhotoId(null);
    } catch (err) {
      setMoveError('Failed to move photo');
      console.error(err);
    } finally {
      setMoving(false);
    }
  };

  const handleRemovePhoto = async (photoId: string) => {
    if (!person) return;
    try {
      setRemovingPhotoId(photoId);
      setRemoveError(null);
      await removePersonFromPhoto(photoId, person.id);
      // Same as "Move to…" above — this photo no longer belongs to the current person, so drop
      // it from the list locally instead of a full reload.
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch (err) {
      setRemoveError('Failed to remove photo from this person');
      console.error(err);
    } finally {
      setRemovingPhotoId(null);
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
                    className="text-2xl font-bold px-2 py-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg"
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
                  <button onClick={() => setEditingName(true)} className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
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
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          Full name is admin-only — if this person's account is linked below, they'll only ever
          see their first name on the Timeline's "Just me" filter toggle.
        </p>

        {person && (
          <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <GitMerge className="w-4 h-4" /> Combine with another person
              </h2>
              {!showCombine && (
                <button
                  onClick={handleOpenCombine}
                  className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition"
                >
                  Combine…
                </button>
              )}
            </div>
            {showCombine && (
              <div className="relative">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  Merges another person group into this one — all their photos move here and
                  this person's face-matching improves from the correction. This cannot be
                  undone automatically.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={combineSearch}
                    onChange={(e) => setCombineSearch(e.target.value)}
                    placeholder="Search by name…"
                    disabled={combining}
                    autoFocus
                    className="w-full max-w-sm px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm"
                  />
                  <button
                    onClick={() => { setShowCombine(false); setCombineSearch(''); setCombineError(null); }}
                    className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition"
                  >
                    Cancel
                  </button>
                </div>
                {allPeople === null ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Loading people…</p>
                ) : (
                  <ul className="mt-2 max-h-64 overflow-y-auto border rounded-lg divide-y dark:divide-gray-700">
                    {allPeople
                      .filter((p) => p.id !== person.id)
                      .filter((p) => !combineSearch.trim() || (p.name || 'Unnamed').toLowerCase().includes(combineSearch.trim().toLowerCase()))
                      .slice(0, 25)
                      .map((p) => (
                        <li key={p.id}>
                          <button
                            onClick={() => handleCombineWith(p.id)}
                            disabled={combining}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between disabled:opacity-50"
                          >
                            <span>{p.name || 'Unnamed'}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">{p.photo_count} photo{p.photo_count === 1 ? '' : 's'}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
                {combineError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{combineError}</p>}
              </div>
            )}
          </div>
        )}

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
                  className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition disabled:opacity-50"
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
                  className="w-full max-w-sm px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm"
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
                {linkError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{linkError}</p>}
              </div>
            )}
          </div>
        )}

        <p className="text-sm text-gray-500 mb-6">{photos.length} photo{photos.length === 1 ? '' : 's'}</p>
        {removeError && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{removeError}</p>}

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
                <div className="absolute top-2 right-2 flex flex-col items-end gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button
                    onClick={() => handleSetCover(photo.id)}
                    className="px-2 py-1 bg-blue-600 text-white rounded text-xs"
                  >
                    Set as cover
                  </button>
                  <button
                    onClick={() => handleOpenMovePhoto(photo.id)}
                    className="px-2 py-1 bg-gray-700 text-white rounded text-xs flex items-center gap-1"
                  >
                    <MoveRight className="w-3 h-3" /> Move to…
                  </button>
                  <button
                    onClick={() => handleRemovePhoto(photo.id)}
                    disabled={removingPhotoId === photo.id}
                    title="Remove this photo from this person (not the same person)"
                    className="px-2 py-1 bg-red-600 text-white rounded text-xs flex items-center gap-1 disabled:opacity-50"
                  >
                    <UserMinus className="w-3 h-3" /> {removingPhotoId === photo.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
                {movingPhotoId === photo.id && (
                  <div className="absolute inset-0 bg-black/70 p-2 flex flex-col z-10">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-white text-xs font-medium">Move to person</span>
                      <button onClick={() => setMovingPhotoId(null)} className="text-white">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={moveSearch}
                      onChange={(e) => setMoveSearch(e.target.value)}
                      placeholder="Search by name…"
                      disabled={moving}
                      autoFocus
                      className="w-full px-2 py-1 text-xs rounded mb-1"
                    />
                    <div className="flex-1 overflow-y-auto bg-white rounded">
                      {allPeople === null ? (
                        <p className="text-xs text-gray-500 p-2">Loading…</p>
                      ) : (
                        <ul className="divide-y">
                          {allPeople
                            .filter((p) => p.id !== person?.id)
                            .filter((p) => !moveSearch.trim() || (p.name || 'Unnamed').toLowerCase().includes(moveSearch.trim().toLowerCase()))
                            .slice(0, 15)
                            .map((p) => (
                              <li key={p.id}>
                                <button
                                  onClick={() => handleMovePhotoTo(p.id, photo.id)}
                                  disabled={moving}
                                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-gray-100 disabled:opacity-50"
                                >
                                  {p.name || 'Unnamed'}
                                </button>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                    {moveError && <p className="text-xs text-red-300 mt-1">{moveError}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {confirmingDelete && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4 text-red-600 dark:text-red-400">Delete Person</h2>
                <p className="mb-4 text-gray-700 dark:text-gray-300">
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
                    className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition"
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
