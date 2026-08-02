import { describe, expect, it } from 'vitest';
import { runFaceClustering, countUnclusteredFaces, findMergeSuggestions, humanDistance, humanSimilarity, SAME_PERSON_THRESHOLD } from '../faceClustering';
import type { MergeSuggestionCursor } from '../faceClustering';
import type { Env } from '../types';

/**
 * Tests for the People/face-grouping clustering job (faceClustering.ts).
 * Covers both the ported Human distance/similarity math and the greedy
 * nearest-centroid assignment logic end-to-end, backed by a minimal
 * in-memory fake D1 that only supports the exact query shapes
 * runFaceClustering() issues.
 */

interface FaceRow {
  id: number;
  photo_id: string;
  embedding: ArrayBuffer;
  person_id: number | null;
}

interface ClusterRow {
  id: number;
  centroid_embedding: ArrayBuffer;
  face_count: number;
}

class FakeFaceClusteringDb {
  faces: FaceRow[] = [];
  clusters: ClusterRow[] = [];
  private nextClusterId = 1;

  prepare(query: string) {
    let boundArgs: unknown[] = [];
    const db = this;
    const stmt = {
      bind(...args: unknown[]) {
        boundArgs = args;
        return stmt;
      },
      async all<T>() {
        if (query.includes('FROM photo_faces f') && query.includes('WHERE f.person_id IS NULL')) {
          const limit = Number(boundArgs[0]);
          const results = db.faces
            .filter((f) => f.person_id === null)
            .slice(0, limit)
            .map((f) => ({ id: f.id, photo_id: f.photo_id, embedding: f.embedding }));
          return { results: results as T[] };
        }
        if (query.includes('FROM person_clusters') && query.includes('ORDER BY face_count DESC')) {
          // Mirrors the real query's "top N by face_count" candidate cap (see
          // MAX_CLUSTERS_CONSIDERED in faceClustering.ts) so tests can verify
          // clusters ranked outside that cap are genuinely never compared against.
          const limit = Number(boundArgs[0]);
          const sorted = [...db.clusters].sort((a, b) => b.face_count - a.face_count);
          const results = sorted.slice(0, limit).map((c) => ({
            id: c.id,
            centroid_embedding: c.centroid_embedding,
            face_count: c.face_count,
          }));
          return { results: results as T[] };
        }
        if (query.includes('FROM person_clusters') && query.includes('WHERE id >= ?')) {
          // findMergeSuggestions() only fetches clusters at/after the cursor's source id (see
          // its doc comment on why re-fetching already-scanned clusters would be pure waste).
          const minId = Number(boundArgs[0] ?? 0);
          const sorted = [...db.clusters].filter((c) => c.id >= minId).sort((a, b) => a.id - b.id);
          const results = sorted.map((c) => ({ id: c.id, centroid_embedding: c.centroid_embedding }));
          return { results: results as T[] };
        }
        return { results: [] as T[] };
      },
      async first<T>() {
        if (query.includes('INSERT INTO person_clusters') && query.includes('RETURNING id')) {
          const [centroidEmbedding, faceCount] = boundArgs as [ArrayBuffer, number];
          const id = db.nextClusterId++;
          db.clusters.push({ id, centroid_embedding: centroidEmbedding, face_count: faceCount });
          return { id } as T;
        }
        if (query.includes('SELECT COUNT(*) as count FROM photo_faces WHERE person_id IS NULL')) {
          const count = db.faces.filter((f) => f.person_id === null).length;
          return { count } as T;
        }
        if (query.includes('SELECT COUNT(*) as count FROM person_clusters')) {
          return { count: db.clusters.length } as T;
        }
        return null;
      },
      async run() {
        if (query.includes('UPDATE person_clusters SET centroid_embedding')) {
          const [centroidEmbedding, faceCount, id] = boundArgs as [ArrayBuffer, number, number];
          const cluster = db.clusters.find((c) => c.id === id);
          if (cluster) {
            cluster.centroid_embedding = centroidEmbedding;
            cluster.face_count = faceCount;
          }
        }
        if (query.includes('UPDATE photo_faces SET person_id')) {
          const [personId, id] = boundArgs as [number, number];
          const face = db.faces.find((f) => f.id === id);
          if (face) face.person_id = personId;
        }
        return { success: true };
      },
    };
    return stmt;
  }
}

function makeEnv(db: FakeFaceClusteringDb): Env {
  return { DB: db as unknown as Env['DB'] } as Env;
}

function embeddingOf(...values: number[]): ArrayBuffer {
  return new Float32Array(values).buffer;
}

