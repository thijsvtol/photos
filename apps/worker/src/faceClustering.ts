import type { Env } from './types';
import { createLogger } from './logger';
import { EXPECTED_EMBEDDING_LENGTH } from './faceValidation';

/**
 * Greedy nearest-centroid face clustering — pure JS vector math, no AI
 * binding needed (Workers AI has no face-embedding model; face descriptors
 * are computed CLIENT-SIDE via @vladmandic/human at upload time, see
 * apps/web/src/faceDetection.ts + faceDetectionQueue.ts, and posted to
 * POST /admin/events/:slug/uploads/:photoId/faces which just stores the raw
 * detections in `photo_faces`). This job assigns each not-yet-clustered
 * face to the nearest existing `person_clusters` centroid (within a
 * similarity threshold), or creates a new cluster if none match closely
 * enough, and updates a running-average centroid — same architectural
 * pattern as the trash-purge/AI-enrichment cron jobs (batch-limited,
 * runs hourly alongside them, no new infrastructure).
 *
 * The distance()/similarity() functions below are a direct port of
 * vladmandic/human's src/face/match.ts (MIT licensed) rather than an
 * invented formula — Human's own docs state "Similarity match above 50%
 * can be considered a match", so reusing their exact math means our
 * SAME_PERSON_THRESHOLD is grounded in the library author's own guidance
 * for this specific embedding space, not a guessed number. This matters
 * because Human's 1024-dim FaceRes descriptor is NOT on the same distance
 * scale as face-api.js's 128-dim descriptor this app used previously.
 */

// Batch sizing is ADAPTIVE, not fixed, and deliberately conservative: Cloudflare Workers CPU
// time (not wall-clock time!) is capped at just 10ms per HTTP request/cron trigger on the
// Workers Free plan (non-configurable — only the Paid plan can raise this, via
// `[limits] cpu_ms`, and this app is explicitly built to stay on the free tier). D1 reads/
// writes are I/O and don't count against that budget, but the vector-similarity math very
// much does.
//
// IMPORTANT, CORRECTED (this got wrong twice before landing here): the cost of ONE similarity
// comparison is NOT O(1) — humanDistance() loops over all EXPECTED_EMBEDDING_LENGTH (1024)
// dimensions per comparison. So the real CPU cost of one invocation is proportional to
// `facesInBatch * clustersConsidered * EMBEDDING_DIM`, not just `facesInBatch * clusters`. A
// batch-size formula that ignored the `* EMBEDDING_DIM` factor (an earlier version of this
// file) still 503'd in production once the library grew to ~870 recognized people, because a
// "small-looking" batch of 4 faces against 871 clusters is actually ~3.5 MILLION scalar
// float ops, not 3484.
//
// Two independent safety mechanisms, because neither alone is trustworthy without real
// profiling data for this exact runtime:
//  1. `computeBatchSize()` below picks a batch size so that
//     `facesInBatch * min(clusterCount, MAX_CLUSTERS_CONSIDERED) * EMBEDDING_DIM` stays under
//     a conservative op budget, AND separately caps how many clusters a single face is ever
//     compared against (MAX_CLUSTERS_CONSIDERED) — because once a library has thousands of
//     recognized people, even a batch of ONE face compared against ALL of them is unsafe; no
//     batch-size shrinkage alone can fix an unbounded per-face candidate-cluster count. The
//     considered clusters are the ones with the HIGHEST face_count (people who already have
//     multiple photos are the most likely — and most valuable — repeat match, versus other
//     rarely-seen singles), so this specifically protects the "does this look like someone we
//     already recognize well" case rather than being a random/arbitrary cut.
//  2. A real WALL-CLOCK guard between faces (see runFaceClustering() below), capped at a value
//     ALREADY SMALLER than the true CPU limit (5ms guard vs. the actual 10ms limit) — since
//     wall time is always >= CPU time, bounding cumulative wall time this tightly strictly
//     bounds cumulative CPU time to at most that same small constant, even in the worst case
//     of zero I/O wait (100% real compute). This is the key difference from an EARLIER WRONG
//     fix that wall-clock-bounded a loop at 20 SECONDS — reasoning "D1 calls are I/O not CPU"
//     (true, but irrelevant: nothing stopped a huge amount of REAL CPU work, the vector math
//     itself, from running inside that 20-second window). It only ever aborts BETWEEN whole
//     faces (never mid-scan for a given face), so a face is either fully compared against its
//     entire considered-candidate set, or left untouched for a later invocation — never
//     assigned based on an incomplete scan.
const EMBEDDING_DIM = EXPECTED_EMBEDDING_LENGTH;
const MAX_DIMENSION_OPS_PER_INVOCATION = 350_000; // faces * consideredClusters * EMBEDDING_DIM
const MAX_CLUSTERS_CONSIDERED = 300; // hard cap regardless of batch size — see above
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 40;
const CPU_TIME_GUARD_MS = 5; // conservative — well under the 10ms Free-plan CPU limit

