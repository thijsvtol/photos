import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Trash2, Users, Loader2, Hash } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getDuplicatePhotos, deletePhoto, getPreviewUrl, getOriginalUrl, syncPeopleAcrossDuplicates, getPhotosMissingFileHash, setPhotoFileHash } from '../api';
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
              title="Photos uploaded via the Android app never got a content hash computed until this was fixed, so duplicate detection couldn't find them — this downloads and hashes every affected photo once, retroactively"
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
