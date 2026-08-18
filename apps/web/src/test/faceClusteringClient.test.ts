import { describe, expect, it } from 'vitest';
import {
  humanDistance,
  humanSimilarity,
  SAME_PERSON_THRESHOLD,
  DEFAULT_MERGE_SUGGESTION_THRESHOLD,
  runClientSideClustering,
  runDeepRebuildClustering,
  findClientSideMergeSuggestions,
  chunkClusteringResultsForApply,
  computeRecognitionDiagnostics,
} from '../faceClusteringClient';
import type { ClusterDataFace, ClusterDataCluster, ClusterResult } from '../api';

/**
 * Tests for the client-side face-clustering + merge-suggestion matching that replaced the
 * old server-side (Cloudflare Worker) implementation — see faceClusteringClient.ts's doc
 * comment for why this moved out of the Worker entirely (repeated CPU-time-limit crashes).
 *
 * runClientSideClustering()/findClientSideMergeSuggestions() now filter out any embedding that
 * isn't exactly 512 numbers long (the ArcFace ONNX embedding dimension, since 2026-08-04 — see
 * EXPECTED_EMBEDDING_LENGTH's doc comment in faceClusteringClient.ts).
 *
 * IMPORTANT (2026-08-04): the similarity metric is now COSINE similarity (not the old Euclidean-
 * distance-based Human formula), which is only meaningfully defined for NON-ZERO vectors and is
 * invariant to magnitude (only DIRECTION matters). Test fixtures below use `unitVec(angle)` —
 * a vector living in a 2D subspace ([cos(angle), sin(angle), 0, 0, ...]) of the full 512-dim
 * space — so that two such vectors have an EXACT, easily-verified cosine similarity of
 * `cos(angleA - angleB)`. `vecWithSimilarity(sim)` builds a vector whose similarity to
 * `unitVec(0)` is exactly `sim`, which is used throughout to hit specific threshold values
 * precisely instead of guessing at Euclidean diffs.
 */
const DIM = 512;

function unitVec(angle: number): number[] {
  const v = new Array(DIM).fill(0);
  v[0] = Math.cos(angle);
  v[1] = Math.sin(angle);
  return v;
}

/** A 512-dim vector whose cosine similarity to `unitVec(0)` is exactly `sim` (clamped to the
 *  valid [-1, 1] range). */
function vecWithSimilarity(sim: number): number[] {
  const clamped = Math.max(-1, Math.min(1, sim));
  return unitVec(Math.acos(clamped));
}

/** Pads a short, explicit list of raw coordinate values out to the full 512-length array
 *  (zeros for the remainder) — used only where a test needs to inspect/verify EXACT numeric
 *  centroid arithmetic (not just a pass/fail similarity threshold), so the actual coordinate
 *  values matter, not just the resulting direction/angle. */
function pad512(...values: number[]): number[] {
  const padded = new Array(DIM).fill(0);
  values.forEach((v, i) => { padded[i] = v; });
  return padded;
}

