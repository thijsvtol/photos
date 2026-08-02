import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, ScanFace, Loader2, Sparkles, Eye, EyeOff } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getPeople, getPreviewUrl, clusterPeopleNow } from '../api';
import type { Person } from '../api';
import { runBackfillScan } from '../faceBackfill';
import type { BackfillProgress } from '../faceBackfill';

const AdminPeople: React.FC = () => {
  // Holds EVERY cluster (including single-photo ones) so the UI can tell the
  // difference between "clustering hasn't found anyone yet" and "clustering
  // found groups, they're just all single-photo so far and hidden by
  // default" — fetching once with includeSingles=true and filtering
  // client-side avoids a confusing second round-trip just to answer that
  // question, and keeps the toggle below instant (no re-fetch).
  const [allPeople, setAllPeople] = useState<Person[]>([]);
  const [showSingles, setShowSingles] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<BackfillProgress | null>(null);
  const cancelRef = useRef(false);
  const [clustering, setClustering] = useState(false);
  const [clusterRemaining, setClusterRemaining] = useState<number | null>(null);
  const clusterCancelRef = useRef(false);

  const multiPhotoPeople = allPeople.filter((p) => p.face_count >= 2);
  const singlesCount = allPeople.length - multiPhotoPeople.length;
  const people = showSingles ? allPeople : multiPhotoPeople;

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await getPeople(true);
      setAllPeople(data);
      setError(null);
    } catch (err) {
      setError('Failed to load people');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleScanLibrary = async () => {
    setScanning(true);
    setScanProgress(null);
    cancelRef.current = false;
    try {
      await runBackfillScan((progress) => {
        setScanProgress(progress);
        if (cancelRef.current) return false;
      });
      await loadData();
    } catch (err) {
      setError('Face scan failed');
      console.error(err);
    } finally {
      setScanning(false);
    }
  };

  const handleCancelScan = () => {
    cancelRef.current = true;
  };

  const handleClusterNow = async () => {
    setClustering(true);
    setClusterRemaining(null);
    clusterCancelRef.current = false;
    try {
      // Loop the manual clustering pass (each call is itself internally
      // time-budgeted server-side, see faceClustering.ts) until the backlog
      // is fully drained, so a big backfill doesn't have to wait for the
      // hourly cron to trickle through it 200 faces at a time.
      for (;;) {
        const { processed, remaining } = await clusterPeopleNow();
        setClusterRemaining(remaining);
        if (remaining === 0 || processed === 0 || clusterCancelRef.current) break;
      }
      await loadData();
    } catch (err) {
      setError('Clustering failed');
      console.error(err);
    } finally {
      setClustering(false);
    }
  };

  const handleCancelCluster = () => {
    clusterCancelRef.current = true;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link to="/admin" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
          ← Back to Admin
        </Link>
        <div className="flex justify-between items-start flex-wrap gap-3 mb-2">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <Users className="w-8 h-8" /> People
          </h1>
          {scanning ? (
            <button
              onClick={handleCancelScan}
              className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition flex items-center gap-2"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              {scanProgress ? `Scanned ${scanProgress.processed} (${scanProgress.remaining} left) — Stop` : 'Starting scan…'}
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleScanLibrary}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
              >
                <ScanFace className="w-4 h-4" /> Scan Library for Faces
              </button>
              {clustering ? (
                <button
                  onClick={handleCancelCluster}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition flex items-center gap-2"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {clusterRemaining !== null ? `Grouping… ${clusterRemaining} left — Stop` : 'Starting…'}
                </button>
              ) : (
                <button
                  onClick={handleClusterNow}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4" /> Cluster Now
                </button>
              )}
              {singlesCount > 0 && (
                <button
                  onClick={() => setShowSingles((v) => !v)}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition flex items-center gap-2"
                >
                  {showSingles ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {showSingles ? 'Hide' : 'Show'} {singlesCount} single-photo group{singlesCount === 1 ? '' : 's'}
                </button>
              )}
            </div>
          )}
        </div>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Faces are detected client-side (in your browser) as photos are uploaded. Photos uploaded
          before this feature existed aren't processed automatically — use "Scan Library for Faces"
          to backfill them (this runs in your browser and may take a while for large libraries; you
          can stop and resume anytime). Groups with only one photo are hidden by default (often the
          same person just hasn't been matched to another photo of them YET — clustering improves
          as more of their photos get grouped). Detected faces are grouped into named people by a
          background job that normally runs hourly — use "Cluster Now" to run it immediately
          instead of waiting (useful right after a large scan; it may take several clicks/minutes
          for a very large backlog since each pass only processes a small batch).
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          </div>
        ) : allPeople.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400">
              No people detected yet. New uploads are processed automatically — for existing
              photos, click "Scan Library for Faces" above to process them.
            </p>
          </div>
        ) : people.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400">
              Found {allPeople.length} face group{allPeople.length === 1 ? '' : 's'} so far, but each
              only has a single photo — these are hidden by default since they're often not yet
              matched to the rest of that person's photos. Click "Show {singlesCount} single-photo
              group{singlesCount === 1 ? '' : 's'}" above to see them anyway, or run "Cluster Now"
              again in a bit as more matches accumulate.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {people.map((person) => (
              <Link
                key={person.id}
                to={`/admin/people/${person.id}`}
                className="text-center group"
              >
                <div className="aspect-square rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 mx-auto w-24 h-24 sm:w-28 sm:h-28 shadow group-hover:shadow-lg transition-shadow">
                  {person.cover_event_slug && person.cover_photo_id && person.cover_file_type ? (
                    <img
                      src={getPreviewUrl(person.cover_event_slug, person.cover_photo_id, person.cover_file_type, person.cover_cache_version || undefined)}
                      alt={person.name || 'Unnamed person'}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Users className="w-10 h-10 text-gray-400 m-auto mt-8" />
                  )}
                </div>
                <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white truncate">
                  {person.name || 'Unnamed'}
                </p>
                <p className="text-xs text-gray-500">{person.face_count} photo{person.face_count === 1 ? '' : 's'}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPeople;
