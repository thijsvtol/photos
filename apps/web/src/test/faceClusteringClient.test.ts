import { describe, expect, it } from 'vitest';
import {
  humanDistance,
  humanSimilarity,
  SAME_PERSON_THRESHOLD,
  DEFAULT_MERGE_SUGGESTION_THRESHOLD,
  runClientSideClustering,
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
    // Simulate an existing, already-large cluster whose centroid sits at [0,0,0,...] with 50
    // accumulated members — under the OLD unbounded running-average formula
    // (`centroid += diff / newCount`), a single new face would only move the centroid by
    // 1/51st of the difference, making it essentially immovable at this size. Under the capped
    // formula, a new face should still move it by a fixed ~1/30 weight.
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad1024(0, 0, 0), faceCount: 50 },
    ];
    // A face close enough to match (within SAME_PERSON_THRESHOLD) but clearly offset, so we can
    // observe how far the centroid actually moved.
    const faces: ClusterDataFace[] = [{ id: 999, photoId: 'photo-x', embedding: pad1024(3, 0, 0) }];

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    // Capped weight = 1 / min(51, 30) = 1/30 -> centroid[0] moves from 0 to 3 * (1/30) = 0.1,
    // NOT the old formula's 3 * (1/51) ≈ 0.0588.
    expect(results[0].centroidEmbedding[0]).toBeCloseTo(0.1, 5);
  });

  it('excludes an existing cluster already at/over MAX_AUTO_CLUSTER_SIZE (60) from receiving any more automatic matches (regression test for the 2467-face runaway-merge incident that survived the drift-cap fix alone)', async () => {
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad1024(0, 0, 0), faceCount: 60 }, // already at the cap
    ];
    // A face that would clearly match cluster 1 on similarity alone (identical centroid).
    const faces: ClusterDataFace[] = [{ id: 999, photoId: 'photo-x', embedding: pad1024(0, 0, 0) }];

    const results = await runClientSideClustering(faces, existingClusters);

    // The face must NOT be added to cluster 1 (still at the cap) — instead it starts a
    // brand-new cluster.
    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBeNull();
    expect(results[0].addedFaceIds).toEqual([999]);
  });

  it('stops adding to a cluster mid-pass once it reaches MAX_AUTO_CLUSTER_SIZE, redirecting further matching faces elsewhere instead of letting it grow unbounded', async () => {
    // Start one cluster just 1 face below the cap, then feed it several more near-identical
    // faces in the same pass — the FIRST should still be accepted (bringing it exactly to the
    // cap), but every face AFTER that must be redirected into a new cluster instead.
    const existingClusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: pad1024(0, 0, 0), faceCount: 59 },
    ];
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'photo-a', embedding: pad1024(0, 0, 0) },
      { id: 2, photoId: 'photo-b', embedding: pad1024(0, 0, 0) },
      { id: 3, photoId: 'photo-c', embedding: pad1024(0, 0, 0) },
    ];

    const results = await runClientSideClustering(faces, existingClusters);

    const originalClusterResult = results.find((r) => r.clusterId === 1);
    expect(originalClusterResult?.faceCount).toBe(60); // 59 + exactly 1 more, then capped
    expect(originalClusterResult?.addedFaceIds).toEqual([1]);

    // Faces 2 and 3 must have gone somewhere else (a brand-new cluster), not into cluster 1.
    const newClusterResults = results.filter((r) => r.clusterId === null);
    expect(newClusterResults.length).toBeGreaterThan(0);
    const allNewlyAddedIds = newClusterResults.flatMap((r) => r.addedFaceIds);
    expect(allNewlyAddedIds).toEqual(expect.arrayContaining([2, 3]));
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
