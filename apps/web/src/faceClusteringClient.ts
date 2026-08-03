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

// @vladmandic/human's FaceRes descriptor is always exactly 1024 numbers (see
// faceValidation.ts's EXPECTED_EMBEDDING_LENGTH, kept in sync manually with the worker since
// these are separate npm packages). Any face/cluster arriving from the Worker with a DIFFERENT
// length is definitely NOT a valid embedding — see apps/worker/src/faceClustering.ts's
// blobToFloat32Array()/top-of-file doc comment for the exact production incident (a BLOB-
// reading bug once silently fed every clustering pass 4x-too-long "embeddings" that were
// actually just raw bytes reinterpreted as garbage floats) this guards against. Filtering these
// out here — the EARLIEST possible point, before any clustering math runs at all — means a
// future recurrence of that class of bug produces an obvious, loud console warning and simply
// skips the bad rows (leaving them unclustered for a later retry) instead of silently building
// meaningless clusters from noise.
const EXPECTED_EMBEDDING_LENGTH = 1024;

function isValidEmbeddingLength(embedding: number[]): boolean {
  return embedding.length === EXPECTED_EMBEDDING_LENGTH;
}

/** Threshold used by automatic clustering (assigning a face to an existing person with zero
 *  human review). REVERTED (2026-08-03) from 0.45 back to Human's own documented "0.5 = match"
 *  guidance, after production evidence showed 0.45 causes catastrophic over-merging: with a
 *  2915-face library, one single cluster grew to 2354 faces (81% of the ENTIRE library) and a
 *  second grew to 411 (94% combined, in just 2 of 22 clusters) — clearly not one real person's
 *  photos. Root cause is "centroid drift"/chaining, a known failure mode of incremental
 *  nearest-CENTROID clustering (see runClientSideClustering()'s doc comment below): once a
 *  cluster starts growing, its running-average centroid gradually blurs toward a generic
 *  "average face" that then satisfies a lenient threshold against even MORE unrelated people,
 *  which dilutes the centroid further, accepting still more people — a runaway snowball that
 *  gets exponentially worse the more lenient the threshold is. 0.45 was evidently past the
 *  tipping point for this to cascade; 0.5 (Human's own calibrated default) plus the centroid-
 *  drift cap added below should prevent it recurring. If real matches are still missed at 0.5,
 *  the "Find Merge Suggestions" human-reviewed tool (using the separate, more lenient
 *  DEFAULT_MERGE_SUGGESTION_THRESHOLD below) remains the safe way to catch them, since every
 *  suggestion there requires manual admin approval before merging — unlike automatic
 *  clustering, which must stay conservative precisely because nothing reviews its decisions. */
export const SAME_PERSON_THRESHOLD = 0.5;

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
 * IMPORTANT — centroid-drift/"chaining" safeguard (added 2026-08-03 after a production incident
 * where a single cluster grew to 2354 faces, 81% of an entire 2915-face library): naively
 * updating the centroid via a full running average (`centroid += (embedding - centroid) /
 * newCount`) forever means each individual new face's influence on the centroid shrinks as
 * `1/newCount` — once a cluster has accumulated dozens/hundreds of faces, ANY single new face
 * (even a wrong match) barely moves the centroid at all, so the centroid essentially freezes
 * into a generic "average face". A generic average of many different real faces is often, by
 * regression to the mean, similar-ish to MANY different people — so once a cluster gets large
 * enough for this to happen, it becomes progressively MORE likely (not less) to keep matching
 * unrelated new faces, snowballing exponentially. FIX: the learning-rate denominator is capped
 * at `CENTROID_UPDATE_CAP` (30) — once a cluster has that many members, every ADDITIONAL face
 * still nudges the centroid by a fixed ~1/30 weight instead of an ever-shrinking one, keeping
 * the centroid representative of its most RECENT ~30 members rather than melting into a
 * frozen, over-generic average of its entire (potentially huge) history.
 *
 * Returns a list of ClusterResult entries (only for clusters that actually changed) ready to
 * POST to /admin/people/apply-clustering — the worker just persists them (pure I/O).
 */
const CENTROID_UPDATE_CAP = 30;