describe('humanDistance / humanSimilarity (cosine similarity on ArcFace embeddings)', () => {
  it('humanDistance is zero for identical vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(humanDistance(a, a)).toBe(0);
  });

  it('humanDistance is 1 - cosine similarity for two orthogonal vectors (cosine similarity 0)', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(humanDistance(a, b)).toBeCloseTo(1, 5);
  });

  it('humanSimilarity is 1 for identical (or same-direction) vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(humanSimilarity(a, a)).toBe(1);
    // Cosine similarity is magnitude-INVARIANT — a scaled copy still scores a perfect match.
    const scaled = new Float32Array([2, 4, 6]);
    expect(humanSimilarity(a, scaled)).toBe(1);
  });

  it('humanSimilarity is 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(humanSimilarity(a, b)).toBe(0);
  });

  it('humanSimilarity is -1 (NOT clamped to 0) for exactly opposite vectors — an accurate cosine result, unlike the old Euclidean-based formula\'s 0..1 clamping', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(humanSimilarity(a, b)).toBe(-1);
  });

  it('DEFAULT_MERGE_SUGGESTION_THRESHOLD and SAME_PERSON_THRESHOLD are both positive, sane cosine-similarity values (0..1)', () => {
    // As of 2026-08-04 the merge-suggestion threshold (0.45) is intentionally HIGHER than the
    // auto-clustering threshold (0.35) — a real production run showed the opposite (lenient)
    // arrangement produced 57,093 unreviewable suggestions down to a 24% match. This is safe
    // because merge-suggestions target a DIFFERENT gap than auto-clustering: two independently-
    // formed clusters can score above SAME_PERSON_THRESHOLD against each other yet never get
    // compared (auto-clustering only ever matches a NEW face against EXISTING clusters, never
    // cluster-to-cluster), so a stricter-but-still-lenient-enough bar here still catches real
    // fragmentation while keeping the review list a manageable size.
    expect(SAME_PERSON_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULT_MERGE_SUGGESTION_THRESHOLD).toBeGreaterThan(0);
  });

  it('humanDistance is Infinity for embeddings of different lengths (never a truncated/silent comparison)', () => {
    const legacy = new Float32Array(256); // e.g. a stale/incompatible embedding shape
    const current = new Float32Array(512); // current ArcFace embedding length
    expect(humanDistance(legacy, current)).toBe(Number.POSITIVE_INFINITY);
  });

  it('humanSimilarity is 0 (never a match) for embeddings of different lengths, even if the overlapping prefix is identical', () => {
    const legacy = new Float32Array(256).fill(1);
    const current = new Float32Array(512).fill(1); // first 256 values identical to `legacy`
    expect(humanSimilarity(legacy, current)).toBe(0);
  });
});

