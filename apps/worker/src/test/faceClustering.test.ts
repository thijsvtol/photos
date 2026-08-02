import { describe, expect, it } from 'vitest';
import { runFaceClustering, countUnclusteredFaces, humanDistance, humanSimilarity, SAME_PERSON_THRESHOLD } from '../faceClustering';
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
        if (query.includes('FROM person_clusters') && !query.includes('WHERE')) {
          const results = db.clusters.map((c) => ({
            id: c.id,
            centroid_embedding: c.centroid_embedding,
            face_count: c.face_count,
          }));
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

  it('shrinks the batch size as the number of existing clusters grows, to stay within the CPU budget', async () => {
    const db = new FakeFaceClusteringDb();
    // 400 pre-existing, well-separated clusters (far from the new faces below,
    // so none of them accidentally match) — with MAX_COMPARISONS_PER_INVOCATION
    // = 4000, this should shrink the batch size to floor(4000/400) = 10.
    db.clusters = Array.from({ length: 400 }, (_, i) => ({
      id: i + 1,
      centroid_embedding: embeddingOf(1000 + i, 1000 + i, 1000 + i),
      face_count: 5,
    }));
    db.faces = Array.from({ length: 15 }, (_, i) => ({
      id: 1000 + i,
      photo_id: `photo-${i}`,
      embedding: embeddingOf(1 + i * 0.0001, 1, 1),
      person_id: null,
    }));

    const result = await runFaceClustering(makeEnv(db));

    expect(result.processed).toBe(10);
    expect(db.faces.filter((f) => f.person_id === null)).toHaveLength(5);
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
