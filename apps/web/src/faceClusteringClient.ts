/**
 * Client-side face clustering + merge-suggestion matching — runs entirely in the admin's
 * browser, not the Worker.
 *
 * WHY: this used to run server-side (apps/worker/src/faceClustering.ts), guarded by
 * increasingly elaborate CPU-time budgets (adaptive batch sizes, candidate-cluster caps,
 * wall-clock guards, deterministic dimension-operation budgets, early-exit optimizations...).
 * Every one of those attempts still eventually 503'd with Cloudflare's `Error 1102: Worker
 * exceeded resource limits` once the library grew large enough — Cloudflare Workers Free plan
 * hard-caps CPU time at just 10ms per request, and there is no batch size small enough to both
 * make real progress AND never risk exceeding that for an O(n) or O(n²) operation whose cost
 * scales with however large the library has grown. A phone/laptop browser has no such limit,
 * and this is admin-only tooling (never runs for anonymous visitors), so the fix is
 * architectural: the Worker now only ever does cheap I/O (see apps/worker/src/faceClustering.ts
 * — GET /admin/people/cluster-data fetches raw embeddings, POST /admin/people/apply-clustering
 * persists already-computed results); ALL vector-similarity math happens here instead.
 *
 * The distance()/similarity() functions below are a direct port of vladmandic/human's
 * src/face/match.ts (MIT licensed) — duplicated from (the now-removed) worker-side
 * faceClustering.ts rather than shared, since apps/worker and apps/web are separate npm
 * packages with no shared-code build step in this repo.
 */

import type { ClusterDataFace, ClusterDataCluster, ClusterResult } from './api';

// Human's default similarity() options: order=2 (Euclidean), multiplier=25, normalize the
// resulting root-distance into a 0..1 "similarity" using a [min, max] = [0.2, 0.8] window
// before clamping. See vladmandic/human's wiki/Embedding: "Similarity match above 50% can be
// considered a match".
const MATCH_MULTIPLIER = 25;
const MATCH_MIN = 0.2;
const MATCH_MAX = 0.8;

/** Threshold used by automatic clustering (assigning a face to an existing person with zero
 *  human review). Lowered from Human's own documented "0.5 = match" guidance to 0.45
 *  (2026-08-03) specifically for this app's content: it is essentially entirely action/sports
 *  photography (speed skating, cycling — helmets, goggles/visors, motion blur, extreme angles),
 *  which measurably scores lower on Human's FaceRes descriptor even for genuinely-matching
 *  faces than the frontal/well-lit portraits the 0.5 guidance was calibrated against. Kept
 *  deliberately still meaningfully ABOVE DEFAULT_MERGE_SUGGESTION_THRESHOLD below (0.35) so the
 *  human-reviewed merge-suggestion safety net still catches genuinely-harder cases that even
 *  this loosened automatic bar misses — automatic clustering must stay more conservative than
 *  a review-gated feature, just less conservative than Human's generic default. */
export const SAME_PERSON_THRESHOLD = 0.45;

/** Threshold used by merge SUGGESTIONS only — deliberately lower than SAME_PERSON_THRESHOLD.
 *  Every merge suggestion is manually reviewed by an admin before anything actually merges (one
 *  click to dismiss a false positive), whereas a false NEGATIVE (a real duplicate that never
 *  even gets suggested) is a silent, permanent gap with no way to discover it — so a much more
 *  lenient bar is safe and appropriate here, unlike for automatic clustering. This app's
 *  action-sports photos (helmets/goggles/odd angles) commonly score well below
 *  SAME_PERSON_THRESHOLD even for genuinely-matching faces. */
export const DEFAULT_MERGE_SUGGESTION_THRESHOLD = 0.35;