describe('humanDistance / humanSimilarity', () => {
  it('humanDistance is zero for identical vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(humanDistance(a, a)).toBe(0);
  });

  it('humanDistance matches Human\'s formula (multiplier(25) * sum-of-squared-diffs, rounded to 2 decimals)', () => {
    const a = new Float32Array([0]);
    const b = new Float32Array([1]);
    // sum-of-squared-diffs = 1 -> 25 * 1 = 25.
    expect(humanDistance(a, b)).toBe(25);
  });

  it('humanSimilarity is 1 for identical vectors (short-circuit)', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(humanSimilarity(a, a)).toBe(1);
  });

  it('humanSimilarity sits exactly at the documented 0.5 "match" boundary for a known distance', () => {
    // sum-of-squared-diffs = 100 -> dist = 25*100 = 2500 -> root = sqrt(2500) = 50
    // -> norm = (1 - 50/100 - 0.2) / 0.6 = 0.3 / 0.6 = 0.5.
    const a = new Float32Array([0]);
    const b = new Float32Array([10]);
    expect(humanSimilarity(a, b)).toBe(0.5);
    expect(SAME_PERSON_THRESHOLD).toBe(0.5);
  });

  it('humanSimilarity clamps to 0 for very dissimilar vectors', () => {
    // sum-of-squared-diffs = 256 -> dist = 6400 -> root = 80
    // -> norm = (1 - 0.8 - 0.2) / 0.6 = 0, clamped at the floor.
    const a = new Float32Array([0]);
    const b = new Float32Array([16]);
    expect(humanSimilarity(a, b)).toBe(0);
  });
});

describe('runFaceClustering', () => {
  it('groups two near-identical faces into the same person cluster', async () => {
    const db = new FakeFaceClusteringDb();
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embeddingOf(1, 1, 1), person_id: null },
      { id: 2, photo_id: 'photo-b', embedding: embeddingOf(1.01, 1.01, 1.01), person_id: null },
    ];

    await runFaceClustering(makeEnv(db));

    expect(db.clusters).toHaveLength(1);
    expect(db.faces.every((f) => f.person_id === db.clusters[0].id)).toBe(true);
    expect(db.clusters[0].face_count).toBe(2);
  });

  it('creates separate clusters for faces further apart than the same-person threshold', async () => {
    const db = new FakeFaceClusteringDb();
    // A single-component difference of 16 gives humanSimilarity() = 0 (clamped),
    // well below SAME_PERSON_THRESHOLD (0.5) — see humanSimilarity tests above.
    const far = 16;
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embeddingOf(0, 0, 0), person_id: null },
      { id: 2, photo_id: 'photo-b', embedding: embeddingOf(far, 0, 0), person_id: null },
    ];

    await runFaceClustering(makeEnv(db));

    expect(db.clusters).toHaveLength(2);
    const personIds = new Set(db.faces.map((f) => f.person_id));
    expect(personIds.size).toBe(2);
  });

  it('assigns a new face to an existing cluster created earlier in the same run', async () => {
    const db = new FakeFaceClusteringDb();
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embeddingOf(2, 2, 2), person_id: null },
      { id: 2, photo_id: 'photo-b', embedding: embeddingOf(2.02, 2.02, 2.02), person_id: null },
      { id: 3, photo_id: 'photo-c', embedding: embeddingOf(2.01, 1.99, 2.0), person_id: null },
    ];

    await runFaceClustering(makeEnv(db));

    expect(db.clusters).toHaveLength(1);
    expect(db.clusters[0].face_count).toBe(3);
  });

  it('does nothing when there are no unclustered faces', async () => {
    const db = new FakeFaceClusteringDb();
    await runFaceClustering(makeEnv(db));
    expect(db.clusters).toHaveLength(0);
  });

  it('caps a single invocation at the max batch size (40) when there are no existing clusters yet', async () => {
    const db = new FakeFaceClusteringDb();
    // 50 unclustered faces, no pre-existing person_clusters — computeBatchSize()
    // returns MAX_BATCH_SIZE (40) in this case, so one call must process
    // exactly 40 and leave 10 for the next invocation (this is now a SINGLE,
    // CPU-cheap batch per call — see faceClustering.ts's doc comment on why
    // an earlier wall-clock multi-batch-looping version got hard-killed with
    // Cloudflare Error 1102 "Worker exceeded resource limits").
    db.faces = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      photo_id: `photo-${i}`,
      embedding: embeddingOf(1 + i * 0.0001, 1, 1),
      person_id: null,
    }));

    const result = await runFaceClustering(makeEnv(db));

    expect(result.processed).toBe(40);
    expect(db.faces.filter((f) => f.person_id === null)).toHaveLength(10);
  });

  it('shrinks the batch size to 1 once the number of existing clusters hits the MAX_CLUSTERS_CONSIDERED cap (300), to stay within the CPU budget', async () => {
    const db = new FakeFaceClusteringDb();
    // 400 pre-existing, well-separated clusters (far from the new faces below, so none of
    // them accidentally match) — comfortably past the 300-cluster candidate cap, so
    // computeBatchSize() bottoms out at MIN_BATCH_SIZE (1) regardless of the exact count.
    db.clusters = Array.from({ length: 400 }, (_, i) => ({
      id: i + 1,
      centroid_embedding: embeddingOf(1000 + i, 1000 + i, 1000 + i),
      face_count: 400 - i, // distinct, descending — irrelevant to this test but keeps ordering deterministic
    }));
    db.faces = Array.from({ length: 15 }, (_, i) => ({
      id: 1000 + i,
      photo_id: `photo-${i}`,
      embedding: embeddingOf(1 + i * 0.0001, 1, 1),
      person_id: null,
    }));

    const result = await runFaceClustering(makeEnv(db));

    expect(result.processed).toBe(1);
    expect(db.faces.filter((f) => f.person_id === null)).toHaveLength(14);
  });

  it('never matches a face against a cluster ranked outside the top MAX_CLUSTERS_CONSIDERED (300) by face_count', async () => {
    const db = new FakeFaceClusteringDb();
    // 305 clusters: 304 far-away "noise" clusters with high face_count (ranks 1..304, always
    // in the top-300 window), plus ONE cluster with the lowest face_count of all (guaranteed
    // to be ranked 305th, i.e. excluded from the top-300 window) whose centroid is IDENTICAL
    // to the incoming face below. If the candidate cap works correctly, this identical-looking
    // face must NOT merge into that excluded cluster (it's never even compared against it) —
    // it should form a brand new cluster instead.
    const excludedClusterId = 305;
    db.clusters = [
      ...Array.from({ length: 304 }, (_, i) => ({
        id: i + 1,
        centroid_embedding: embeddingOf(1000 + i, 1000 + i, 1000 + i),
        face_count: 304 - i + 1, // 305, 304, ..., 2 — all comfortably rank ahead of the excluded one
      })),
      { id: excludedClusterId, centroid_embedding: embeddingOf(5, 5, 5), face_count: 1 }, // lowest — rank 305, excluded
    ];
    db.faces = [
      { id: 9001, photo_id: 'photo-target', embedding: embeddingOf(5, 5, 5), person_id: null }, // identical to the excluded cluster
    ];

    await runFaceClustering(makeEnv(db));

    const targetFace = db.faces.find((f) => f.id === 9001)!;
    expect(targetFace.person_id).not.toBeNull();
    expect(targetFace.person_id).not.toBe(excludedClusterId); // must NOT have merged into the excluded cluster
    const excludedCluster = db.clusters.find((c) => c.id === excludedClusterId)!;
    expect(excludedCluster.face_count).toBe(1); // untouched
    expect(db.clusters).toHaveLength(306); // a brand new cluster was created instead
  });

  it('returns processed: 0 when there is nothing to cluster', async () => {
    const db = new FakeFaceClusteringDb();
    const result = await runFaceClustering(makeEnv(db));
    expect(result.processed).toBe(0);
  });
});