describe('runClientSideClustering', () => {
  it('groups two near-identical faces into the same brand-new person cluster', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'photo-a', embedding: unitVec(0) },
      { id: 2, photoId: 'photo-b', embedding: unitVec(0.001) }, // tiny angle -> similarity ~1
    ];

    const results = await runClientSideClustering(faces, []);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBeNull();
    expect(results[0].faceCount).toBe(2);
    expect(results[0].addedFaceIds).toEqual([1, 2]);
    expect(results[0].coverPhotoId).toBe('photo-a');
  });

  it('creates separate clusters for faces further apart than the same-person threshold', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'photo-a', embedding: unitVec(0) },
      { id: 2, photoId: 'photo-b', embedding: unitVec(Math.PI / 2) }, // orthogonal -> similarity 0
    ];

    const results = await runClientSideClustering(faces, []);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.clusterId === null)).toBe(true);
  });

  it('assigns a new face to an existing cluster passed in from the server', async () => {
    const existingClusters: ClusterDataCluster[] = [
      { id: 42, centroidEmbedding: unitVec(0), faceCount: 3 },
    ];
    const faces: ClusterDataFace[] = [{ id: 1, photoId: 'photo-a', embedding: unitVec(0.001) }];

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBe(42);
    expect(results[0].faceCount).toBe(4);
    expect(results[0].addedFaceIds).toEqual([1]);
  });

  it('lets a face join a brand-new cluster created earlier in the SAME pass', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'photo-a', embedding: unitVec(0) },
      { id: 2, photoId: 'photo-b', embedding: unitVec(0.001) },
      { id: 3, photoId: 'photo-c', embedding: unitVec(-0.001) },
    ];

    const results = await runClientSideClustering(faces, []);

    expect(results).toHaveLength(1);
    expect(results[0].faceCount).toBe(3);
    expect(results[0].addedFaceIds).toEqual([1, 2, 3]);
  });

  it('returns an empty array when there are no unclustered faces', async () => {
    const results = await runClientSideClustering([], []);
    expect(results).toEqual([]);
  });

  it('does not include unchanged existing clusters in the results (only clusters that actually changed)', async () => {
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: unitVec(0), faceCount: 1 }, // never matched, should be untouched
    ];
    const faces: ClusterDataFace[] = [{ id: 1, photoId: 'photo-a', embedding: unitVec(Math.PI) }]; // opposite direction

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBeNull(); // new cluster, existing one untouched
  });

  it('reports progress via the onProgress callback', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'photo-a', embedding: unitVec(0) },
      { id: 2, photoId: 'photo-b', embedding: unitVec(0.001) },
    ];
    const calls: Array<[number, number]> = [];

    await runClientSideClustering(faces, [], (processed, total) => calls.push([processed, total]));

    expect(calls).toEqual([[1, 2], [2, 2]]);
  });

  it('filters out (and never uses) faces or clusters with a malformed (non-512) embedding length', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'photo-a', embedding: [1, 1, 1] }, // malformed — only 3 numbers
      { id: 2, photoId: 'photo-b', embedding: unitVec(0) },
    ];
    const existingClusters: ClusterDataCluster[] = [
      { id: 5, centroidEmbedding: [1, 1], faceCount: 1 }, // malformed — only 2 numbers
    ];

    const results = await runClientSideClustering(faces, existingClusters);

    // The malformed face is silently skipped (never assigned/clustered); the malformed existing
    // cluster is ignored entirely (never matched against, never appears in results); only the
    // well-formed face produces a result.
    expect(results).toHaveLength(1);
    expect(results[0].addedFaceIds).toEqual([2]);
    expect(results.some((r) => r.clusterId === 5)).toBe(false);
  });

  it('caps centroid-drift dilution so a large cluster keeps moving toward NEW faces instead of freezing into a stale average (regression test for the 2354-face runaway-merge incident)', async () => {
    // Simulate an existing, already-large (but not yet FROZEN, see CENTROID_FREEZE_SIZE=40)
    // cluster centered at [10, 0, 0, ...] with 35 accumulated members — under the OLD unbounded
    // running-average formula (`centroid += diff / newCount`), a single new face would only
    // move the centroid by 1/36th of the difference. Under the capped formula, it should move
    // by a fixed ~1/30 weight instead. Candidate face at [10, 3, 0, ...] has cosine similarity
    // 100/(10*sqrt(109)) ≈ 0.958 to the cluster centroid — comfortably above SAME_PERSON_
    // THRESHOLD (0.35), so it matches.
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad512(10, 0, 0), faceCount: 35 },
    ];
    const faces: ClusterDataFace[] = [{ id: 999, photoId: 'photo-x', embedding: pad512(10, 3, 0) }];

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    // Capped weight = 1 / min(36, 30) = 1/30 -> centroid[1] moves from 0 to 3 * (1/30) = 0.1,
    // NOT the old formula's 3 * (1/36) ≈ 0.0833. Dim 0 (already matching, 10 vs 10) stays 10.
    expect(results[0].centroidEmbedding[0]).toBeCloseTo(10, 5);
    expect(results[0].centroidEmbedding[1]).toBeCloseTo(0.1, 5);
  });

  it('FREEZES the centroid entirely once a cluster reaches CENTROID_FREEZE_SIZE (40), preventing unbounded long-term drift even at the capped rate (fix for a cluster still absorbing multiple different people despite the drift cap alone)', async () => {
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad512(10, 0, 0), faceCount: 40 },
    ];
    const faces: ClusterDataFace[] = [{ id: 999, photoId: 'photo-x', embedding: pad512(10, 3, 0) }];

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    // Centroid must NOT move at all once frozen — dim 1 stays exactly 0, not 3 * (1/30) = 0.1.
    expect(results[0].centroidEmbedding[1]).toBeCloseTo(0, 5);
    expect(results[0].faceCount).toBe(41);
  });

  it('a small/new cluster still matches at the flat baseline threshold (no behavior change for the common case)', async () => {
    // similarity 0.45 is comfortably above the flat baseline SAME_PERSON_THRESHOLD (0.35), so a
    // small cluster (below THRESHOLD_GROWTH_START=12) should accept it.
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: unitVec(0), faceCount: 10 },
    ];
    const faces: ClusterDataFace[] = [{ id: 999, photoId: 'photo-x', embedding: vecWithSimilarity(0.45) }];

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBe(1);
  });

  it('a large, well-established cluster requires a MORE CONFIDENT match, rejecting the same borderline similarity a small cluster would accept (fix for the 2467-face runaway-merge incident, which a flat hard cap alone did not solve)', async () => {
    // Same 0.45 similarity as above, but this time against an already-large (150-member)
    // cluster — at that size the adaptive threshold has risen to its ceiling (baseline 0.35 +
    // MAX_THRESHOLD_BOOST 0.15 = 0.5), so 0.45 must now be REJECTED, starting a new cluster
    // instead of further diluting the large one.
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: unitVec(0), faceCount: 150 },
    ];
    const faces: ClusterDataFace[] = [{ id: 999, photoId: 'photo-x', embedding: vecWithSimilarity(0.45) }];

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBeNull(); // rejected from cluster 1, started a new one instead
  });

  it('lets a genuinely large, legitimate person (200+ photos) keep growing when the match is confidently ABOVE the raised bar — the whole point of replacing the old flat 60-face hard cap', async () => {
    // A clearly-matching (similarity 0.9) face should still join even a very large cluster,
    // since it comfortably clears the raised (but capped at 0.5) threshold — unlike the old
    // flat MAX_AUTO_CLUSTER_SIZE=60 cap, which would have rejected this unconditionally purely
    // based on size, incorrectly splitting a real recurring person into multiple groups.
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: unitVec(0), faceCount: 250 },
    ];
    const faces: ClusterDataFace[] = [{ id: 999, photoId: 'photo-x', embedding: vecWithSimilarity(0.9) }];

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBe(1);
    expect(results[0].faceCount).toBe(251);
  });
});