/**
 * Minkowski distance between two descriptors (order=2 = Euclidean), ported from Human's
 * `distance()` — NOT square-rooted here (matches the upstream implementation, which takes the
 * root later inside `normalizeDistance`/`similarity`).
 *
 * IMPORTANT: returns `Number.POSITIVE_INFINITY` (never-a-match) if the two descriptors have
 * different lengths, rather than silently comparing only their first `Math.min(a.length,
 * b.length)` dimensions. This app switched face-embedding models mid-flight (face-api.js's
 * 128-dim descriptor -> @vladmandic/human's 1024-dim one, see faceDetection.ts's doc comment)
 * — any photo processed before the switch has a permanently-incompatible-shaped embedding
 * (different model, different training, each dimension means something different), so
 * comparing a 1024-dim descriptor against a 128-dim one by truncating both to the first 128
 * values does NOT produce a meaningful (if imprecise) similarity score — it produces a
 * comparison between two unrelated numeric spaces that can spuriously score as a "match" (or
 * not) essentially at random. Worse, if such a spurious match were ever accepted, the running-
 * average centroid update in runClientSideClustering() below indexes the embedding by
 * `newCentroid.length` (the EXISTING, correct-dimension cluster's length) — reading past the
 * end of a shorter legacy embedding produces `undefined`, and `undefined - number` is `NaN`,
 * permanently corrupting that cluster's centroid with `NaN` in every dimension beyond 128 (see
 * repo memory for the full incident writeup). Rejecting mismatched-length comparisons outright
 * (instead of a defensive silent truncation) prevents this class of corruption entirely — see
 * getLegacyFaceStats()/resetLegacyFaces() in apps/worker/src/faceClustering.ts for the
 * (separate, one-time) cleanup of data already corrupted before this fix existed.
 */
export function humanDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.round(100 * MATCH_MULTIPLIER * sum) / 100;
}

/**
 * Normalized 0..1 similarity between two face descriptors, ported from Human's
 * `similarity()`/`normalizeDistance()`. 0 = no similarity, 1 = perfect match; per Human's own
 * docs, >=0.5 is considered a match. Returns 0 for descriptors of different lengths — see
 * humanDistance()'s doc comment above.
 */
export function humanSimilarity(a: Float32Array, b: Float32Array): number {
  const dist = humanDistance(a, b);
  if (dist === 0) return 1; // short-circuit for identical inputs
  if (!Number.isFinite(dist)) return 0; // mismatched descriptor lengths — never a match
  const root = Math.sqrt(dist);
  const norm = (1 - root / 100 - MATCH_MIN) / (MATCH_MAX - MATCH_MIN);
  return Math.round(100 * Math.max(Math.min(norm, 1), 0)) / 100;
}

/** Yields to the event loop every `everyN` iterations of a long-running loop, so the browser
 *  tab stays responsive (repaints, doesn't get flagged as unresponsive) during a big scan —
 *  purely a UX nicety, not a CPU-safety requirement (unlike on Workers, browsers don't have a
 *  hard per-task CPU-time limit). */
