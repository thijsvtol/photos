import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, ScanFace, Loader2, Sparkles, Eye, EyeOff, GitMerge, X, Check, GraduationCap, Search, ArrowUpDown, BarChart3, ChevronDown, Wrench, AlertTriangle } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getPeople, getFullClusterData, getAllFacesForDeepRebuild, applyClusteringResults, resetAllClusters, mergePeople, getLegacyFaceStats, resetLegacyFaces, learnFromManualTags, rescanFacelessTaggedPhotos } from '../api';
import type { Person, LegacyFaceStats } from '../api';
import MediaThumb from '../components/MediaThumb';
import PersonAvatar from '../components/PersonAvatar';
import { runBackfillScan } from '../faceBackfill';
import type { BackfillProgress } from '../faceBackfill';
import { runClientSideClustering, runDeepRebuildClustering, findClientSideMergeSuggestions, chunkClusteringResultsForApply, computeRecognitionDiagnostics, DEFAULT_MERGE_SUGGESTION_THRESHOLD } from '../faceClusteringClient';
import type { MergeSuggestion, RecognitionDiagnostics } from '../faceClusteringClient';

// A second, much more lenient similarity threshold tried automatically only if the default
// (DEFAULT_MERGE_SUGGESTION_THRESHOLD, 0.45 as of 2026-08-04) scan finds literally nothing —
// this app's action-sports photos (helmets/goggles/angles) can legitimately score well under
// even that default for genuinely-matching faces, so a library with real duplicates can still
// come back empty at the default. The admin manually reviews every suggestion before merging
// either way, so a much lower bar here just means more (dismissable) candidates, never an
// unreviewed auto-merge.
const FALLBACK_MERGE_THRESHOLD = 0.2;

// Rendering every suggestion at once froze the admin's browser tab on a real production run
// (57,093 unvirtualized cards, each with two images). The scan itself still examines every
// pair (cheap, pure math), but only the top N by confidence are ever mounted into the DOM —
// merging/dismissing an item removes it from mergeSuggestions, letting the next one in line
// become visible.
const MERGE_SUGGESTIONS_RENDER_LIMIT = 200;

/** A small colored badge conveying an action's IMPACT at a glance, so the admin knows what a
 *  Tools item will do before clicking it (rather than only discovering it from a hover tooltip). */