describe('findClientSideMergeSuggestions', () => {
  it('suggests a pair of clusters whose centroids are near-identical, but not a far-apart third cluster', async () => {
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: unitVec(0), faceCount: 1 },
      { id: 2, centroidEmbedding: unitVec(0.001), faceCount: 1 }, // near-identical direction
      { id: 3, centroidEmbedding: unitVec(Math.PI), faceCount: 1 }, // opposite direction
    ];

    const suggestions = await findClientSideMergeSuggestions(clusters);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ clusterAId: 1, clusterBId: 2 });
    expect(suggestions[0].similarity).toBeGreaterThanOrEqual(DEFAULT_MERGE_SUGGESTION_THRESHOLD);
  });

  it('only ever reports a pair once, in (lower id, higher id) order', async () => {
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: unitVec(0), faceCount: 1 },
      { id: 2, centroidEmbedding: unitVec(0.001), faceCount: 1 },
    ];

    const suggestions = await findClientSideMergeSuggestions(clusters);

    expect(suggestions).toHaveLength(1);
    expect(suggestions.filter((s) => s.clusterAId === 2 && s.clusterBId === 1)).toHaveLength(0);
  });

  it('returns an empty array for an empty or single-cluster library', async () => {
    expect(await findClientSideMergeSuggestions([])).toEqual([]);
    expect(await findClientSideMergeSuggestions([{ id: 1, centroidEmbedding: unitVec(0), faceCount: 1 }])).toEqual([]);
  });

  it('surfaces a pair scoring at/above the default merge-suggestion threshold but rejects one below it', async () => {
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: unitVec(0), faceCount: 1 },
      { id: 2, centroidEmbedding: vecWithSimilarity(0.5), faceCount: 1 },
    ];

    const atDefault = await findClientSideMergeSuggestions(clusters, DEFAULT_MERGE_SUGGESTION_THRESHOLD);
    expect(atDefault).toHaveLength(1);

    const clustersBelow: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: unitVec(0), faceCount: 1 },
      { id: 2, centroidEmbedding: vecWithSimilarity(0.3), faceCount: 1 },
    ];
    const belowDefault = await findClientSideMergeSuggestions(clustersBelow, DEFAULT_MERGE_SUGGESTION_THRESHOLD);
    expect(belowDefault).toHaveLength(0);
  });

  it('reports progress via the onProgress callback', async () => {
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: unitVec(0), faceCount: 1 },
      { id: 2, centroidEmbedding: unitVec(Math.PI / 2), faceCount: 1 },
      { id: 3, centroidEmbedding: unitVec(Math.PI), faceCount: 1 },
    ];
    const calls: Array<[number, number]> = [];

    await findClientSideMergeSuggestions(clusters, DEFAULT_MERGE_SUGGESTION_THRESHOLD, (comparisons, total) =>
      calls.push([comparisons, total])
    );

    // C(3,2) = 3 total comparisons.
    expect(calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('ignores (never compares against) any cluster with a malformed (non-512) centroid length', async () => {
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: unitVec(0), faceCount: 1 },
      { id: 2, centroidEmbedding: unitVec(0.001), faceCount: 1 },
      { id: 3, centroidEmbedding: [1, 1, 1], faceCount: 1 }, // malformed — only 3 numbers
    ];

    const suggestions = await findClientSideMergeSuggestions(clusters);

    expect(suggestions).toHaveLength(1);
    expect(suggestions.every((s) => s.clusterAId !== 3 && s.clusterBId !== 3)).toBe(true);
  });
});