async function yieldPeriodically(iteration: number, everyN: number): Promise<void> {
  if (iteration > 0 && iteration % everyN === 0) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Runs the SAME greedy nearest-centroid clustering algorithm the worker used to run, but here
 * entirely in memory over the FULL dataset (no batch-size/candidate-cluster caps needed — a
 * browser has no 10ms CPU-time limit) — assigns each unclustered face to the nearest existing
 * person (if above SAME_PERSON_THRESHOLD) or starts a new person cluster, updating each
 * cluster's running-average centroid as it goes so faces within this same pass can join a
 * cluster created earlier in the pass.
 *
 * Returns a list of ClusterResult entries (only for clusters that actually changed) ready to
 * POST to /admin/people/apply-clustering — the worker just persists them (pure I/O).
 */
export async function runClientSideClustering(
  faces: ClusterDataFace[],
  clusters: ClusterDataCluster[],
  onProgress?: (processed: number, total: number) => void
): Promise<ClusterResult[]> {
  // In-memory working copy — updated as we go, same as the old worker implementation.
  const working = clusters.map((c) => ({
    id: c.id,
    centroid: new Float32Array(c.centroidEmbedding),
    count: c.faceCount,
    addedFaceIds: [] as number[],
    changed: false,
  }));

  // New clusters created during this pass — each keyed by its first face's id (an arbitrary
  // but stable temp key, never sent to the server) since real ids don't exist until persisted.
  const newClusters: { centroid: Float32Array; count: number; addedFaceIds: number[]; coverPhotoId: string }[] = [];

  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    const embedding = new Float32Array(face.embedding);

    let bestSimilarity = -Infinity;
    let bestTarget: { centroid: Float32Array; count: number; addedFaceIds: number[]; changed?: boolean } | null = null;

    for (const cluster of working) {
      const similarity = humanSimilarity(embedding, cluster.centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestTarget = cluster;
      }
    }
    for (const cluster of newClusters) {
      const similarity = humanSimilarity(embedding, cluster.centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestTarget = cluster;
      }
    }

    if (bestTarget && bestSimilarity >= SAME_PERSON_THRESHOLD) {
      const newCount = bestTarget.count + 1;
      const newCentroid = new Float32Array(bestTarget.centroid.length);
      for (let d = 0; d < newCentroid.length; d++) {
        newCentroid[d] = bestTarget.centroid[d] + (embedding[d] - bestTarget.centroid[d]) / newCount;
      }
      bestTarget.centroid = newCentroid;
      bestTarget.count = newCount;
      bestTarget.addedFaceIds.push(face.id);
      bestTarget.changed = true;
    } else {
      newClusters.push({ centroid: embedding, count: 1, addedFaceIds: [face.id], coverPhotoId: face.photoId });
    }

    onProgress?.(i + 1, faces.length);
    await yieldPeriodically(i, 200);
  }

  const results: ClusterResult[] = [];
  for (const cluster of working) {
    if (!cluster.changed) continue;
    results.push({
      clusterId: cluster.id,
      centroidEmbedding: Array.from(cluster.centroid),
      faceCount: cluster.count,
      addedFaceIds: cluster.addedFaceIds,
    });
  }
  for (const cluster of newClusters) {
    results.push({
      clusterId: null,
      centroidEmbedding: Array.from(cluster.centroid),
      faceCount: cluster.count,
      addedFaceIds: cluster.addedFaceIds,
      coverPhotoId: cluster.coverPhotoId,
    });
  }

  return results;
}

export interface MergeSuggestion {
  clusterAId: number;
  clusterBId: number;
  similarity: number;
}

/**
 * Full O(clusterCount²) pairwise similarity scan across every person cluster, looking for
 * pairs that likely represent the same real person but were never merged by automatic
 * clustering (which only ever compares a NEW face against EXISTING clusters — two existing
 * clusters can be the same person without clustering ever having had the chance to notice).
 * Runs entirely client-side — no CPU-time budget/cursor/pagination needed, since a browser can
 * examine even hundreds of thousands of pairs in well under a second.
 */
export async function findClientSideMergeSuggestions(
  clusters: ClusterDataCluster[],
  minSimilarity: number = DEFAULT_MERGE_SUGGESTION_THRESHOLD,
  onProgress?: (comparisons: number, totalComparisons: number) => void
): Promise<MergeSuggestion[]> {
  const centroids = clusters.map((c) => new Float32Array(c.centroidEmbedding));
  const totalComparisons = (clusters.length * (clusters.length - 1)) / 2;
  const suggestions: MergeSuggestion[] = [];

  let comparisons = 0;
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const similarity = humanSimilarity(centroids[i], centroids[j]);
      if (similarity >= minSimilarity) {
        suggestions.push({ clusterAId: clusters[i].id, clusterBId: clusters[j].id, similarity });
      }
      comparisons++;
      onProgress?.(comparisons, totalComparisons);
      await yieldPeriodically(comparisons, 5000);
    }
  }

  return suggestions;
}