// FIFTH FIX in this saga (2026-08-04): even with CENTROID_UPDATE_CAP, the centroid was still
// drifting FOREVER — every single new member past 30 still nudges it by a fixed ~1/30 weight,
// with no limit on how many times that can happen. Over hundreds of accepted matches that's
// still unbounded CUMULATIVE drift (each nudge is small, but they don't cancel out — a long
// run of nudges in a consistent direction, e.g. gradually accepting slightly-different-looking
// people, walks the centroid arbitrarily far from where it started), which is exactly the same
// underlying snowball risk as the original uncapped 1/n bug, just slowed down rather than
// eliminated. FIX: once a cluster has accumulated CENTROID_FREEZE_SIZE members, its centroid is
// FROZEN — no further updates, ever, regardless of how many more faces subsequently match it.
// This anchors the cluster's identity permanently to its first ~40 members (comfortably enough
// samples to characterize a real recurring person, per this app's own real-world photo counts)
// and guarantees the centroid can never wander further via slow drift, no matter how large the
// cluster eventually grows — combined with effectiveThresholdForClusterSize()'s rising bar
// below, a large established cluster now has BOTH a fixed, unmovable reference point AND an
// increasingly strict match requirement, closing off the two mechanisms (drift + eroding bar)
// that previously let clusters snowball.
const CENTROID_FREEZE_SIZE = 40;

// ADAPTIVE (size-scaled) matching threshold, replacing an earlier HARD cluster-size cap
// (2026-08-03) that turned out to be the wrong tool: a flat cap of 60 faces/cluster stopped the
// runaway-merge snowball, but also incorrectly split real people who legitimately appear in
// 200+ photos (this app's own photographer + regular friends) into multiple separate groups —
// exactly the opposite of what clustering should do for a genuinely-recurring person. Simply
// raising the cap would just delay the same snowball to a larger size instead of fixing it.
//
// The actual problem was never "clusters shouldn't get large" — it's that a FIXED similarity
// bar (SAME_PERSON_THRESHOLD) becomes progressively less reliable evidence as a cluster's
// centroid represents more and more distinct photos: a borderline ~0.50-0.55 similarity against
// a small, tight 2-3-photo cluster is fairly good evidence of a real match, but the SAME
// borderline score against an already-500-photo cluster's centroid is much weaker evidence
// (given this app's content — action-sports with helmets/goggles/motion blur — genuinely
// different people's faces can drift into that same borderline range against a large,
// somewhat-generalized centroid). Fix: the bar a face must clear to join a cluster RISES
// gradually with that cluster's current size, so:
//  - Small/new clusters keep the original, already-tuned SAME_PERSON_THRESHOLD (0.5) — no
//    behavior change for the common case of a person who has only accumulated a few photos.
//  - Large, well-established clusters require an increasingly CONFIDENT match to keep growing,
//    which lets a real recurring person's clearly-matching photos keep joining (their genuine
//    similarity scores are typically well above the baseline threshold, not borderline) while
//    filtering out the marginal, easily-wrong matches that caused the earlier snowball.
// Growth is capped at MAX_THRESHOLD_BOOST so the bar never becomes unreasonably strict even for
// a very large, legitimate cluster (200+ photos) — a genuinely well-matching face should still
// pass a 0.60 bar even at that scale.
// Growth rate/start tightened (2026-08-04) after the adaptive threshold ALONE still proved
// insufficient in production (a cluster still grew to absorb multiple different people even
// with this in place) — the bar now starts rising sooner and climbs faster, reaching its
// ceiling by a more modest cluster size instead of only meaningfully biting well past 100
// members.
const THRESHOLD_GROWTH_START = 12; // clusters below this size use the flat baseline threshold
const THRESHOLD_GROWTH_RATE = 0.003; // additional threshold required per member above the start
const MAX_THRESHOLD_BOOST = 0.15; // hard ceiling on how much the bar can rise (0.5 -> 0.65 max)

function effectiveThresholdForClusterSize(count: number): number {
  const boost = Math.min(MAX_THRESHOLD_BOOST, THRESHOLD_GROWTH_RATE * Math.max(0, count - THRESHOLD_GROWTH_START));
  return SAME_PERSON_THRESHOLD + boost;
}

