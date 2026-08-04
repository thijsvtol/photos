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
} from '../faceClusteringClient';
import type { ClusterDataFace, ClusterDataCluster, ClusterResult } from '../api';

/**
 * Tests for the client-side face-clustering + merge-suggestion matching that replaced the
 * old server-side (Cloudflare Worker) implementation — see faceClusteringClient.ts's doc
 * comment for why this moved out of the Worker entirely (repeated CPU-time-limit crashes).
 *
 * runClientSideClustering()/findClientSideMergeSuggestions() now filter out any embedding that
 * isn't exactly 1024 numbers long (see EXPECTED_EMBEDDING_LENGTH's doc comment in
 * faceClusteringClient.ts — a defense against the confirmed production incident where a BLOB-
 * reading bug once fed 4x-too-long garbage "embeddings" through the whole pipeline), so test
 * fixtures below use `pad1024()` to build realistic-length embeddings instead of short
 * illustrative arrays.
 */
function pad1024(...values: number[]): number[] {
  const padded = new Array(1024).fill(0);
  values.forEach((v, i) => { padded[i] = v; });
  return padded;
}

describe('humanDistance / humanSimilarity', () => {
  it('humanDistance is zero for identical vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(humanDistance(a, a)).toBe(0);
  });

  it("humanDistance matches Human's formula (multiplier(25) * sum-of-squared-diffs, rounded to 2 decimals)", () => {
    const a = new Float32Array([0]);
    const b = new Float32Array([1]);
    expect(humanDistance(a, b)).toBe(25);
  });

  it('humanSimilarity is 1 for identical vectors (short-circuit)', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(humanSimilarity(a, a)).toBe(1);
  });

  it('humanSimilarity sits exactly at Human\'s documented 0.5 "match" boundary for a known distance', () => {
    const a = new Float32Array([0]);
    const b = new Float32Array([10]);
    expect(humanSimilarity(a, b)).toBe(0.5);
  });

  it('SAME_PERSON_THRESHOLD matches Human\'s own documented "0.5 = match" guidance', () => {
    expect(SAME_PERSON_THRESHOLD).toBe(0.5);
    expect(SAME_PERSON_THRESHOLD).toBeGreaterThan(DEFAULT_MERGE_SUGGESTION_THRESHOLD);
  });

  it('humanSimilarity clamps to 0 for very dissimilar vectors', () => {
    const a = new Float32Array([0]);
    const b = new Float32Array([16]);
    expect(humanSimilarity(a, b)).toBe(0);
  });

  it('humanDistance is Infinity for descriptors of different lengths (never a truncated/silent comparison)', () => {
    const legacy = new Float32Array(128); // pre-2026-08 face-api.js descriptor length
    const current = new Float32Array(1024); // @vladmandic/human descriptor length
    expect(humanDistance(legacy, current)).toBe(Number.POSITIVE_INFINITY);
  });

  it('humanSimilarity is 0 (never a match) for descriptors of different lengths, even if the overlapping prefix is identical', () => {
    const legacy = new Float32Array(128).fill(1);
    const current = new Float32Array(1024).fill(1); // first 128 values identical to `legacy`
    expect(humanSimilarity(legacy, current)).toBe(0);
  });
});

