import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, ScanFace, Loader2, Sparkles, Eye, EyeOff, GitMerge, X, Check } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getPeople, getPreviewUrl, getClusterData, applyClusteringResults, mergePeople } from '../api';
import type { Person } from '../api';
import { runBackfillScan } from '../faceBackfill';
import type { BackfillProgress } from '../faceBackfill';
import { runClientSideClustering, findClientSideMergeSuggestions, DEFAULT_MERGE_SUGGESTION_THRESHOLD } from '../faceClusteringClient';
import type { MergeSuggestion } from '../faceClusteringClient';

// A second, much more lenient similarity threshold tried automatically only if the default
// (DEFAULT_MERGE_SUGGESTION_THRESHOLD) scan finds literally nothing — this app's action-sports
// photos (helmets/goggles/angles) can legitimately score well under even that already-lowered
// default for genuinely-matching faces, so a library with real duplicates can still come back
// empty at the default. The admin manually reviews every suggestion before merging either way,
// so a much lower bar here just means more (dismissable) candidates, never an unreviewed
// auto-merge.
const FALLBACK_MERGE_THRESHOLD = 0.2;

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
  const [clusterProgress, setClusterProgress] = useState<{ processed: number; total: number } | null>(null);
  const [findingMerges, setFindingMerges] = useState(false);
  const [mergeScanProgress, setMergeScanProgress] = useState<{ comparisons: number; total: number } | null>(null);
  const [mergeSuggestions, setMergeSuggestions] = useState<MergeSuggestion[]>([]);
  const [mergingKey, setMergingKey] = useState<string | null>(null);
  const [usedLenientMergeThreshold, setUsedLenientMergeThreshold] = useState(false);
  const [mergeScanComplete, setMergeScanComplete] = useState(false);
  // Set once when a scan finishes, to how many suggestions it actually found — kept separate
  // from mergeSuggestions.length so the "no results" empty state below doesn't incorrectly
  // reappear after the admin has since merged/dismissed every item from a real result list.
  const [scanFoundCount, setScanFoundCount] = useState(0);

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

  /**
   * Runs the ENTIRE clustering pass client-side in one shot (see faceClusteringClient.ts) —
   * fetches every unclustered face + every existing cluster's centroid, computes assignments
   * in the browser (no CPU-time limit here, unlike the Worker), then POSTs the final results
   * to be persisted. No cursor/loop/"Stop and resume" needed anymore since a browser can finish
   * even a large backlog in well under a second — see repo docs for why this used to be a
   * server-side, budget-limited, multi-call process.
   */
  const handleClusterNow = async () => {
    setClustering(true);
    setClusterProgress(null);
    try {
      const { faces, clusters } = await getClusterData(true);
      if (faces.length === 0) {
        await loadData();
        return;
      }

      const results = await runClientSideClustering(faces, clusters, (processed, total) => {
        setClusterProgress({ processed, total });
      });

      if (results.length > 0) {
        await applyClusteringResults(results);
      }
      await loadData();
    } catch (err) {
      setError('Clustering failed');
      console.error(err);
    } finally {
      setClustering(false);
      setClusterProgress(null);
    }
  };

  // Person clusters are looked up from `allPeople` (already fetched with includeSingles=true)
  // rather than re-fetched per-suggestion, since the merge scan only ever works with bare
  // cluster ids + centroids + a similarity score.
  const personById = (id: number): Person | undefined => allPeople.find((p) => p.id === id);
  const suggestionKey = (s: MergeSuggestion) => `${s.clusterAId}-${s.clusterBId}`;

  /**
   * Runs the ENTIRE O(clusterCount²) merge-suggestion scan client-side in one shot — see
   * faceClusteringClient.ts's findClientSideMergeSuggestions(). No cursor/pagination needed:
   * a browser can examine even hundreds of thousands of pairs in well under a second, unlike
   * the Worker (which used to need many resumed calls to stay within a 10ms CPU budget).
   */
  const handleFindMergeSuggestions = async () => {
    setFindingMerges(true);
    setMergeSuggestions([]);
    setMergeScanProgress(null);
    setUsedLenientMergeThreshold(false);
    setMergeScanComplete(false);
    try {
      // Refresh allPeople first so cover photos/names/face_counts used to render suggestions
      // below are current.
      await loadData();

      const { clusters } = await getClusterData(false);

      const runScan = (minSimilarity: number) =>
        findClientSideMergeSuggestions(clusters, minSimilarity, (comparisons, total) => {
          setMergeScanProgress({ comparisons, total });
        });

      let results = await runScan(DEFAULT_MERGE_SUGGESTION_THRESHOLD);
      // If the default (already-lenient) threshold found nothing, automatically retry once with
      // a much broader one before giving up — see FALLBACK_MERGE_THRESHOLD above for why this is
      // safe (every suggestion still requires manual admin review before anything merges).
      if (results.length === 0) {
        setUsedLenientMergeThreshold(true);
        results = await runScan(FALLBACK_MERGE_THRESHOLD);
      }

      setMergeSuggestions(results);
      setScanFoundCount(results.length);
      setMergeScanComplete(true);
    } catch (err) {
      setError('Finding merge suggestions failed');
      console.error(err);
    } finally {
      setFindingMerges(false);
      setMergeScanProgress(null);
    }
  };

  const handleMergeSuggestion = async (suggestion: MergeSuggestion) => {
    const personA = personById(suggestion.clusterAId);
    const personB = personById(suggestion.clusterBId);
    if (!personA || !personB) {
      // One side was already merged/deleted elsewhere since the scan ran — just drop it.
      setMergeSuggestions((prev) => prev.filter((s) => suggestionKey(s) !== suggestionKey(suggestion)));
      return;
    }
    // Merge into whichever cluster already has more photos, so the surviving cover photo/name
    // (if named) is the more established one.
    const [target, source] = personA.face_count >= personB.face_count ? [personA, personB] : [personB, personA];
    const key = suggestionKey(suggestion);
    try {
      setMergingKey(key);
      await mergePeople(target.id, [source.id]);
      setMergeSuggestions((prev) => prev.filter((s) => suggestionKey(s) !== key));
      await loadData();
    } catch (err) {
      setError('Failed to merge');
      console.error(err);
    } finally {
      setMergingKey(null);
    }
  };

  const handleDismissSuggestion = (suggestion: MergeSuggestion) => {
    setMergeSuggestions((prev) => prev.filter((s) => suggestionKey(s) !== suggestionKey(suggestion)));
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
                  disabled
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg flex items-center gap-2 cursor-wait"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {clusterProgress ? `Grouping… ${clusterProgress.processed}/${clusterProgress.total}` : 'Loading…'}
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
              {findingMerges ? (
                <button
                  disabled
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg flex items-center gap-2 cursor-wait"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {mergeScanProgress ? `Scanning… ${mergeScanProgress.comparisons}/${mergeScanProgress.total}` : 'Loading…'}
                </button>
              ) : (
                <button
                  onClick={handleFindMergeSuggestions}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition flex items-center gap-2"
                >
                  <GitMerge className="w-4 h-4" /> Find Merge Suggestions
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
          as more of their photos get grouped). Detected faces are grouped into named people by
          "Cluster Now" — this runs entirely in your browser (not on the server), so it can group
          your whole library in one go, even with thousands of photos. "Find Merge Suggestions"
          sweeps the whole library for groups that are likely the same person but never got merged
          automatically, and lets you merge them with one click.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {mergeScanComplete && !findingMerges && scanFoundCount === 0 && (
          <div className="mb-8 bg-gray-100 dark:bg-gray-800 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400">
            No merge suggestions found, even after broadening the search. Either there aren't any
            duplicate groups left, or two truly-matching photos of the same person score too
            differently for this to catch automatically (common for very different angles/lighting).
          </div>
        )}

        {mergeSuggestions.length > 0 && (
          <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
              <GitMerge className="w-5 h-5" /> Merge suggestions ({mergeSuggestions.length})
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              These pairs look like the same person but were never automatically merged. Review each
              one and merge if they match, or dismiss if not.
              {usedLenientMergeThreshold && (
                <>
                  {' '}No matches were found at the default sensitivity, so this list uses a much
                  broader (lower-confidence) search instead — double-check each match carefully
                  before merging.
                </>
              )}
            </p>
            <div className="space-y-3">
              {mergeSuggestions.map((suggestion) => {
                const personA = personById(suggestion.clusterAId);
                const personB = personById(suggestion.clusterBId);
                if (!personA || !personB) return null;
                const key = suggestionKey(suggestion);
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 flex-wrap p-3 border border-gray-200 dark:border-gray-700 rounded-lg"
                  >
                    <div className="flex items-center gap-4">
                      {[personA, personB].map((person) => (
                        <div key={person.id} className="flex items-center gap-2">
                          <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 shrink-0">
                            {person.cover_event_slug && person.cover_photo_id && person.cover_file_type ? (
                              <img
                                src={getPreviewUrl(person.cover_event_slug, person.cover_photo_id, person.cover_file_type, person.cover_cache_version || undefined)}
                                alt={person.name || 'Unnamed person'}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <Users className="w-6 h-6 text-gray-400 m-auto mt-3" />
                            )}
                          </div>
                          <div className="text-sm">
                            <p className="font-medium text-gray-900 dark:text-white">{person.name || 'Unnamed'}</p>
                            <p className="text-xs text-gray-500">{person.face_count} photo{person.face_count === 1 ? '' : 's'}</p>
                          </div>
                        </div>
                      ))}
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {Math.round(suggestion.similarity * 100)}% match
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleMergeSuggestion(suggestion)}
                        disabled={mergingKey === key}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Check className="w-4 h-4" /> Merge
                      </button>
                      <button
                        onClick={() => handleDismissSuggestion(suggestion)}
                        disabled={mergingKey === key}
                        className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <X className="w-4 h-4" /> Not the same
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
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