// Absolute, should-never-be-reached safety net (NOT the primary defense anymore — see
// effectiveThresholdForClusterSize() above) against a truly pathological runaway in case some
// future bug reintroduces one — comfortably above any real person's legitimate photo count in
// this app's library, but still finite so a single cluster can never grow completely unbounded
// regardless of any other logic's correctness.
const MAX_AUTO_CLUSTER_SIZE = 2000;

export async function runClientSideClustering(
  faces: ClusterDataFace[],
  clusters: ClusterDataCluster[],
  onProgress?: (processed: number, total: number) => void
): Promise<ClusterResult[]> {
  // Filter out anything with a malformed embedding length BEFORE any clustering math runs —
  // see EXPECTED_EMBEDDING_LENGTH's doc comment above for why this must never be trusted
  // blindly. Bad faces are simply skipped (left unclustered for a later retry, e.g. after a
  // "Fix outdated face data" repair); bad existing clusters are dropped from the working set
  // entirely (never matched against, never further corrupted).
  const validFaces = faces.filter((f) => isValidEmbeddingLength(f.embedding));
  if (validFaces.length !== faces.length) {
    console.error(`runClientSideClustering: skipping ${faces.length - validFaces.length} face(s) with a malformed embedding length`);
  }
  const validClusters = clusters.filter((c) => isValidEmbeddingLength(c.centroidEmbedding));
  if (validClusters.length !== clusters.length) {
    console.error(`runClientSideClustering: ignoring ${clusters.length - validClusters.length} existing cluster(s) with a malformed centroid length`);
  }

  // In-memory working copy — updated as we go, same as the old worker implementation.
  const working = validClusters.map((c) => ({
    id: c.id,
    centroid: new Float32Array(c.centroidEmbedding),
    count: c.faceCount,
    addedFaceIds: [] as number[],
    changed: false,
  }));

  // New clusters created during this pass — each keyed by its first face's id (an arbitrary
  // but stable temp key, never sent to the server) since real ids don't exist until persisted.
  const newClusters: { centroid: Float32Array; count: number; addedFaceIds: number[]; coverPhotoId: string }[] = [];

  for (let i = 0; i < validFaces.length; i++) {
    const face = validFaces[i];
    const embedding = new Float32Array(face.embedding);

    let bestSimilarity = -Infinity;
    let bestTarget: { centroid: Float32Array; count: number; addedFaceIds: number[]; changed?: boolean } | null = null;

    for (const cluster of working) {
      if (cluster.count >= MAX_AUTO_CLUSTER_SIZE) continue;
      const similarity = humanSimilarity(embedding, cluster.centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestTarget = cluster;
      }
    }
    for (const cluster of newClusters) {
      if (cluster.count >= MAX_AUTO_CLUSTER_SIZE) continue;
      const similarity = humanSimilarity(embedding, cluster.centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestTarget = cluster;
      }
    }

    if (bestTarget && bestSimilarity >= effectiveThresholdForClusterSize(bestTarget.count)) {
      const newCount = bestTarget.count + 1;
      // Once a cluster has reached CENTROID_FREEZE_SIZE, stop updating its centroid entirely —
      // see CENTROID_FREEZE_SIZE's doc comment above for why an ever-continuing (even if
      // capped-rate) update is still an unbounded long-term drift risk.
      if (bestTarget.count < CENTROID_FREEZE_SIZE) {
        const updateWeight = 1 / Math.min(newCount, CENTROID_UPDATE_CAP);
        const newCentroid = new Float32Array(bestTarget.centroid.length);
        for (let d = 0; d < newCentroid.length; d++) {
          newCentroid[d] = bestTarget.centroid[d] + (embedding[d] - bestTarget.centroid[d]) * updateWeight;
        }
        bestTarget.centroid = newCentroid;
      }
      bestTarget.count = newCount;
      bestTarget.addedFaceIds.push(face.id);
      bestTarget.changed = true;
    } else {
      newClusters.push({ centroid: embedding, count: 1, addedFaceIds: [face.id], coverPhotoId: face.photoId });
    }

    onProgress?.(i + 1, validFaces.length);
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

// The Cloudflare Workers FREE plan caps SUBREQUESTS (which includes every D1 query) at 50 per
// HTTP request invocation — a SEPARATE, independent limit from the earlier CPU-time saga (see
// repo memory), but with the exact same failure shape: POST /admin/people/apply-clustering
// (apps/worker/src/faceClustering.ts's applyClusteringResults()) does roughly 1 D1 call per
// new/updated cluster PLUS 1 more per 90-face chunk of that cluster's addedFaceIds — sending
// every ClusterResult from a large "Cluster Now" pass in ONE POST call can very easily exceed
// 50 D1 calls (e.g. ~30+ new clusters found in one pass already blows the budget). Once the
// limit is hit mid-loop, the whole request aborts with a 500 — but every D1 write already
// AWAITED before the abort has already committed, so the batch is left PARTIALLY applied:
// several small (often 1-2 face) clusters get created and then the request dies before any
// more of them can be genuinely grown into larger, correctly-merged groups — this is exactly
// the "clustering 500s, but I get a bunch of spurious 2-photo duplicate groups" symptom this
// fix addresses. FACE_ID_CHUNK_SIZE below must match apps/worker/src/faceClustering.ts's own
// constant of the same name (kept in sync manually — see that file's comment).
const FACE_ID_CHUNK_SIZE = 90;
// Deliberately well under the real 50/request cap: leaves headroom for
// applyClusteringResults()'s trailing countUnclusteredFaces() call, plus a safety margin for
// any single result whose own addedFaceIds needs more than one 90-item chunk.
const MAX_D1_OPS_PER_APPLY_CALL = 30;

function estimatedD1OpsForResult(result: ClusterResult): number {
  // 1 D1 call to INSERT/UPDATE the cluster row itself, plus 1 more per face-id chunk (a
  // result with 0 addedFaceIds still needs its 1 cluster-row call).
  return 1 + Math.max(1, Math.ceil(result.addedFaceIds.length / FACE_ID_CHUNK_SIZE));
}

/**
 * Splits a full clustering pass's results into multiple smaller batches, each conservatively
 * sized to stay well under the Workers Free plan's 50-subrequests-per-request limit (see the
 * doc comment above) — the caller should POST each batch as a SEPARATE
 * /admin/people/apply-clustering call rather than sending the whole `results` array in one
 * request. A single oversized result (one cluster gaining an extremely large number of faces
 * in one pass) is still sent as its own batch even if that exceeds the budget alone — splitting
 * a single result's addedFaceIds across multiple apply calls would require the worker to hand
 * back newly-created cluster ids mid-sequence, which the current API doesn't support; this is
 * an accepted, extremely unlikely-in-practice edge case (would need one person to appear in
 * thousands of previously-unclustered photos within a single "Cluster Now" run).
 */
export function chunkClusteringResultsForApply(results: ClusterResult[]): ClusterResult[][] {
  const batches: ClusterResult[][] = [];
  let current: ClusterResult[] = [];
  let currentOps = 0;

  for (const result of results) {
    const ops = estimatedD1OpsForResult(result);
    if (current.length > 0 && currentOps + ops > MAX_D1_OPS_PER_APPLY_CALL) {
      batches.push(current);
      current = [];
      currentOps = 0;
    }
    current.push(result);
    currentOps += ops;
  }
  if (current.length > 0) batches.push(current);

  return batches;
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
  // Same malformed-embedding-length guard as runClientSideClustering() above — see
  // EXPECTED_EMBEDDING_LENGTH's doc comment.
  const validClusters = clusters.filter((c) => isValidEmbeddingLength(c.centroidEmbedding));
  if (validClusters.length !== clusters.length) {
    console.error(`findClientSideMergeSuggestions: ignoring ${clusters.length - validClusters.length} cluster(s) with a malformed centroid length`);
  }

  const centroids = validClusters.map((c) => new Float32Array(c.centroidEmbedding));
  const totalComparisons = (validClusters.length * (validClusters.length - 1)) / 2;
  const suggestions: MergeSuggestion[] = [];

  let comparisons = 0;
  for (let i = 0; i < validClusters.length; i++) {
    for (let j = i + 1; j < validClusters.length; j++) {
      const similarity = humanSimilarity(centroids[i], centroids[j]);
      if (similarity >= minSimilarity) {
        suggestions.push({ clusterAId: validClusters[i].id, clusterBId: validClusters[j].id, similarity });
      }
      comparisons++;
      onProgress?.(comparisons, totalComparisons);
      await yieldPeriodically(comparisons, 5000);
    }
  }

  return suggestions;
}