/**
 * Tests for the client-side apply-clustering batching fix (2026-08-03) — see
 * chunkClusteringResultsForApply()'s doc comment for the full incident: sending an entire
 * clustering pass's results in a single POST /admin/people/apply-clustering call could exceed
 * the Workers Free plan's 50-subrequests-per-request limit once a pass created many new
 * clusters, aborting the request mid-way and leaving a partially-applied, fragmented result
 * (spurious small clusters that never got the chance to grow to their full size).
 */
describe('chunkClusteringResultsForApply', () => {
  function makeResult(addedFaceIds: number[]): ClusterResult {
    return { clusterId: null, centroidEmbedding: [0, 0, 0], faceCount: addedFaceIds.length, addedFaceIds };
  }

  it('returns a single batch containing everything when the whole pass is small', () => {
    const results = [makeResult([1]), makeResult([2, 3]), makeResult([4])];

    const batches = chunkClusteringResultsForApply(results);

    expect(batches).toEqual([results]);
  });

  it('splits a large pass (many new clusters) into multiple batches instead of one oversized call', () => {
    // Each result costs 2 estimated D1 ops (1 cluster row + 1 face-id chunk, since
    // addedFaceIds.length <= 90) — with MAX_D1_OPS_PER_APPLY_CALL=30, that's 15 results/batch.
    const results = Array.from({ length: 40 }, (_, i) => makeResult([i]));

    const batches = chunkClusteringResultsForApply(results);

    expect(batches.length).toBeGreaterThan(1);
    // Every result must appear exactly once across all batches, in original order.
    const flattened = batches.flat();
    expect(flattened).toEqual(results);
  });

  it('returns an empty array of batches for an empty results list', () => {
    expect(chunkClusteringResultsForApply([])).toEqual([]);
  });

  it('still isolates a single pathologically large result into its own batch rather than crashing/looping', () => {
    // 3200 faces / 90-per-chunk = 36 face-id chunks + 1 cluster-row op = 37 estimated ops,
    // which alone already exceeds MAX_D1_OPS_PER_APPLY_CALL (30).
    const hugeResult = makeResult(Array.from({ length: 3200 }, (_, i) => i));
    const results = [makeResult([1]), hugeResult, makeResult([2])];

    const batches = chunkClusteringResultsForApply(results);

    // The huge result must end up alone in its own batch (never merged with neighbors, since
    // it alone already exceeds the budget) — the two small results can still share a batch
    // with each other.
    const batchContainingHuge = batches.find((b) => b.includes(hugeResult));
    expect(batchContainingHuge).toEqual([hugeResult]);
  });
});