describe('runClientSideClustering', () => {
  it('groups two near-identical faces into the same brand-new person cluster', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'photo-a', embedding: pad1024(1, 1, 1) },
      { id: 2, photoId: 'photo-b', embedding: pad1024(1.01, 1.01, 1.01) },
    ];

    const results = await runClientSideClustering(faces, []);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBeNull();
    expect(results[0].faceCount).toBe(2);
    expect(results[0].addedFaceIds).toEqual([1, 2]);
    expect(results[0].coverPhotoId).toBe('photo-a');
  });

  it('creates separate clusters for faces further apart than the same-person threshold', async () => {
    const far = 16; // humanSimilarity() = 0 for a single-component diff of 16 — see math tests above.
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'photo-a', embedding: pad1024(0, 0, 0) },
      { id: 2, photoId: 'photo-b', embedding: pad1024(far, 0, 0) },
    ];

    const results = await runClientSideClustering(faces, []);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.clusterId === null)).toBe(true);
  });

  it('assigns a new face to an existing cluster passed in from the server', async () => {
    const existingClusters: ClusterDataCluster[] = [
      { id: 42, centroidEmbedding: pad1024(2, 2, 2), faceCount: 3 },
    ];
    const faces: ClusterDataFace[] = [{ id: 1, photoId: 'photo-a', embedding: pad1024(2.01, 1.99, 2.0) }];

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBe(42);
    expect(results[0].faceCount).toBe(4);
    expect(results[0].addedFaceIds).toEqual([1]);
  });

  it('lets a face join a brand-new cluster created earlier in the SAME pass', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'photo-a', embedding: pad1024(5, 5, 5) },
      { id: 2, photoId: 'photo-b', embedding: pad1024(5.01, 5.01, 5.01) },
      { id: 3, photoId: 'photo-c', embedding: pad1024(5.02, 4.98, 5.0) },
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
      { id: 1, centroidEmbedding: pad1024(0, 0, 0), faceCount: 1 }, // never matched, should be untouched
    ];
    const faces: ClusterDataFace[] = [{ id: 1, photoId: 'photo-a', embedding: pad1024(500, 500, 500) }]; // wildly different

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBeNull(); // new cluster, existing one untouched
  });

  it('reports progress via the onProgress callback', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'photo-a', embedding: pad1024(1, 1, 1) },
      { id: 2, photoId: 'photo-b', embedding: pad1024(2, 2, 2) },
    ];
    const calls: Array<[number, number]> = [];

    await runClientSideClustering(faces, [], (processed, total) => calls.push([processed, total]));

    expect(calls).toEqual([[1, 2], [2, 2]]);
  });

  it('filters out (and never uses) faces or clusters with a malformed (non-1024) embedding length', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'photo-a', embedding: [1, 1, 1] }, // malformed — only 3 numbers
      { id: 2, photoId: 'photo-b', embedding: pad1024(9, 9, 9) },
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
    // cluster whose centroid sits at [0,0,0,...] with 35 accumulated members — under the OLD
    // unbounded running-average formula (`centroid += diff / newCount`), a single new face would
    // only move the centroid by 1/36th of the difference, making it essentially immovable at
    // this size. Under the capped formula, a new face should still move it by a fixed ~1/30
    // weight.
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad1024(0, 0, 0), faceCount: 35 },
    ];
    // A face close enough to match (within SAME_PERSON_THRESHOLD) but clearly offset, so we can
    // observe how far the centroid actually moved.
    const faces: ClusterDataFace[] = [{ id: 999, photoId: 'photo-x', embedding: pad1024(3, 0, 0) }];

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    // Capped weight = 1 / min(36, 30) = 1/30 -> centroid[0] moves from 0 to 3 * (1/30) = 0.1,
    // NOT the old formula's 3 * (1/36) ≈ 0.0833.
    expect(results[0].centroidEmbedding[0]).toBeCloseTo(0.1, 5);
  });

  it('FREEZES the centroid entirely once a cluster reaches CENTROID_FREEZE_SIZE (40), preventing unbounded long-term drift even at the capped rate (fix for a cluster still absorbing multiple different people despite the drift cap alone)', async () => {
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad1024(0, 0, 0), faceCount: 40 },
    ];
    const faces: ClusterDataFace[] = [{ id: 999, photoId: 'photo-x', embedding: pad1024(3, 0, 0) }];

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    // Centroid must NOT move at all once frozen — still exactly 0, not 3 * (1/30) = 0.1.
    expect(results[0].centroidEmbedding[0]).toBeCloseTo(0, 5);
    expect(results[0].faceCount).toBe(41);
  });

  it('a small/new cluster still matches at the flat baseline threshold (no behavior change for the common case)', async () => {
    // A single-dimension diff of 9.4 scores ~0.55 similarity — above the flat baseline
    // SAME_PERSON_THRESHOLD (0.5), so a small cluster (below THRESHOLD_GROWTH_START=12) should
    // still accept it exactly as before this fix.
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad1024(0), faceCount: 10 },
    ];
    const faces: ClusterDataFace[] = [{ id: 999, photoId: 'photo-x', embedding: pad1024(9.4) }];

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBe(1);
  });

  it('a large, well-established cluster requires a MORE CONFIDENT match, rejecting the same borderline similarity a small cluster would accept (fix for the 2467-face runaway-merge incident, which a flat hard cap alone did not solve)', async () => {
    // Same ~0.55-similarity face as above, but this time against an already-large (150-member)
    // cluster — at that size the adaptive threshold has risen to its 0.6 ceiling
    // (THRESHOLD_GROWTH_START=12, THRESHOLD_GROWTH_RATE=0.003, MAX_THRESHOLD_BOOST=0.15 -> fully
    // saturated well before 150 members), so this borderline match must now be REJECTED,
    // starting a new cluster instead of further diluting the large one.
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad1024(0), faceCount: 150 },
    ];
    const faces: ClusterDataFace[] = [{ id: 999, photoId: 'photo-x', embedding: pad1024(9.4) }];

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBeNull(); // rejected from cluster 1, started a new one instead
  });

  it('lets a genuinely large, legitimate person (200+ photos) keep growing when the match is confidently ABOVE the raised bar — the whole point of replacing the old flat 60-face hard cap', async () => {
    // A clearly-matching (near-identical) face should still join even a very large cluster,
    // since 0.5+diff-derived-near-1.0 similarity comfortably clears the raised (but capped at
    // 0.65) threshold — unlike the old flat MAX_AUTO_CLUSTER_SIZE=60 cap, which would have
    // rejected this unconditionally purely based on size, incorrectly splitting a real
    // recurring person (e.g. the photographer themselves) into multiple groups.
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad1024(0), faceCount: 250 },
    ];
    const faces: ClusterDataFace[] = [{ id: 999, photoId: 'photo-x', embedding: pad1024(0.01) }]; // near-identical

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBe(1);
    expect(results[0].faceCount).toBe(251);
  });
});