describe('countUnclusteredFaces', () => {
  it('counts only faces with person_id IS NULL', async () => {
    const db = new FakeFaceClusteringDb();
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embeddingOf(1, 1, 1), person_id: null },
      { id: 2, photo_id: 'photo-b', embedding: embeddingOf(2, 2, 2), person_id: 5 },
      { id: 3, photo_id: 'photo-c', embedding: embeddingOf(3, 3, 3), person_id: null },
    ];

    expect(await countUnclusteredFaces(makeEnv(db))).toBe(2);
  });

  it('returns 0 once everything has been clustered', async () => {
    const db = new FakeFaceClusteringDb();
    db.faces = [{ id: 1, photo_id: 'photo-a', embedding: embeddingOf(1, 1, 1), person_id: null }];

    await runFaceClustering(makeEnv(db));

    expect(await countUnclusteredFaces(makeEnv(db))).toBe(0);
  });
});

describe('findMergeSuggestions', () => {
  it('suggests a pair of clusters whose centroids are near-identical, but not a far-apart third cluster', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [
      { id: 1, centroid_embedding: embeddingOf(1, 1, 1), face_count: 1 },
      { id: 2, centroid_embedding: embeddingOf(1.01, 1.01, 1.01), face_count: 1 },
      { id: 3, centroid_embedding: embeddingOf(50, 50, 50), face_count: 1 },
    ];

    const result = await findMergeSuggestions(makeEnv(db), null);

    expect(result.nextCursor).toBeNull();
    expect(result.totalClusters).toBe(3);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({ clusterAId: 1, clusterBId: 2 });
    expect(result.suggestions[0].similarity).toBeGreaterThanOrEqual(SAME_PERSON_THRESHOLD);
  });

  it('only ever reports a pair once, in (lower id, higher id) order', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [
      { id: 1, centroid_embedding: embeddingOf(1, 1, 1), face_count: 1 },
      { id: 2, centroid_embedding: embeddingOf(1.01, 1.01, 1.01), face_count: 1 },
    ];

    const result = await findMergeSuggestions(makeEnv(db), null);

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions.filter((s) => s.clusterAId === 2 && s.clusterBId === 1)).toHaveLength(0);
  });

  it('returns an empty result for an empty library', async () => {
    const db = new FakeFaceClusteringDb();
    const result = await findMergeSuggestions(makeEnv(db), null);
    expect(result).toEqual({ suggestions: [], nextCursor: null, totalClusters: 0 });
  });

  it('resumes from a cursor without re-scanning the pair it points past', async () => {
    const db = new FakeFaceClusteringDb();
    // Clusters 1 and 2 are near-identical (a "should-suggest" pair) specifically so we can
    // prove the cursor causes it to be SKIPPED rather than re-scanned; 3 and 4 are far from
    // everything (including each other) so no other suggestions should appear.
    db.clusters = [
      { id: 1, centroid_embedding: embeddingOf(1, 1, 1), face_count: 1 },
      { id: 2, centroid_embedding: embeddingOf(1.01, 1.01, 1.01), face_count: 1 },
      { id: 3, centroid_embedding: embeddingOf(500, 500, 500), face_count: 1 },
      { id: 4, centroid_embedding: embeddingOf(1000, 1000, 1000), face_count: 1 },
    ];

    const cursor: MergeSuggestionCursor = { sourceId: 1, candidateId: 3 }; // resume AT (1,3), skipping (1,2)
    const result = await findMergeSuggestions(makeEnv(db), cursor);

    expect(result.nextCursor).toBeNull();
    expect(result.suggestions).toEqual([]);
  });

  it("falls back gracefully when the cursor's source cluster no longer exists (e.g. merged away)", async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [
      { id: 1, centroid_embedding: embeddingOf(1, 1, 1), face_count: 1 },
      { id: 3, centroid_embedding: embeddingOf(1.01, 1.01, 1.01), face_count: 1 },
    ];
    // cursor references id=2, which no longer exists (merged/deleted between calls) — should
    // fall forward to the next existing cluster (id=3) and continue from there without throwing.
    const cursor: MergeSuggestionCursor = { sourceId: 2, candidateId: 2 };

    const result = await findMergeSuggestions(makeEnv(db), cursor);

    expect(result.suggestions).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it('returns an empty result when the cursor is entirely past the end of the cluster list', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [{ id: 1, centroid_embedding: embeddingOf(1, 1, 1), face_count: 1 }];
    const cursor: MergeSuggestionCursor = { sourceId: 999, candidateId: 999 };

    const result = await findMergeSuggestions(makeEnv(db), cursor);

    expect(result).toEqual({ suggestions: [], nextCursor: null, totalClusters: 1 });
  });

  it('stops after a deterministic comparison budget (NOT a wall-clock guard) when the pair count exceeds it, and resuming eventually completes the full scan', async () => {
    // A DETERMINISTIC comparison-count cutoff is used here specifically because a wall-clock
    // guard is provably useless for this loop on real Cloudflare Workers — Date.now() is frozen
    // during synchronous execution there (see the doc comment above MAX_MERGE_COMPARISONS_PER_INVOCATION
    // in faceClustering.ts) — but Node's test runtime does NOT freeze Date.now(), so a
    // wall-clock-based version of this test would have passed locally while still 503ing in
    // production (exactly what happened). Asserting on the exact deterministic cutoff count
    // instead is what actually catches a regression back to a wall-clock guard.
    const db = new FakeFaceClusteringDb();
    // 27 clusters, all pairwise far apart (no two ever look like a match) => 27*26/2 = 351
    // total possible pairs, comfortably more than the ~341 comparison budget for one call.
    db.clusters = Array.from({ length: 27 }, (_, i) => ({
      id: i + 1,
      centroid_embedding: embeddingOf(i * 1000, i * 1000, i * 1000),
      face_count: 1,
    }));

    const firstCall = await findMergeSuggestions(makeEnv(db), null);
    expect(firstCall.nextCursor).not.toBeNull(); // Budget hit before the full 351-pair scan finished.
    expect(firstCall.suggestions).toEqual([]); // Nothing actually matches.

    const secondCall = await findMergeSuggestions(makeEnv(db), firstCall.nextCursor);
    expect(secondCall.nextCursor).toBeNull(); // Remaining ~10 pairs easily finish in one more call.
    expect(secondCall.suggestions).toEqual([]);
  });
});