/**
 * Tests for the "Rebuild All (Deep)" representative-sample clustering algorithm (2026-08-04) —
 * see runDeepRebuildClustering()'s doc comment for why this is a fundamentally more robust
 * replacement for incremental nearest-CENTROID matching: decisions are always made against
 * real, unmodified member embeddings (a random sample, never averaged/blended), never a mutable
 * aggregate that can "melt" into a generic attractor as a cluster grows.
 */
describe('runDeepRebuildClustering', () => {
  it('groups several near-identical faces of the same identity into one cluster', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'p1', embedding: unitVec(0) },
      { id: 2, photoId: 'p2', embedding: unitVec(0.001) },
      { id: 3, photoId: 'p3', embedding: unitVec(0.002) },
      { id: 4, photoId: 'p4', embedding: unitVec(-0.001) },
    ];

    const results = await runDeepRebuildClustering(faces);

    expect(results).toHaveLength(1);
    expect(results[0].addedFaceIds.slice().sort()).toEqual([1, 2, 3, 4]);
    expect(results[0].faceCount).toBe(4);
  });

  it('keeps two different identities in separate clusters (the class of bug centroid-based matching was vulnerable to)', async () => {
    // Orthogonal vectors -> similarity 0, well below both the avg and max bars.
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'p1', embedding: unitVec(0) },
      { id: 2, photoId: 'p2', embedding: unitVec(Math.PI / 2) },
    ];

    const results = await runDeepRebuildClustering(faces);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.faceCount === 1)).toBe(true);
  });

  it('rejects a face whose similarity to a clusters real representative members is below the required bar, instead of silently accepting it', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'p1', embedding: unitVec(0) },
      { id: 2, photoId: 'p2', embedding: unitVec(0.001) },
      { id: 3, photoId: 'p3', embedding: unitVec(Math.PI / 2) }, // orthogonal to the cluster above
    ];

    const results = await runDeepRebuildClustering(faces);

    expect(results).toHaveLength(2);
    const sizes = results.map((r) => r.faceCount).slice().sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('filters out faces with a malformed embedding length before clustering, matching the existing safety guard', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'p1', embedding: unitVec(0) },
      { id: 2, photoId: 'p2', embedding: [1, 2, 3] }, // malformed — not 512 long
    ];

    const results = await runDeepRebuildClustering(faces);

    expect(results).toHaveLength(1);
    expect(results[0].addedFaceIds).toEqual([1]);
  });

  it('returns clusterId: null for every result (caller is expected to reset all clusters before running a deep rebuild)', async () => {
    const faces: ClusterDataFace[] = [{ id: 1, photoId: 'p1', embedding: unitVec(0) }];

    const results = await runDeepRebuildClustering(faces);

    expect(results[0].clusterId).toBeNull();
  });

  it('returns an empty array for an empty input', async () => {
    expect(await runDeepRebuildClustering([])).toEqual([]);
  });

  it('applies the SAME adaptive size-scaled threshold as incremental clustering, based on the CLUSTER\'S OWN real member count (regression test for a bug where this always scored against the flat baseline regardless of actual cluster size, confirmed in production as two clusters absorbing 60% of a 2915-face library)', async () => {
    // Build up a large (150-member), tightly-identical cluster first.
    const faces: ClusterDataFace[] = [];
    for (let i = 0; i < 150; i++) {
      faces.push({ id: i + 1, photoId: `p${i + 1}`, embedding: unitVec(0) });
    }
    // Then a borderline face (similarity 0.45): comfortably above the flat baseline (0.35) but
    // BELOW the fully-grown adaptive bar for a 150-member cluster (baseline + 0.15 boost = 0.5).
    faces.push({ id: 1000, photoId: 'p-borderline', embedding: vecWithSimilarity(0.45) });

    const results = await runDeepRebuildClustering(faces);

    expect(results).toHaveLength(2);
    const bigCluster = results.find((r) => r.faceCount === 150);
    const newCluster = results.find((r) => r.faceCount === 1);
    expect(bigCluster).toBeDefined();
    expect(newCluster).toBeDefined();
    expect(newCluster?.addedFaceIds).toEqual([1000]);
  });
});