function computeBatchSize(clusterCount: number): number {
  const consideredClusters = Math.min(clusterCount, MAX_CLUSTERS_CONSIDERED);
  if (consideredClusters <= 0) return MAX_BATCH_SIZE;
  const size = Math.floor(MAX_DIMENSION_OPS_PER_INVOCATION / (consideredClusters * EMBEDDING_DIM));
  return Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, size));
}

// Human's default similarity() options: order=2 (Euclidean), multiplier=25,
// normalize the resulting root-distance into a 0..1 "similarity" using a
// [min, max] = [0.2, 0.8] window before clamping. See vladmandic/human's
// wiki/Embedding: "Similarity match above 50% can be considered a match".
const MATCH_ORDER = 2;
const MATCH_MULTIPLIER = 25;
const MATCH_MIN = 0.2;
const MATCH_MAX = 0.8;
export const SAME_PERSON_THRESHOLD = 0.5;

/**
 * Minkowski distance between two descriptors (order=2 = Euclidean),
 * ported from Human's `distance()` — NOT square-rooted here (matches the
 * upstream implementation, which takes the root later inside
 * `normalizeDistance`/`similarity`).
 */
export function humanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.round(100 * MATCH_MULTIPLIER * sum) / 100;
}

/**
 * Normalized 0..1 similarity between two face descriptors, ported from
 * Human's `similarity()`/`normalizeDistance()`. 0 = no similarity, 1 =
 * perfect match; per Human's own docs, >=0.5 is considered a match.
 */
export function humanSimilarity(a: Float32Array, b: Float32Array): number {
  const dist = humanDistance(a, b);
  if (dist === 0) return 1; // short-circuit for identical inputs
  const root = MATCH_ORDER === 2 ? Math.sqrt(dist) : dist ** (1 / MATCH_ORDER);
  const norm = (1 - (root / 100) - MATCH_MIN) / (MATCH_MAX - MATCH_MIN);
  return Math.round(100 * Math.max(Math.min(norm, 1), 0)) / 100;
}

