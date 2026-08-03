import { describe, expect, it } from 'vitest';
import {
  humanDistance,
  humanSimilarity,
  SAME_PERSON_THRESHOLD,
  DEFAULT_MERGE_SUGGESTION_THRESHOLD,
  runClientSideClustering,
  findClientSideMergeSuggestions,
} from '../faceClusteringClient';
import type { ClusterDataFace, ClusterDataCluster } from '../api';

/**
 * Tests for the client-side face-clustering + merge-suggestion matching that replaced the
 * old server-side (Cloudflare Worker) implementation — see faceClusteringClient.ts's doc
 * comment for why this moved out of the Worker entirely (repeated CPU-time-limit crashes).
 */

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

  it('SAME_PERSON_THRESHOLD is deliberately looser than Human\'s generic 0.5 guidance, for this app\'s action-sports content', () => {
    expect(SAME_PERSON_THRESHOLD).toBe(0.45);
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
      { id: 1, photoId: 'photo-a', embedding: [1, 1, 1] },
      { id: 2, photoId: 'photo-b', embedding: [1.01, 1.01, 1.01] },
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
      { id: 1, photoId: 'photo-a', embedding: [0, 0, 0] },
      { id: 2, photoId: 'photo-b', embedding: [far, 0, 0] },
    ];

    const results = await runClientSideClustering(faces, []);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.clusterId === null)).toBe(true);
  });

  it('assigns a new face to an existing cluster passed in from the server', async () => {
    const existingClusters: ClusterDataCluster[] = [
      { id: 42, centroidEmbedding: [2, 2, 2], faceCount: 3 },
    ];
    const faces: ClusterDataFace[] = [{ id: 1, photoId: 'photo-a', embedding: [2.01, 1.99, 2.0] }];

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBe(42);
    expect(results[0].faceCount).toBe(4);
    expect(results[0].addedFaceIds).toEqual([1]);
  });

  it('lets a face join a brand-new cluster created earlier in the SAME pass', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'photo-a', embedding: [5, 5, 5] },
      { id: 2, photoId: 'photo-b', embedding: [5.01, 5.01, 5.01] },
      { id: 3, photoId: 'photo-c', embedding: [5.02, 4.98, 5.0] },
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
      { id: 1, centroidEmbedding: [0, 0, 0], faceCount: 1 }, // never matched, should be untouched
    ];
    const faces: ClusterDataFace[] = [{ id: 1, photoId: 'photo-a', embedding: [500, 500, 500] }]; // wildly different

    const results = await runClientSideClustering(faces, existingClusters);

    expect(results).toHaveLength(1);
    expect(results[0].clusterId).toBeNull(); // new cluster, existing one untouched
  });

  it('reports progress via the onProgress callback', async () => {
    const faces: ClusterDataFace[] = [
      { id: 1, photoId: 'photo-a', embedding: [1, 1, 1] },
      { id: 2, photoId: 'photo-b', embedding: [2, 2, 2] },
    ];
    const calls: Array<[number, number]> = [];

    await runClientSideClustering(faces, [], (processed, total) => calls.push([processed, total]));

    expect(calls).toEqual([[1, 2], [2, 2]]);
  });
});

describe('findClientSideMergeSuggestions', () => {
  it('suggests a pair of clusters whose centroids are near-identical, but not a far-apart third cluster', async () => {
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: [1, 1, 1], faceCount: 1 },
      { id: 2, centroidEmbedding: [1.01, 1.01, 1.01], faceCount: 1 },
      { id: 3, centroidEmbedding: [50, 50, 50], faceCount: 1 },
    ];

    const suggestions = await findClientSideMergeSuggestions(clusters);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ clusterAId: 1, clusterBId: 2 });
    expect(suggestions[0].similarity).toBeGreaterThanOrEqual(DEFAULT_MERGE_SUGGESTION_THRESHOLD);
  });

  it('only ever reports a pair once, in (lower id, higher id) order', async () => {
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: [1, 1, 1], faceCount: 1 },
      { id: 2, centroidEmbedding: [1.01, 1.01, 1.01], faceCount: 1 },
    ];

    const suggestions = await findClientSideMergeSuggestions(clusters);

    expect(suggestions).toHaveLength(1);
    expect(suggestions.filter((s) => s.clusterAId === 2 && s.clusterBId === 1)).toHaveLength(0);
  });

  it('returns an empty array for an empty or single-cluster library', async () => {
    expect(await findClientSideMergeSuggestions([])).toEqual([]);
    expect(await findClientSideMergeSuggestions([{ id: 1, centroidEmbedding: [1], faceCount: 1 }])).toEqual([]);
  });

  it('surfaces a pair scoring between the lenient default threshold and the stricter auto-merge threshold', async () => {
    // A diff of 6.5 across all 3 dims scores 0.4 similarity — below SAME_PERSON_THRESHOLD
    // (0.45, which automatic clustering uses) but at/above DEFAULT_MERGE_SUGGESTION_THRESHOLD
    // (0.35, used only for human-reviewed suggestions) — this is exactly the gap this feature
    // exists to catch (see faceClusteringClient.ts's doc comment on the two thresholds).
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: [0, 0, 0], faceCount: 1 },
      { id: 2, centroidEmbedding: [6.5, 6.5, 6.5], faceCount: 1 },
    ];

    const atDefault = await findClientSideMergeSuggestions(clusters, DEFAULT_MERGE_SUGGESTION_THRESHOLD);
    expect(atDefault).toHaveLength(1);

    const atStrict = await findClientSideMergeSuggestions(clusters, SAME_PERSON_THRESHOLD);
    expect(atStrict).toHaveLength(0);
  });

  it('reports progress via the onProgress callback', async () => {
    const clusters: ClusterDataCluster[] = [
      { id: 1, centroidEmbedding: [0, 0, 0], faceCount: 1 },
      { id: 2, centroidEmbedding: [100, 100, 100], faceCount: 1 },
      { id: 3, centroidEmbedding: [200, 200, 200], faceCount: 1 },
    ];
    const calls: Array<[number, number]> = [];

    await findClientSideMergeSuggestions(clusters, DEFAULT_MERGE_SUGGESTION_THRESHOLD, (comparisons, total) =>
      calls.push([comparisons, total])
    );

    // C(3,2) = 3 total comparisons.
    expect(calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });
});