describe('runClientSideClustering: member-less (reset) clusters are ignored', () => {
  it('does NOT match a new face to an existing cluster whose faceCount is 0 (a reset-but-kept person)', async () => {
    // A person that was reset keeps a stale centroid but faceCount 0. A new face identical to
    // that stale centroid must NOT be re-absorbed into it (that would silently undo the reset);
    // it should start a brand-new cluster instead.
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'p1', embedding: unitVec(0) },
    ];
    const clusters: ClusterDataCluster[] = [
      { id: 99, centroidEmbedding: unitVec(0), faceCount: 0 }, // reset person, stale centroid
    ];

    const results = await runClientSideClustering(faces, clusters);

    // The reset cluster (99) is never touched; a new cluster is created for the face.
    expect(results.find((r) => r.clusterId === 99)).toBeUndefined();
    const created = results.find((r) => r.clusterId === null);
    expect(created).toBeDefined();
    expect(created?.addedFaceIds).toEqual([1]);
  });
});

describe('computeRecognitionDiagnostics', () => {
  // Deterministic PRNG so pair sampling is reproducible in tests.
  function seededRand(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  it('reports insufficientData when there are fewer than two multi-face people', () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'a', embedding: unitVec(0), personId: 1 },
      { id: 2, photoId: 'b', embedding: unitVec(0), personId: 1 },
      { id: 3, photoId: 'c', embedding: unitVec(1), personId: null }, // unlabeled
    ];
    const d = computeRecognitionDiagnostics(faces, seededRand(1));
    expect(d.insufficientData).toBe(true);
    expect(d.labeledPeople).toBe(1);
  });

  it('separates well-clustered people: intra similarity high, inter low, sane suggested threshold', () => {
    // Two tight, well-separated people: person A near angle 0, person B near angle pi/2
    // (orthogonal → ~0 similarity between them, ~1 within each).
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'a1', embedding: unitVec(0.00), personId: 1 },
      { id: 2, photoId: 'a2', embedding: unitVec(0.02), personId: 1 },
      { id: 3, photoId: 'a3', embedding: unitVec(0.04), personId: 1 },
      { id: 4, photoId: 'b1', embedding: unitVec(Math.PI / 2), personId: 2 },
      { id: 5, photoId: 'b2', embedding: unitVec(Math.PI / 2 + 0.02), personId: 2 },
      { id: 6, photoId: 'b3', embedding: unitVec(Math.PI / 2 + 0.04), personId: 2 },
    ];
    const d = computeRecognitionDiagnostics(faces, seededRand(42));
    expect(d.insufficientData).toBe(false);
    expect(d.labeledPeople).toBe(2);
    expect(d.labeledFaces).toBe(6);
    // Same-person pairs are near-identical; different-person pairs are near-orthogonal.
    expect(d.intra.median).toBeGreaterThan(0.9);
    expect(d.inter.median).toBeLessThan(0.2);
    // A threshold between the two populations should be suggested, and it should split them well.
    expect(d.suggestedThreshold).toBeGreaterThan(d.inter.median);
    expect(d.suggestedThreshold).toBeLessThanOrEqual(d.intra.median);
    expect(d.truePositiveRate).toBeGreaterThan(0.9);
    expect(d.falsePositiveRate).toBeLessThan(0.1);
  });

  it('ignores malformed-length embeddings when computing diagnostics', () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'a1', embedding: [1, 0], personId: 1 }, // malformed (2 numbers)
      { id: 2, photoId: 'a2', embedding: [1, 0], personId: 1 }, // malformed
      { id: 3, photoId: 'b1', embedding: unitVec(0), personId: 2 },
      { id: 4, photoId: 'b2', embedding: unitVec(0.01), personId: 2 },
    ];
    // Only person 2 survives the length filter → fewer than two multi-face people.
    const d = computeRecognitionDiagnostics(faces, seededRand(7));
    expect(d.insufficientData).toBe(true);
    expect(d.labeledPeople).toBe(1);
  });
});