describe('findClientSideMergeSuggestions', () => {
  it('suggests a pair of clusters whose centroids are near-identical, but not a far-apart third cluster', async () => {
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad1024(1, 1, 1), faceCount: 1 },
      { id: 2, centroidEmbedding: pad1024(1.01, 1.01, 1.01), faceCount: 1 },
      { id: 3, centroidEmbedding: pad1024(50, 50, 50), faceCount: 1 },
    ];

    const suggestions = await findClientSideMergeSuggestions(clusters);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ clusterAId: 1, clusterBId: 2 });
    expect(suggestions[0].similarity).toBeGreaterThanOrEqual(DEFAULT_MERGE_SUGGESTION_THRESHOLD);
  });

  it('only ever reports a pair once, in (lower id, higher id) order', async () => {
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad1024(1, 1, 1), faceCount: 1 },
      { id: 2, centroidEmbedding: pad1024(1.01, 1.01, 1.01), faceCount: 1 },
    ];

    const suggestions = await findClientSideMergeSuggestions(clusters);

    expect(suggestions).toHaveLength(1);
    expect(suggestions.filter((s) => s.clusterAId === 2 && s.clusterBId === 1)).toHaveLength(0);
  });

  it('returns an empty array for an empty or single-cluster library', async () => {
    expect(await findClientSideMergeSuggestions([])).toEqual([]);
    expect(await findClientSideMergeSuggestions([{ id: 1, centroidEmbedding: pad1024(1), faceCount: 1 }])).toEqual([]);
  });

  it('surfaces a pair scoring between the lenient default threshold and the stricter auto-merge threshold', async () => {
    // A diff of 6.5 across all 3 dims scores 0.4 similarity — below SAME_PERSON_THRESHOLD
    // (0.5, which automatic clustering uses) but at/above DEFAULT_MERGE_SUGGESTION_THRESHOLD
    // (0.35, used only for human-reviewed suggestions) — this is exactly the gap this feature
    // exists to catch (see faceClusteringClient.ts's doc comment on the two thresholds).
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad1024(0, 0, 0), faceCount: 1 },
      { id: 2, centroidEmbedding: pad1024(6.5, 6.5, 6.5), faceCount: 1 },
    ];

    const atDefault = await findClientSideMergeSuggestions(clusters, DEFAULT_MERGE_SUGGESTION_THRESHOLD);
    expect(atDefault).toHaveLength(1);

    const atStrict = await findClientSideMergeSuggestions(clusters, SAME_PERSON_THRESHOLD);
    expect(atStrict).toHaveLength(0);
  });

  it('reports progress via the onProgress callback', async () => {
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad1024(0, 0, 0), faceCount: 1 },
      { id: 2, centroidEmbedding: pad1024(100, 100, 100), faceCount: 1 },
      { id: 3, centroidEmbedding: pad1024(200, 200, 200), faceCount: 1 },
    ];
    const calls: Array<[number, number]> = [];

    await findClientSideMergeSuggestions(clusters, DEFAULT_MERGE_SUGGESTION_THRESHOLD, (comparisons, total) =>
      calls.push([comparisons, total])
    );

    // C(3,2) = 3 total comparisons.
    expect(calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('ignores (never compares against) any cluster with a malformed (non-1024) centroid length', async () => {
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad1024(1, 1, 1), faceCount: 1 },
      { id: 2, centroidEmbedding: pad1024(1.01, 1.01, 1.01), faceCount: 1 },
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
      { id: 1, photoId: 'p1', embedding: pad1024(0) },
      { id: 2, photoId: 'p2', embedding: pad1024(0) },
      { id: 3, photoId: 'p3', embedding: pad1024(1) },
      { id: 4, photoId: 'p4', embedding: pad1024(-1) },
    ];

    const results = await runDeepRebuildClustering(faces);

    expect(results).toHaveLength(1);
    expect(results[0].addedFaceIds.slice().sort()).toEqual([1, 2, 3, 4]);
    expect(results[0].faceCount).toBe(4);
  });

  it('keeps two different identities in separate clusters (the class of bug centroid-based matching was vulnerable to)', async () => {
    // A single-dimension diff of 15 scores similarity around 0.08 (well below both the 0.5
    // average bar and the 0.55 max-representative bar) — a clearly different identity.
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'p1', embedding: pad1024(0) },
      { id: 2, photoId: 'p2', embedding: pad1024(15) },
    ];

    const results = await runDeepRebuildClustering(faces);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.faceCount === 1)).toBe(true);
  });

  it('rejects a face whose similarity to a clusters real representative members is below the required bar, instead of silently accepting it', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'p1', embedding: pad1024(0) },
      { id: 2, photoId: 'p2', embedding: pad1024(0) },
      { id: 3, photoId: 'p3', embedding: pad1024(15) }, // similarity ~0.08 to the cluster above
    ];

    const results = await runDeepRebuildClustering(faces);

    expect(results).toHaveLength(2);
    const sizes = results.map((r) => r.faceCount).slice().sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('filters out faces with a malformed embedding length before clustering, matching the existing safety guard', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'p1', embedding: pad1024(0) },
      { id: 2, photoId: 'p2', embedding: [1, 2, 3] }, // malformed — not 1024 long
    ];

    const results = await runDeepRebuildClustering(faces);

    expect(results).toHaveLength(1);
    expect(results[0].addedFaceIds).toEqual([1]);
  });

  it('returns clusterId: null for every result (caller is expected to reset all clusters before running a deep rebuild)', async () => {
    const faces: ClusterDataFace[] = [{ id: 1, photoId: 'p1', embedding: pad1024(0) }];

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
      faces.push({ id: i + 1, photoId: `p${i + 1}`, embedding: pad1024(0) });
    }
    // Then a borderline-similar face (diff of 9.4 -> ~0.55 similarity, comfortably above the
    // flat 0.5 baseline but BELOW the fully-grown adaptive bar for a 150-member cluster, which
    // saturates at 0.65 well before that size).
    faces.push({ id: 1000, photoId: 'p-borderline', embedding: pad1024(9.4) });

    const results = await runDeepRebuildClustering(faces);

    expect(results).toHaveLength(2);
    const bigCluster = results.find((r) => r.faceCount === 150);
    const newCluster = results.find((r) => r.faceCount === 1);
    expect(bigCluster).toBeDefined();
    expect(newCluster).toBeDefined();
    expect(newCluster?.addedFaceIds).toEqual([1000]);
  });
});
