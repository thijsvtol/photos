import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Trash2, Users, Loader2, Hash, FolderCheck } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getDuplicatePhotos, deletePhoto, bulkDeletePhotos, getPreviewUrl, getOriginalUrl, syncPeopleAcrossDuplicates, getPhotosMissingFileHash, setPhotoFileHash } from '../api';
import { computeFileHash } from '../imageUtils';
import type { DuplicateGroup, DuplicatePhoto } from '../api';

const AdminDuplicates: React.FC = () => {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deletingPhoto, setDeletingPhoto] = useState<DuplicatePhoto | null>(null);
  const [syncingPeople, setSyncingPeople] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ done: number } | null>(null);
  // "Keep album X" bulk cleanup — lets an admin pick a single event as the trusted
  // source-of-truth copy and bulk-delete every OTHER duplicate copy of those same photos
  // (found in any other event) in one action, rather than clicking through each group's
  // individual Trash button one photo at a time.
  const [keepEventSlug, setKeepEventSlug] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await getDuplicatePhotos();
      setGroups(data);
      setError(null);
    } catch (err) {
      setError('Failed to load duplicates');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (photo: DuplicatePhoto) => {
    try {
      await deletePhoto(photo.id);
      setGroups((prev) =>
        prev
          .map((g) => ({ ...g, photos: g.photos.filter((p) => p.id !== photo.id) }))
          .filter((g) => g.photos.length > 1)
      );
      setDeletingPhoto(null);
      setSuccess('Photo moved to Trash');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to delete photo');
      console.error(err);
    }
  };

  const totalDuplicates = groups.reduce((sum, g) => sum + (g.photos.length - 1), 0);

  // Every distinct event that appears in at least one duplicate group, sorted by name — the
  // options for the "keep this album" picker below.
  const eventOptions = useMemo(() => {
    const bySlug = new Map<string, string>();
    for (const group of groups) {
      for (const photo of group.photos) {
        if (!bySlug.has(photo.event_slug)) bySlug.set(photo.event_slug, photo.event_name);
      }
    }
    return Array.from(bySlug.entries())
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [groups]);

  // Every OTHER-event photo that's a duplicate of something already in `keepEventSlug` — these
  // are exactly what the bulk action below deletes. A group only qualifies if it actually
  // contains a photo from the kept event (a group with no photo from that event is unrelated).
  const photosToDeleteForKeptEvent = useMemo(() => {
    if (!keepEventSlug) return [];
    const result: DuplicatePhoto[] = [];
    for (const group of groups) {
      const hasKeptCopy = group.photos.some((p) => p.event_slug === keepEventSlug);
      if (!hasKeptCopy) continue;
      for (const photo of group.photos) {
        if (photo.event_slug !== keepEventSlug) result.push(photo);
      }
    }
    return result;
  }, [groups, keepEventSlug]);

  const handleBulkDeleteForKeptEvent = async () => {
    if (photosToDeleteForKeptEvent.length === 0) return;
    try {
      setBulkDeleting(true);
      setError(null);
      const photoIds = photosToDeleteForKeptEvent.map((p) => p.id);
      const { deletedCount } = await bulkDeletePhotos(photoIds);
      const deletedIds = new Set(photoIds);
      setGroups((prev) =>
        prev
          .map((g) => ({ ...g, photos: g.photos.filter((p) => !deletedIds.has(p.id)) }))
          .filter((g) => g.photos.length > 1)
      );
      setConfirmingBulkDelete(false);
      setSuccess(`Moved ${deletedCount} duplicate photo${deletedCount === 1 ? '' : 's'} to Trash, keeping the copies in the selected album.`);
      setTimeout(() => setSuccess(null), 5000);
      setKeepEventSlug('');
    } catch (err) {
      setError('Failed to bulk-delete duplicates');
      console.error(err);
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleSyncPeople = async () => {
    try {
      setSyncingPeople(true);
      setError(null);
      const { groupsSynced, tagsAdded } = await syncPeopleAcrossDuplicates();
      setSuccess(
        tagsAdded > 0
          ? `Synced people across ${groupsSynced} duplicate group${groupsSynced === 1 ? '' : 's'} (${tagsAdded} tag${tagsAdded === 1 ? '' : 's'} added).`
          : 'Everything is already in sync — no missing tags found.'
      );
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      setError('Failed to sync people across duplicates');
      console.error(err);
    } finally {
      setSyncingPeople(false);
    }
  };

  /**
   * One-time repair for the real root cause of "No duplicate photos found" when duplicates
   * DO exist: file_hash was NULL for essentially every photo uploaded via the Android app's
   * native background-sync path (a bug fixed 2026-08-06 — see backgroundSync.ts's fix comment),
   * plus any photo uploaded before the file_hash column/feature existed at all. Backfills it by
   * downloading each hash-less photo's ORIGINAL file (fetch, same-origin, admin session cookie
   * applies automatically — same approach downloadInstagram() already uses), hashing it
   * client-side with the same SHA-256 logic uploads use, then PATCHing the result back. Runs
   * one page (50 photos) at a time so progress is visible and a failure partway through doesn't
   * lose all prior progress. Re-runs GET /duplicates afterwards to pick up any newly-matched
   * groups.
   */
  const handleBackfillHashes = async () => {
    try {
      setBackfilling(true);
      setError(null);
      setBackfillProgress({ done: 0 });

      let cursor: string | null = null;
      let done = 0;
      for (;;) {
        const { photos, nextCursor } = await getPhotosMissingFileHash(cursor, 50);
        for (const photo of photos) {
          try {
            const url = getOriginalUrl(photo.event_slug, photo.id, photo.file_type, photo.cache_version ?? undefined);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch original: ${response.statusText}`);
            const blob = await response.blob();
            const fileHash = await computeFileHash(blob);
            if (fileHash) {
              await setPhotoFileHash(photo.id, fileHash);
            }
          } catch (photoErr) {
            // Best-effort — one unreadable/missing original shouldn't abort the whole backfill.
            console.warn(`[Backfill file hashes] Failed for photo ${photo.id}:`, photoErr);
          }
          done++;
          setBackfillProgress({ done });
        }
        if (!nextCursor) break;
        cursor = nextCursor;
      }

      setSuccess(`Backfilled file hashes for ${done} photo${done === 1 ? '' : 's'}. Reloading duplicates…`);
      setTimeout(() => setSuccess(null), 5000);
      await loadData();
    } catch (err) {
      setError('Failed to backfill file hashes');
      console.error(err);
    } finally {
      setBackfilling(false);
      setBackfillProgress(null);
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
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <Copy className="w-8 h-8" /> Duplicate Photos
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Photos with identical content (same file bytes), possibly uploaded to different
            events. {totalDuplicates > 0 && `${totalDuplicates} extra cop${totalDuplicates === 1 ? 'y' : 'ies'} found.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={handleBackfillHashes}
              disabled={backfilling}
              title="Computes a content hash for every photo AND video that's missing one, so duplicate detection can find them — downloads each affected original once to hash it (videos can be large, so this may transfer a lot of data), retroactively"
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition flex items-center gap-2 disabled:opacity-50"
            >
              {backfilling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Hash className="w-4 h-4" />}
              {backfilling
                ? `Hashing… (${backfillProgress?.done ?? 0})`
                : 'Backfill file hashes'}
            </button>
            {groups.length > 0 && (
              <button
                onClick={handleSyncPeople}
                disabled={syncingPeople}
                title="If a person is already identified (face or manual tag) on one copy of a duplicate photo, add them to every other copy that's missing it — no need to redo tagging per event"
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition flex items-center gap-2 disabled:opacity-50"
              >
                {syncingPeople ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                {syncingPeople ? 'Syncing…' : 'Sync people across duplicates'}
              </button>
            )}
          </div>
        </div>

        {groups.length > 0 && (
          <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-2">
              <FolderCheck className="w-4 h-4" /> Keep an album, delete its duplicates elsewhere
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Pick an event below — every OTHER-event copy of a photo that's already in that
              event will be moved to Trash in one go, instead of clicking through each
              duplicate set individually.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={keepEventSlug}
                onChange={(e) => setKeepEventSlug(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg"
              >
                <option value="">Select an album…</option>
                {eventOptions.map((e) => (
                  <option key={e.slug} value={e.slug}>{e.name}</option>
                ))}
              </select>
              <button
                onClick={() => setConfirmingBulkDelete(true)}
                disabled={!keepEventSlug || photosToDeleteForKeptEvent.length === 0 || bulkDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                {keepEventSlug
                  ? `Delete ${photosToDeleteForKeptEvent.length} duplicate${photosToDeleteForKeptEvent.length === 1 ? '' : 's'} elsewhere`
                  : 'Delete duplicates elsewhere'}
              </button>
            </div>
          </div>
        )}

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
            <p className="mt-4 text-gray-600">Scanning for duplicates...</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400">No duplicate photos found 🎉</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.fileHash} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {group.photos.map((photo) => (
                    <div key={photo.id} className="flex-shrink-0 w-40 relative group">
                      <div className="aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
                        <img
                          src={getPreviewUrl(photo.event_slug, photo.id, photo.file_type, photo.cache_version)}
                          alt={photo.original_filename}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      <button
                        onClick={() => setDeletingPhoto(photo)}
                        className="absolute top-2 right-2 p-1.5 bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition"
                        title="Move to Trash"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <p className="text-xs text-gray-600 dark:text-gray-400 truncate mt-1">{photo.original_filename}</p>
                      <p className="text-xs text-gray-400 truncate">{photo.event_name}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {confirmingBulkDelete && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4 text-red-600">🗑️ Move to Trash</h2>
                <p className="mb-4 text-gray-700 dark:text-gray-300">
                  Move {photosToDeleteForKeptEvent.length} duplicate photo{photosToDeleteForKeptEvent.length === 1 ? '' : 's'} to
                  Trash, keeping the copies already in <strong>{eventOptions.find((e) => e.slug === keepEventSlug)?.name}</strong>?
                  This cannot be undone (though Trash items are recoverable for a while).
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleBulkDeleteForKeptEvent}
                    disabled={bulkDeleting}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {bulkDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {bulkDeleting ? 'Deleting…' : 'Move to Trash'}
                  </button>
                  <button
                    onClick={() => setConfirmingBulkDelete(false)}
                    disabled={bulkDeleting}
                    className="flex-1 px-4 py-2 bg-gray-300 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {deletingPhoto && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4 text-red-600">🗑️ Move to Trash</h2>
                <p className="mb-4 text-gray-700">
                  Move <strong>{deletingPhoto.original_filename}</strong> ({deletingPhoto.event_name}) to Trash?
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleDelete(deletingPhoto)}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                  >
                    Move to Trash
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

export default AdminDuplicates;
