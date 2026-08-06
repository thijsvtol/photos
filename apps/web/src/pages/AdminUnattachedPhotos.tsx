import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Check, X, UserPlus } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getUnattachedPhotos, getPeople, assignPhotosToPerson, getPreviewUrl } from '../api';
import type { UnattachedPhoto, Person } from '../api';

/**
 * Admin "Unattached photos" view (/admin/people/unattached) — lists every photo with NO person
 * attached at all (neither an auto-detected face assigned to a person nor a manual tag; see
 * getUnattachedPhotos()'s doc comment in apps/worker/src/faceClustering.ts), so an admin can
 * find and bulk-assign photos that clustering/tagging never touched instead of only ever
 * discovering them one event/photo at a time. Reuses the existing "assign photos to person"
 * action (assignPhotosToPerson, the same one AdminPersonDetail's per-photo "Move to…" button
 * uses) applied to a multi-select instead of a single photo.
 */
const AdminUnattachedPhotos: React.FC = () => {
  const [photos, setPhotos] = useState<UnattachedPhoto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Assign-to-person picker for the current selection — same lazily-loaded people list +
  // searchable dropdown pattern as AdminPersonDetail's "Move to…"/"Combine" pickers.
  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const [allPeople, setAllPeople] = useState<Person[] | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignResult, setAssignResult] = useState<string | null>(null);

  useEffect(() => {
    loadFirstPage();
  }, []);

  const loadFirstPage = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getUnattachedPhotos(null);
      setPhotos(data.photos);
      setNextCursor(data.nextCursor);
    } catch (err) {
      setError('Failed to load unattached photos');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    try {
      setLoadingMore(true);
      const data = await getUnattachedPhotos(nextCursor);
      setPhotos((prev) => [...prev, ...data.photos]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      setError('Failed to load more photos');
      console.error(err);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleSelected = (photoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const selectAllLoaded = () => setSelected(new Set(photos.map((p) => p.id)));
  const clearSelection = () => setSelected(new Set());

  const handleOpenAssignPicker = async () => {
    if (selected.size === 0) return;
    setAssignError(null);
    setAssignResult(null);
    setShowAssignPicker(true);
    if (!allPeople) {
      try {
        setAllPeople(await getPeople(true));
      } catch (err) {
        setAssignError('Failed to load people');
        console.error(err);
      }
    }
  };

  const handleAssignTo = async (personId: number, personName: string) => {
    const photoIds = Array.from(selected);
    if (photoIds.length === 0) return;
    try {
      setAssigning(true);
      setAssignError(null);
      const { assigned } = await assignPhotosToPerson(personId, photoIds);
      // Assigned photos are no longer unattached — drop them from this list locally.
      setPhotos((prev) => prev.filter((p) => !selected.has(p.id)));
      setAssignResult(`Assigned ${assigned} photo${assigned === 1 ? '' : 's'} to ${personName}.`);
      clearSelection();
      setShowAssignPicker(false);
      setAssignSearch('');
    } catch (err) {
      setAssignError('Failed to assign photos');
      console.error(err);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link to="/admin/people" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
          ← Back to People
        </Link>

        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Users className="w-7 h-7 text-gray-400" /> Unattached photos
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Photos with nobody identified yet — no detected face assigned to a person, and no
              manual tag. Select photos below and assign them to a person.
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        {assignResult && (
          <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded mb-4">
            {assignResult}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-white"></div>
          </div>
        ) : photos.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400">
              No unattached photos found — every photo has at least one person identified.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3 flex-wrap sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 py-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {selected.size} of {photos.length} selected
              </span>
              <button
                onClick={selectAllLoaded}
                className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition"
              >
                Select all loaded
              </button>
              {selected.size > 0 && (
                <button
                  onClick={clearSelection}
                  className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition"
                >
                  Clear selection
                </button>
              )}
              <button
                onClick={handleOpenAssignPicker}
                disabled={selected.size === 0}
                className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <UserPlus className="w-4 h-4" /> Assign {selected.size > 0 ? `${selected.size} ` : ''}to person…
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {photos.map((photo) => {
                const isSelected = selected.has(photo.id);
                return (
                  <div
                    key={photo.id}
                    className={`relative bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden cursor-pointer ring-2 transition ${
                      isSelected ? 'ring-blue-500' : 'ring-transparent'
                    }`}
                    onClick={() => toggleSelected(photo.id)}
                  >
                    <div className="aspect-square">
                      <img
                        src={getPreviewUrl(photo.event_slug, photo.id, photo.file_type, photo.cache_version)}
                        alt={photo.original_filename}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    <div
                      className={`absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center border-2 ${
                        isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white/80 dark:bg-gray-900/80 border-gray-300 dark:border-gray-500'
                      }`}
                    >
                      {isSelected && <Check className="w-4 h-4 text-white" />}
                    </div>
                    <div className="p-2">
                      <p className="text-xs text-gray-600 dark:text-gray-400 truncate">{photo.event_name}</p>
                      {photo.has_unclustered_faces && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">Face detected, not identified</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {nextCursor && (
              <div className="text-center mt-6">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}

        {showAssignPicker && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                    Assign {selected.size} photo{selected.size === 1 ? '' : 's'} to…
                  </h2>
                  <button
                    onClick={() => { setShowAssignPicker(false); setAssignSearch(''); setAssignError(null); }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <input
                  type="text"
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  placeholder="Search by name…"
                  disabled={assigning}
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm mb-2"
                />
                {allPeople === null ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Loading people…</p>
                ) : (
                  <ul className="max-h-72 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
                    {allPeople
                      .filter((p) => !assignSearch.trim() || (p.name || 'Unnamed').toLowerCase().includes(assignSearch.trim().toLowerCase()))
                      .slice(0, 30)
                      .map((p) => (
                        <li key={p.id}>
                          <button
                            onClick={() => handleAssignTo(p.id, p.name || 'Unnamed')}
                            disabled={assigning}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between disabled:opacity-50"
                          >
                            <span className="text-gray-900 dark:text-gray-100">{p.name || 'Unnamed'}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">{p.photo_count} photo{p.photo_count === 1 ? '' : 's'}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
                {assignError && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{assignError}</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminUnattachedPhotos;