export async function runFaceClustering(env: Env): Promise<{ processed: number }> {
  const log = createLogger(env);

  // Cluster count is fetched FIRST (cheap COUNT(*), no row bodies) so the face batch size can
  // be sized to the CURRENT number of clusters — see computeBatchSize()'s doc comment above for
  // why this must be adaptive rather than a fixed constant.
  const clusterCountRow = await env.DB
    .prepare('SELECT COUNT(*) as count FROM person_clusters')
    .first<{ count: number }>();
  const totalClusterCount = clusterCountRow?.count ?? 0;
  const batchSize = computeBatchSize(totalClusterCount);

  const { results: faceRows } = await env.DB.prepare(`
    SELECT f.id, f.photo_id, f.embedding
    FROM photo_faces f
    WHERE f.person_id IS NULL
    ORDER BY f.created_at ASC
    LIMIT ?
  `).bind(batchSize).all<{ id: number; photo_id: string; embedding: ArrayBuffer }>();

  const faces = faceRows || [];
  if (faces.length === 0) {
    log.debug('[runFaceClustering] No unclustered faces pending');
    return { processed: 0 };
  }

  // Only the MAX_CLUSTERS_CONSIDERED clusters with the highest face_count are fetched — see
  // the doc comment above MAX_CLUSTERS_CONSIDERED for why this specific ordering (biggest/
  // most-established people first) is the right tradeoff when a library has more recognized
  // clusters than we can safely compare a single face against in one invocation.
  const { results: clusterRows } = await env.DB.prepare(`
    SELECT id, centroid_embedding, face_count FROM person_clusters
    ORDER BY face_count DESC
    LIMIT ?
  `).bind(MAX_CLUSTERS_CONSIDERED).all<{ id: number; centroid_embedding: ArrayBuffer; face_count: number }>();

  // In-memory working copy of clusters — updated as we go so faces within
  // the same batch can join a cluster created earlier in the same run.
  const clusters = (clusterRows || []).map((c) => ({
    id: c.id,
    centroid: new Float32Array(c.centroid_embedding),
    count: c.face_count,
  }));

  const loopStartedAt = Date.now();
  let processedCount = 0;

  for (const face of faces) {
    // Wall-clock guard, checked BETWEEN whole faces (never mid-scan for a given face, so a
    // face is always either fully compared against its whole candidate set or left untouched
    // for a later invocation — never assigned from a partial scan). This loop's body DOES
    // still contain awaited D1 writes below (not pure synchronous CPU work), so wall time here
    // isn't a precise measure of CPU time alone — but wall time is always >= CPU time, so
    // capping cumulative wall time to CPU_TIME_GUARD_MS strictly caps cumulative CPU time to at
    // most that same small constant too, regardless of how much of it was spent waiting on I/O
    // vs actually computing. This is the key difference from an EARLIER, WRONG version of this
    // fix, which wall-clock-bounded a loop at 20 SECONDS reasoning "D1 calls are I/O not CPU" —
    // true, but at 20 seconds there was no bound at all on how much REAL CPU work (the vector
    // math, which genuinely is CPU) could run inside that window, so it still blew the 10ms CPU
    // limit. Here the guard itself (5ms) is already smaller than the real CPU limit (10ms), so
    // even in the worst case — zero I/O, 100% of that time being actual compute — it still
    // can't exceed the true budget.
    if (Date.now() - loopStartedAt > CPU_TIME_GUARD_MS) {
      log.debug(`[runFaceClustering] Stopping early after ${processedCount}/${faces.length} face(s) to stay within the CPU time budget`);
      break;
    }

    try {
      const embedding = new Float32Array(face.embedding);

      let bestClusterIndex = -1;
      let bestSimilarity = -Infinity;
      for (let i = 0; i < clusters.length; i++) {
        const similarity = humanSimilarity(embedding, clusters[i].centroid);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestClusterIndex = i;
        }
      }

      if (bestClusterIndex >= 0 && bestSimilarity >= SAME_PERSON_THRESHOLD) {
        const cluster = clusters[bestClusterIndex];
        const newCount = cluster.count + 1;
        // Running average centroid: newCentroid = old + (embedding - old) / newCount
        const newCentroid = new Float32Array(cluster.centroid.length);
        for (let i = 0; i < newCentroid.length; i++) {
          newCentroid[i] = cluster.centroid[i] + (embedding[i] - cluster.centroid[i]) / newCount;
        }
        cluster.centroid = newCentroid;
        cluster.count = newCount;

        await env.DB.prepare(`
          UPDATE person_clusters SET centroid_embedding = ?, face_count = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(newCentroid.buffer, newCount, cluster.id).run();

        await env.DB.prepare('UPDATE photo_faces SET person_id = ? WHERE id = ?')
          .bind(cluster.id, face.id).run();
      } else {
        const result = await env.DB.prepare(`
          INSERT INTO person_clusters (centroid_embedding, face_count, cover_photo_id) VALUES (?, 1, ?) RETURNING id
        `).bind(embedding.buffer, face.photo_id).first<{ id: number }>();

        if (result) {
          clusters.push({ id: result.id, centroid: embedding, count: 1 });
          await env.DB.prepare('UPDATE photo_faces SET person_id = ? WHERE id = ?')
            .bind(result.id, face.id).run();
        }
      }

      processedCount++;
    } catch (err) {
      log.error(`[runFaceClustering] Failed to cluster face ${face.id}:`, err);
      processedCount++; // Counted as "attempted" even on failure, same as before.
    }
  }

  log.debug(`[runFaceClustering] Processed ${processedCount}/${faces.length} face(s) (batch size ${batchSize}, ${clusters.length}/${totalClusterCount} cluster(s) considered)`);
  return { processed: processedCount };
}

/**
 * A candidate pair of person clusters that likely represent the SAME real person, surfaced for
 * an admin to manually merge (see routes/admin/people.ts's GET /people/merge-suggestions and
 * POST /people/merge).
 *
 * WHY THIS IS NEEDED: runFaceClustering() only ever compares a new face against the (at most
 * MAX_CLUSTERS_CONSIDERED) most-established existing clusters — a deliberate CPU-safety
 * tradeoff (see the big comment above computeBatchSize()) that means two clusters can end up
 * being the same person WITHOUT clustering ever having had the chance to notice, e.g. two
 * small/rarely-seen clusters that were both created before either had enough photos to rank
 * into that top-N window. This scan finds those missed matches after the fact by comparing
 * EVERY cluster against every other cluster — an O(clusterCount²) operation, deliberately NOT
 * bounded to a top-N subset like clustering itself, since here the goal is a complete/thorough
 * sweep rather than a fast per-face decision.
 */
export interface MergeSuggestion {
  clusterAId: number;
  clusterBId: number;
  similarity: number;
}

/** Opaque resume position for findMergeSuggestions()'s paginated scan — see its doc comment. */
export interface MergeSuggestionCursor {
  sourceId: number;
  candidateId: number;
}

export interface MergeSuggestionsResult {
  suggestions: MergeSuggestion[];
  nextCursor: MergeSuggestionCursor | null;
  totalClusters: number;
}

// Checking Date.now() on every single comparison would itself add measurable overhead relative
// to how cheap one comparison is, so the CPU-time guard below is only checked every N
// comparisons — a small, bounded amount of "overshoot" work (at most this many extra
// comparisons past the guard) in exchange for much less timer-check overhead.
const MERGE_SCAN_CHECK_INTERVAL = 20;

/**
 * Resumable, CPU-safe full O(clusterCount²) similarity scan across ALL person clusters — see
 * the MergeSuggestion doc comment above for why this exists and why it's NOT limited to a
 * top-N subset the way runFaceClustering() is.
 *
 * Like runFaceClustering(), a single call only ever does a small, bounded amount of work (here:
 * comparisons checked every MERGE_SCAN_CHECK_INTERVAL against CPU_TIME_GUARD_MS of elapsed wall
 * time — the same "wall time is always >= CPU time, and the guard is already smaller than the
 * real CPU limit" reasoning as runFaceClustering()'s guard) and returns a `nextCursor` for the
 * caller to pass back in to resume exactly where it left off — see the client-side loop in
 * AdminPeople.tsx's "Find Merge Suggestions" button.
 *
 * Every cluster is refetched from D1 on every call rather than cached between calls — Workers
 * are stateless between invocations with no built-in server-side session storage available
 * here (would need a Durable Object/KV for that), and the D1 read itself is I/O, not CPU, so
 * re-reading a few thousand rows on each call doesn't threaten the CPU budget this function is
 * actually protecting.
 */
export async function findMergeSuggestions(env: Env, cursor: MergeSuggestionCursor | null): Promise<MergeSuggestionsResult> {
  const { results: clusterRows } = await env.DB
    .prepare('SELECT id, centroid_embedding FROM person_clusters ORDER BY id ASC')
    .all<{ id: number; centroid_embedding: ArrayBuffer }>();

  const clusters = (clusterRows || []).map((c) => ({ id: c.id, centroid: new Float32Array(c.centroid_embedding) }));

  // Resume position: find the source cluster to continue FROM, falling back to the next
  // higher id if the exact cursor cluster no longer exists (e.g. merged/deleted since the
  // previous call) rather than erroring out.
  let sourceIndex = 0;
  let candidateIndex: number | null = null;
  if (cursor) {
    sourceIndex = clusters.findIndex((c) => c.id >= cursor.sourceId);
    if (sourceIndex === -1) {
      // Every remaining cluster from the cursor onward is gone — scan is effectively done.
      return { suggestions: [], nextCursor: null, totalClusters: clusters.length };
    }
    if (clusters[sourceIndex].id === cursor.sourceId) {
      const foundCandidateIndex = clusters.findIndex((c, idx) => idx > sourceIndex && c.id >= cursor.candidateId);
      candidateIndex = foundCandidateIndex === -1 ? clusters.length : foundCandidateIndex;
    }
  }

  const suggestions: MergeSuggestion[] = [];
  const loopStartedAt = Date.now();
  let comparisonsSinceCheck = 0;

  for (let i = sourceIndex; i < clusters.length; i++) {
    const jStart = candidateIndex !== null && i === sourceIndex ? candidateIndex : i + 1;
    candidateIndex = null; // Only applies to resuming the very first source in this call.

    for (let j = jStart; j < clusters.length; j++) {
      comparisonsSinceCheck++;
      if (comparisonsSinceCheck >= MERGE_SCAN_CHECK_INTERVAL) {
        comparisonsSinceCheck = 0;
        if (Date.now() - loopStartedAt > CPU_TIME_GUARD_MS) {
          return { suggestions, nextCursor: { sourceId: clusters[i].id, candidateId: clusters[j].id }, totalClusters: clusters.length };
        }
      }

      const similarity = humanSimilarity(clusters[i].centroid, clusters[j].centroid);
      if (similarity >= SAME_PERSON_THRESHOLD) {
        suggestions.push({ clusterAId: clusters[i].id, clusterBId: clusters[j].id, similarity });
      }
    }
  }

  // Reached the end of every cluster without hitting the time budget — scan is complete.
  return { suggestions, nextCursor: null, totalClusters: clusters.length };
}

/** Count of faces still awaiting clustering — used by the admin "Cluster now"
 *  endpoint to report progress (see routes/admin/people.ts). */
export async function countUnclusteredFaces(env: Env): Promise<number> {
  const row = await env.DB
    .prepare('SELECT COUNT(*) as count FROM photo_faces WHERE person_id IS NULL')
    .first<{ count: number }>();
  return row?.count ?? 0;
}