type Impact = 'safe' | 'read-only' | 'heavy' | 'destructive';
const IMPACT_STYLES: Record<Impact, string> = {
  safe: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  'read-only': 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  heavy: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  destructive: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
};
const ImpactChip: React.FC<{ impact: Impact }> = ({ impact }) => (
  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${IMPACT_STYLES[impact]}`}>
    {impact === 'safe' ? 'safe' : impact === 'read-only' ? 'read-only' : impact === 'heavy' ? 'slow' : 'destroys data'}
  </span>
);

/** One row inside the Tools dropdown: icon + label + one-line description + impact chip. */
const ToolItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  description: string;
  impact: Impact;
  disabled?: boolean;
  onClick: () => void;
}> = ({ icon, label, description, impact, disabled, onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full text-left px-3 py-2.5 flex items-start gap-3 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed ${
      impact === 'destructive'
        ? 'hover:bg-red-50 dark:hover:bg-red-950/40'
        : 'hover:bg-gray-100 dark:hover:bg-gray-700/60'
    }`}
  >
    <span className={`mt-0.5 shrink-0 ${impact === 'destructive' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
      {icon}
    </span>
    <span className="flex-1 min-w-0">
      <span className="flex items-center gap-2">
        <span className={`text-sm font-medium ${impact === 'destructive' ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
          {label}
        </span>
        <ImpactChip impact={impact} />
      </span>
      <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</span>
    </span>
  </button>
);

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
  const [deepRebuilding, setDeepRebuilding] = useState(false);
  const [deepRebuildProgress, setDeepRebuildProgress] = useState<{ processed: number; total: number } | null>(null);
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
  // Non-null once checked; nonzero counts mean some photos were processed under the OLD
  // face-api.js embedding model (pre-2026-08) and can never meaningfully match against
  // anything detected under the current model until re-scanned — see resetLegacyFaces()'s doc
  // comment in faceClustering.ts for why this silently causes "0 merge suggestions" even for
  // people who obviously do recur in the library.
  const [legacyStats, setLegacyStats] = useState<LegacyFaceStats | null>(null);
  const [fixingLegacy, setFixingLegacy] = useState(false);
  // "Learn from tags" — lets manual photo tagging (which bypasses clustering entirely) directly
  // teach the model, without a full rebuild. See learnFromManualTags()'s doc comment in
  // apps/worker/src/faceClustering.ts for exactly what it does/why it's conservative.
  const [learningFromTags, setLearningFromTags] = useState(false);
  const [learnResult, setLearnResult] = useState<{
    personsUpdated: number;
    facesAssigned: number;
    taggedPhotosWithNoFaceData: number;
    taggedPhotosNeverScannedImages: number;
    taggedPhotosNeverScannedVideos: number;
  } | null>(null);
  // "Re-scan tagged photos with no face data" — see rescanFacelessTaggedPhotos()'s doc comment
  // in api.ts. Resets faces_processed_at for manually-tagged photos that came up empty on a
  // previous scan, so the next "Scan Library for Faces" pass re-checks them with the now-fixed
  // (full-resolution-original, not a downscaled preview) backfill logic.
  const [rescanningFaceless, setRescanningFaceless] = useState(false);
  const [rescanResult, setRescanResult] = useState<{ photosReset: number } | null>(null);
  // "Recognition diagnostics" — a READ-ONLY tool that measures, on this library's own confirmed
  // clusters, how well cosine similarity separates same-person vs different-person faces, and
  // what threshold best splits them (see computeRecognitionDiagnostics() in
  // faceClusteringClient.ts). Never writes anything; used to validate/tune SAME_PERSON_THRESHOLD.
  const [diagnostics, setDiagnostics] = useState<RecognitionDiagnostics | null>(null);
  const [runningDiagnostics, setRunningDiagnostics] = useState(false);
  const [diagnosticsLoaded, setDiagnosticsLoaded] = useState<number | null>(null);
  // Name search + sort — the list has no pagination, so for a library with many named people
  // finding a specific one by scrolling/scanning wasn't practical.
  const [nameFilter, setNameFilter] = useState('');
  const [sortBy, setSortBy] = useState<'photos' | 'name'>('photos');
  // "Tools" dropdown holding the less-frequent / advanced / destructive maintenance actions, so
  // the header only surfaces the everyday ones (Scan, Cluster Now, Unattached).
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  const multiPhotoPeople = allPeople.filter((p) => p.photo_count >= 2);
  const singlesCount = allPeople.length - multiPhotoPeople.length;
  const visiblePeople = showSingles ? allPeople : multiPhotoPeople;
  const people = visiblePeople
    .filter((p) => !nameFilter.trim() || (p.name || 'Unnamed').toLowerCase().includes(nameFilter.trim().toLowerCase()))
    .sort((a, b) => (sortBy === 'name' ? (a.name || 'Unnamed').localeCompare(b.name || 'Unnamed') : b.photo_count - a.photo_count));

  useEffect(() => {
    loadData();
    getLegacyFaceStats()
      .then(setLegacyStats)
      .catch((err) => console.error('Failed to check for legacy face data', err));
  }, []);

  // Close the Tools dropdown on an outside click or Escape (same pattern as Navbar's menus).
  useEffect(() => {
    if (!toolsOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setToolsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [toolsOpen]);

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

  const handleFixLegacyFaces = async () => {
    setFixingLegacy(true);
    try {
      await resetLegacyFaces();
      setLegacyStats(await getLegacyFaceStats());
      await loadData();
    } catch (err) {
      setError('Failed to reset outdated face data');
      console.error(err);
    } finally {
      setFixingLegacy(false);
    }
  };

  const handleLearnFromTags = async () => {
    setLearningFromTags(true);
    setLearnResult(null);
    try {
      const result = await learnFromManualTags();
      setLearnResult(result);
      await loadData();
    } catch (err) {
      setError('Failed to learn from manual tags');
      console.error(err);
    } finally {
      setLearningFromTags(false);
    }
  };

  const handleRescanFacelessTaggedPhotos = async () => {
    setRescanningFaceless(true);
    setRescanResult(null);
    setLearnResult(null);
    try {
      const result = await rescanFacelessTaggedPhotos();
      setRescanResult(result);
      // The reset photos are now back in the "pending" queue — immediately run the same scan
      // loop "Scan Library for Faces" uses so the admin doesn't have to click a second button.
      if (result.photosReset > 0) {
        setScanning(true);
        setScanProgress(null);
        cancelRef.current = false;
        try {
          await runBackfillScan((progress) => {
            setScanProgress(progress);
            if (cancelRef.current) return false;
          });
          await loadData();
          setLegacyStats(await getLegacyFaceStats());
        } finally {
          setScanning(false);
        }
      }
    } catch (err) {
      setError('Failed to re-scan tagged photos with no face data');
      console.error(err);
    } finally {
      setRescanningFaceless(false);
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
      setLegacyStats(await getLegacyFaceStats());
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
   * fetches every unclustered face + every existing cluster's centroid via getFullClusterData()
   * (itself paginated across several small requests — see api.ts's doc comment on why even
   * FETCHING an unbounded number of rows in one Worker call is unsafe), computes assignments
   * in the browser (no CPU-time limit here, unlike the Worker), then POSTs the results to be
   * persisted. The persist step is likewise split into several smaller
   * /admin/people/apply-clustering calls (see chunkClusteringResultsForApply()'s doc comment)
   * — sending every result in a single POST call can exceed the Workers Free plan's 50-
   * subrequests-per-request limit once a pass creates many new clusters, aborting the request
   * mid-way and leaving a partially-applied, fragmented result (many spurious small clusters).
   */
  const handleClusterNow = async () => {
    setClustering(true);
    setClusterProgress(null);
    try {
      const { faces, clusters } = await getFullClusterData(true, (facesLoaded) => {
        setClusterProgress({ processed: 0, total: facesLoaded });
      });
      if (faces.length === 0) {
        await loadData();
        return;
      }

      const results = await runClientSideClustering(faces, clusters, (processed, total) => {
        setClusterProgress({ processed, total });
      });

      if (results.length > 0) {
        const batches = chunkClusteringResultsForApply(results);
        for (let i = 0; i < batches.length; i++) {
          await applyClusteringResults(batches[i]);
          setClusterProgress({ processed: faces.length, total: faces.length });
        }
      }
      await loadData();
      setLegacyStats(await getLegacyFaceStats());
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
   * "Rebuild All (Deep)" — a much stronger, from-scratch reclustering pass using
   * runDeepRebuildClustering()'s representative-sample algorithm (see its doc comment in
   * faceClusteringClient.ts) instead of the routine incremental nearest-centroid one. Unlike
   * "Cluster Now" (which only ever looks at NOT-YET-clustered faces and trusts existing
   * clusters' centroids), this discards every existing person/cluster entirely and recomputes
   * everyone from every face's real, unmodified embedding — the fix for centroid drift ever
   * letting different people blend into one group. Destructive (all current person groupings
   * are thrown away and rebuilt), so requires an explicit confirmation; NOTHING about the
   * underlying photos/face embeddings themselves is touched or lost, and this can be re-run
   * as many times as needed.
   */
  const handleDeepRebuild = async () => {
    if (
      !window.confirm(
        'This will discard ALL current people/groupings and rebuild everyone from scratch using a stronger matching algorithm. Named people will need to be renamed afterward. Photos/faces themselves are never affected. Continue?'
      )
    ) {
      return;
    }
    setDeepRebuilding(true);
    setDeepRebuildProgress(null);
    try {
      await resetAllClusters();
      const faces = await getAllFacesForDeepRebuild((facesLoaded) => {
        setDeepRebuildProgress({ processed: 0, total: facesLoaded });
      });

      const results = await runDeepRebuildClustering(faces, (processed, total) => {
        setDeepRebuildProgress({ processed, total });
      });

      if (results.length > 0) {
        const batches = chunkClusteringResultsForApply(results);
        for (let i = 0; i < batches.length; i++) {
          await applyClusteringResults(batches[i]);
          setDeepRebuildProgress({ processed: faces.length, total: faces.length });
        }
      }
      await loadData();
      setLegacyStats(await getLegacyFaceStats());
    } catch (err) {
      setError('Deep rebuild failed');
      console.error(err);
    } finally {
      setDeepRebuilding(false);
      setDeepRebuildProgress(null);
    }
  };

  /**
   * "Recognition diagnostics" — READ-ONLY. Fetches every face (with its current person
   * assignment) via the same paginated getAllFacesForDeepRebuild() the deep rebuild uses, then
   * computes intra- vs inter-person similarity distributions and a suggested threshold entirely
   * in the browser (see computeRecognitionDiagnostics()). Nothing is written; this only tells the
   * admin whether the current SAME_PERSON_THRESHOLD is well-tuned for THEIR photos.
   */
  const handleRunDiagnostics = async () => {
    setRunningDiagnostics(true);
    setDiagnostics(null);
    setDiagnosticsLoaded(null);
    try {
      const faces = await getAllFacesForDeepRebuild((facesLoaded) => {
        setDiagnosticsLoaded(facesLoaded);
      });
      setDiagnostics(computeRecognitionDiagnostics(faces));
    } catch (err) {
      setError('Recognition diagnostics failed');
      console.error(err);
    } finally {
      setRunningDiagnostics(false);
    }
  };

  /**
   * Runs the ENTIRE O(clusterCount²) merge-suggestion scan client-side in one shot — see
   * faceClusteringClient.ts's findClientSideMergeSuggestions(). The scan itself needs no
   * cursor/pagination (a browser can examine even hundreds of thousands of pairs in well under
   * a second), but FETCHING the cluster centroids first still is paginated (getFullClusterData()
   * — see api.ts's doc comment), since converting/serializing an unbounded number of rows is
   * itself real, library-size-scaling CPU work on the Worker side, independent of any
   * vector-similarity math.
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

      const { clusters } = await getFullClusterData(false, (_facesLoaded, clustersLoaded) => {
        setMergeScanProgress({ comparisons: 0, total: clustersLoaded });
      });

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
    const [target, source] = personA.photo_count >= personB.photo_count ? [personA, personB] : [personB, personA];
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

  // Whichever long-running task (if any) is currently active — surfaced in ONE progress strip
  // under the header instead of each button turning into its own spinner. `canStop` is only true
  // for the library scan, whose loop honors cancelRef (see handleCancelScan).
  const busy: { label: string; detail: string; canStop: boolean } | null = scanning
    ? {
        label: rescanningFaceless ? 'Re-scanning tagged photos' : 'Scanning library for faces',
        detail: scanProgress
          ? `${scanProgress.processed} scanned${scanProgress.remaining != null ? ` · ${scanProgress.remaining} left` : ''}`
          : 'starting…',
        canStop: true,
      }
    : rescanningFaceless
      ? { label: 'Re-scanning tagged photos', detail: 'preparing…', canStop: false }
      : clustering
        ? { label: 'Grouping faces into people', detail: clusterProgress ? `${clusterProgress.processed}/${clusterProgress.total}` : 'loading…', canStop: false }
        : deepRebuilding
          ? { label: 'Rebuilding all groups', detail: deepRebuildProgress ? `${deepRebuildProgress.processed}/${deepRebuildProgress.total}` : 'starting…', canStop: false }
          : findingMerges
            ? { label: 'Scanning for merge suggestions', detail: mergeScanProgress ? `${mergeScanProgress.comparisons}/${mergeScanProgress.total}` : 'loading…', canStop: false }
            : runningDiagnostics
              ? { label: 'Analyzing recognition accuracy', detail: diagnosticsLoaded != null ? `${diagnosticsLoaded} faces` : 'loading…', canStop: false }
              : learningFromTags
                ? { label: 'Learning from tags', detail: '', canStop: false }
                : null;
  const anyBusy = busy !== null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link to="/admin" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
          ← Back to Admin
        </Link>
        <div className="flex justify-between items-start flex-wrap gap-3 mb-2">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <Users className="w-8 h-8" /> People
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1 text-sm max-w-2xl">
              New uploads are detected and grouped automatically. Use <strong>Scan Library</strong> +{' '}
              <strong>Cluster Now</strong> to process older photos; open <strong>Tools</strong> for
              cleanup and advanced options.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleScanLibrary}
              disabled={anyBusy}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Detect faces in photos uploaded before this feature existed (runs in your browser; new uploads are processed automatically)"
            >
              <ScanFace className="w-4 h-4" /> Scan Library for Faces
            </button>
            <button
              onClick={handleClusterNow}
              disabled={anyBusy}
              title="Group newly-detected faces into named people (only looks at not-yet-clustered faces)"
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-4 h-4" /> Cluster Now
            </button>
            <Link
              to="/admin/people/unattached"
              title="Browse photos with nobody identified yet and bulk-assign them to a person"
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition flex items-center gap-2"
            >
              <Users className="w-4 h-4" /> Unattached Photos
            </Link>

            {/* Tools: the rarer / advanced / destructive actions, each with a description +
                impact chip so the effect is clear before clicking (was previously ~6 more bare
                buttons crammed into this same row with only hover tooltips). */}
            <div className="relative" ref={toolsRef}>
              <button
                onClick={() => setToolsOpen((v) => !v)}
                aria-expanded={toolsOpen}
                aria-haspopup="menu"
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition flex items-center gap-2"
              >
                <Wrench className="w-4 h-4" /> Tools
                <ChevronDown className={`w-4 h-4 transition-transform ${toolsOpen ? 'rotate-180' : ''}`} />
              </button>
              {toolsOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-30 p-2"
                >
                  <p className="px-3 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Review</p>
                  <ToolItem
                    icon={<GitMerge className="w-4 h-4" />}
                    label="Find Merge Suggestions"
                    description="Scan every pair of groups for likely same-person matches to merge."
                    impact="safe"
                    disabled={anyBusy}
                    onClick={() => { setToolsOpen(false); handleFindMergeSuggestions(); }}
                  />
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Improve matching</p>
                  <ToolItem
                    icon={<GraduationCap className="w-4 h-4" />}
                    label="Learn from Tags"
                    description="Use photos you've manually tagged to teach the model who's who."
                    impact="safe"
                    disabled={anyBusy}
                    onClick={() => { setToolsOpen(false); handleLearnFromTags(); }}
                  />
                  <ToolItem
                    icon={<ScanFace className="w-4 h-4" />}
                    label="Re-scan Tagged Photos"
                    description="Re-check tagged photos that were scanned but found no face."
                    impact="heavy"
                    disabled={anyBusy}
                    onClick={() => { setToolsOpen(false); handleRescanFacelessTaggedPhotos(); }}
                  />
                  <ToolItem
                    icon={<BarChart3 className="w-4 h-4" />}
                    label="Recognition diagnostics"
                    description="Measure how well matching separates people on your library. Changes nothing."
                    impact="read-only"
                    disabled={anyBusy}
                    onClick={() => { setToolsOpen(false); handleRunDiagnostics(); }}
                  />
                  <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
                  <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-red-500 dark:text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Danger zone
                  </p>
                  <ToolItem
                    icon={<Sparkles className="w-4 h-4" />}
                    label="Rebuild All (Deep)"
                    description="Discard ALL current groups and rebuild from scratch — named people lose their names. Asks to confirm first."
                    impact="destructive"
                    disabled={anyBusy}
                    onClick={() => { setToolsOpen(false); handleDeepRebuild(); }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* One progress strip for whichever long task is running, instead of each button
            turning into its own spinner (so progress stays visible even with Tools closed). */}
        {busy && (
          <div className="mb-4 flex items-center gap-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 px-4 py-2.5 rounded-lg text-sm">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span className="font-medium">{busy.label}</span>
            {busy.detail && <span className="text-blue-600 dark:text-blue-400">· {busy.detail}</span>}
            {busy.canStop && (
              <button
                onClick={handleCancelScan}
                className="ml-auto px-3 py-1 text-xs bg-white dark:bg-gray-800 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition"
              >
                Stop
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-8">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              placeholder="Search people by name…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => setSortBy((s) => (s === 'photos' ? 'name' : 'photos'))}
            className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition flex items-center gap-1.5"
          >
            <ArrowUpDown className="w-4 h-4" /> Sort: {sortBy === 'photos' ? 'Most photos' : 'Name (A-Z)'}
          </button>
          {singlesCount > 0 && (
            <button
              onClick={() => setShowSingles((v) => !v)}
              title="Groups with only one photo so far are hidden by default — they usually just haven't been matched to more photos of that person yet"
              className="px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition flex items-center gap-1.5"
            >
              {showSingles ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showSingles ? 'Hide' : 'Show'} {singlesCount} single-photo group{singlesCount === 1 ? '' : 's'}
            </button>
          )}
        </div>

        {rescanResult && (
          <div className="mb-4 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 px-4 py-3 rounded-lg text-sm">
            {rescanResult.photosReset > 0 ? (
              <>Queued {rescanResult.photosReset} tagged photo{rescanResult.photosReset === 1 ? '' : 's'} for re-scanning{scanning ? '…' : '.'} {!scanning && 'Check above for any newly-found faces.'}</>
            ) : (
              'No tagged photos needed a re-scan — every one already has either face data or has never been checked yet (use "Scan Library for Faces" for those).'
            )}
          </div>
        )}

        {learnResult && (
          <div className="mb-8 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 px-4 py-3 rounded-lg text-sm">
            {learnResult.facesAssigned > 0 && (
              <p>
                Learned from your tags: {learnResult.facesAssigned} face{learnResult.facesAssigned === 1 ? '' : 's'} assigned across {learnResult.personsUpdated} person{learnResult.personsUpdated === 1 ? '' : 's'}.
              </p>
            )}
            {learnResult.facesAssigned === 0 && learnResult.taggedPhotosWithNoFaceData === 0 && (
              <p>
                Nothing new to learn right now — either every tagged photo is already fully matched, or a photo has multiple tags/faces that are too ambiguous to learn from automatically.
              </p>
            )}
            {learnResult.taggedPhotosWithNoFaceData > 0 && (
              <p className={learnResult.facesAssigned > 0 ? 'mt-1' : ''}>
                {learnResult.taggedPhotosWithNoFaceData} tagged photo{learnResult.taggedPhotosWithNoFaceData === 1 ? ' has' : 's have'} no detected face at all, so there's nothing for the model to learn from them yet — the tag itself is still saved and correct, there's just no face data behind it.
                {learnResult.taggedPhotosNeverScannedVideos > 0 && (
                  <> {learnResult.taggedPhotosNeverScannedVideos} of those {learnResult.taggedPhotosNeverScannedVideos === 1 ? 'is a video' : 'are videos'}, which can never be face-scanned at all (video isn't currently supported).</>
                )}
                {learnResult.taggedPhotosNeverScannedImages > 0 && (
                  <> {learnResult.taggedPhotosNeverScannedImages} of those {learnResult.taggedPhotosNeverScannedImages === 1 ? 'is an image that has' : 'are images that have'} never been scanned — try "Re-scan Tagged Photos" above.</>
                )}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {legacyStats && (legacyStats.legacyFaces > 0 || legacyStats.legacyClusters > 0 || legacyStats.corruptedClusters > 0) && (
          <div className="mb-8 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 px-4 py-3 rounded-lg">
            <p className="font-medium mb-1">Outdated face data detected</p>
            <p className="text-sm mb-3">
              {legacyStats.legacyFaces} face{legacyStats.legacyFaces === 1 ? '' : 's'} and{' '}
              {legacyStats.legacyClusters} group{legacyStats.legacyClusters === 1 ? '' : 's'} were
              detected using an older face-recognition model and can no longer be matched against
              anything scanned since.
              {legacyStats.corruptedClusters > 0 && (
                <>
                  {' '}Additionally, {legacyStats.corruptedClusters} group
                  {legacyStats.corruptedClusters === 1 ? '' : 's'} got corrupted by an old bug that
                  let one of these outdated faces merge in incorrectly, permanently breaking that
                  group's ability to match future faces (this is why clustering can produce many
                  separate 2-photo groups for what's really the same person).
                </>
              )}{' '}
              This is very likely why "Find Merge Suggestions" (or clustering) finds nothing for
              people who obviously do appear more than once. Fixing this removes the outdated/
              corrupted data (any affected photo just goes back to unclustered — nothing is
              deleted except the group records themselves) and re-queues legacy photos for "Scan
              Library for Faces" to re-detect. Run "Cluster Now" again afterwards to re-group
              everything cleanly.
            </p>
            <button
              onClick={handleFixLegacyFaces}
              disabled={fixingLegacy}
              className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {fixingLegacy && <Loader2 className="w-4 h-4 animate-spin" />}
              Fix outdated face data
            </button>
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
              These pairs look like the same person but were never automatically merged. Sorted by
              confidence, highest first. Review each one and merge if they match, or dismiss if not.
              {usedLenientMergeThreshold && (
                <>
                  {' '}No matches were found at the default sensitivity, so this list uses a much
                  broader (lower-confidence) search instead — double-check each match carefully
                  before merging.
                </>
              )}
              {mergeSuggestions.length > MERGE_SUGGESTIONS_RENDER_LIMIT && (
                <>
                  {' '}Showing the top {MERGE_SUGGESTIONS_RENDER_LIMIT.toLocaleString()} of{' '}
                  {mergeSuggestions.length.toLocaleString()} — merge/dismiss some to reveal more (the
                  full list isn't rendered at once to avoid freezing the page).
                </>
              )}
            </p>
            <div className="space-y-3">
              {mergeSuggestions.slice(0, MERGE_SUGGESTIONS_RENDER_LIMIT).map((suggestion) => {
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
                              <MediaThumb
                                slug={person.cover_event_slug}
                                photoId={person.cover_photo_id}
                                fileType={person.cover_file_type}
                                cacheVersion={person.cover_cache_version}
                                alt={person.name || 'Unnamed person'}
                              />
                            ) : (
                              <Users className="w-6 h-6 text-gray-400 m-auto mt-3" />
                            )}
                          </div>
                          <div className="text-sm">
                            <p className="font-medium text-gray-900 dark:text-white">{person.name || 'Unnamed'}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{person.photo_count} photo{person.photo_count === 1 ? '' : 's'}</p>
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
              <PersonAvatar key={person.id} person={person} />
            ))}
          </div>
        )}

        {diagnostics && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" /> Recognition diagnostics
                  </h2>
                  <button
                    onClick={() => setDiagnostics(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {diagnostics.insufficientData ? (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Not enough labeled data yet — this needs at least two people who each have two
                    or more faces assigned to them (found {diagnostics.labeledPeople} such
                    {diagnostics.labeledPeople === 1 ? ' person' : ' people'},{' '}
                    {diagnostics.labeledFaces} labeled face{diagnostics.labeledFaces === 1 ? '' : 's'}).
                    Cluster and name a few more people, then run this again.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                      Measured on {diagnostics.labeledFaces} faces across {diagnostics.labeledPeople}{' '}
                      confirmed {diagnostics.labeledPeople === 1 ? 'person' : 'people'} (read-only —
                      nothing was changed). Same-person pairs should score HIGH; different-person
                      pairs should score LOW. The further apart these two rows are, the more reliably
                      faces can be matched.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm mb-4">
                        <thead>
                          <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                            <th className="py-1 pr-2 font-medium"> </th>
                            <th className="py-1 px-2 font-medium">median</th>
                            <th className="py-1 px-2 font-medium">p10</th>
                            <th className="py-1 px-2 font-medium">p90</th>
                            <th className="py-1 px-2 font-medium">n</th>
                          </tr>
                        </thead>
                        <tbody className="text-gray-900 dark:text-gray-100">
                          <tr className="border-b border-gray-100 dark:border-gray-700/50">
                            <td className="py-1 pr-2 font-medium text-green-600 dark:text-green-400">Same person</td>
                            <td className="py-1 px-2">{diagnostics.intra.median.toFixed(3)}</td>
                            <td className="py-1 px-2">{diagnostics.intra.p10.toFixed(3)}</td>
                            <td className="py-1 px-2">{diagnostics.intra.p90.toFixed(3)}</td>
                            <td className="py-1 px-2">{diagnostics.intra.count}</td>
                          </tr>
                          <tr>
                            <td className="py-1 pr-2 font-medium text-red-600 dark:text-red-400">Different people</td>
                            <td className="py-1 px-2">{diagnostics.inter.median.toFixed(3)}</td>
                            <td className="py-1 px-2">{diagnostics.inter.p10.toFixed(3)}</td>
                            <td className="py-1 px-2">{diagnostics.inter.p90.toFixed(3)}</td>
                            <td className="py-1 px-2">{diagnostics.inter.count}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/40 text-sm text-gray-800 dark:text-gray-200">
                      <p>
                        Suggested threshold:{' '}
                        <strong>{diagnostics.suggestedThreshold.toFixed(2)}</strong>{' '}
                        (separates the two groups best: catches{' '}
                        {Math.round(diagnostics.truePositiveRate * 100)}% of true matches while
                        wrongly matching {Math.round(diagnostics.falsePositiveRate * 100)}% of
                        different-person pairs).
                      </p>
                      <p className="mt-1">
                        Currently in use: <strong>{diagnostics.currentThreshold.toFixed(2)}</strong>.
                        {Math.abs(diagnostics.suggestedThreshold - diagnostics.currentThreshold) >= 0.05
                          ? ' These differ meaningfully — consider updating SAME_PERSON_THRESHOLD in faceClusteringClient.ts.'
                          : ' The current value looks well-tuned for this library.'}
                      </p>
                    </div>
                  </>
                )}

                <button
                  onClick={() => setDiagnostics(null)}
                  className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPeople;
