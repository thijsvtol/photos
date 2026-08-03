import { describe, expect, it } from 'vitest';
import { getClusterData, applyClusteringResults, countUnclusteredFaces } from '../faceClustering';
import type { Env } from '../types';

/**
 * Tests for the People/face-clustering I/O helpers (faceClustering.ts). The actual
 * vector-similarity math now runs client-side (see apps/web/src/faceClusteringClient.ts and
 * its own test file) — this worker module is pure I/O (fetch raw data, persist already-computed
 * results), so these tests only verify the D1 read/write shapes, not any matching logic.
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
        if (query.includes('FROM person_clusters')) {
          const sorted = [...db.clusters].sort((a, b) => a.id - b.id);
          const results = sorted.map((c) => ({
            id: c.id,
            centroid_embedding: c.centroid_embedding,
            face_count: c.face_count,
          }));
          return { results: results as T[] };
        }
        if (query.includes('FROM photo_faces') && query.includes('WHERE person_id IS NULL')) {
          const results = db.faces
            .filter((f) => f.person_id === null)
            .map((f) => ({ id: f.id, photo_id: f.photo_id, embedding: f.embedding }));
          return { results: results as T[] };
        }
        return { results: [] as T[] };
      },
      async first<T>() {
        if (query.includes('INSERT INTO person_clusters') && query.includes('RETURNING id')) {
          const [centroidEmbedding, faceCount, coverPhotoId] = boundArgs as [ArrayBuffer, number, string | null];
          const id = db.nextClusterId++;
          db.clusters.push({ id, centroid_embedding: centroidEmbedding, face_count: faceCount });
          void coverPhotoId;
          return { id } as T;
        }
        if (query.includes('SELECT COUNT(*) as count FROM photo_faces WHERE person_id IS NULL')) {
          const count = db.faces.filter((f) => f.person_id === null).length;
          return { count } as T;
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
          const [personId, ...faceIds] = boundArgs as [number, ...number[]];
          for (const faceId of faceIds) {
            const face = db.faces.find((f) => f.id === faceId);
            if (face) face.person_id = personId;
          }
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

describe('getClusterData', () => {
  it('returns both unclustered faces and existing clusters when includeFaces is true', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [{ id: 1, centroid_embedding: embeddingOf(1, 2, 3), face_count: 2 }];
    db.faces = [
      { id: 10, photo_id: 'photo-a', embedding: embeddingOf(4, 5, 6), person_id: null },
      { id: 11, photo_id: 'photo-b', embedding: embeddingOf(7, 8, 9), person_id: 1 }, // already clustered
    ];

    const data = await getClusterData(makeEnv(db), true);

    expect(data.clusters).toEqual([{ id: 1, centroidEmbedding: [1, 2, 3], faceCount: 2 }]);
    expect(data.faces).toEqual([{ id: 10, photoId: 'photo-a', embedding: [4, 5, 6] }]);
  });

  it('skips fetching faces entirely when includeFaces is false', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [{ id: 1, centroid_embedding: embeddingOf(1, 2, 3), face_count: 2 }];
    db.faces = [{ id: 10, photo_id: 'photo-a', embedding: embeddingOf(4, 5, 6), person_id: null }];

    const data = await getClusterData(makeEnv(db), false);

    expect(data.clusters).toHaveLength(1);
    expect(data.faces).toEqual([]);
  });

  it('returns empty arrays for an empty library', async () => {
    const db = new FakeFaceClusteringDb();
    const data = await getClusterData(makeEnv(db), true);
    expect(data).toEqual({ faces: [], clusters: [] });
  });
});

describe('applyClusteringResults', () => {
  it('creates a brand-new cluster (clusterId: null) and assigns its faces', async () => {
    const db = new FakeFaceClusteringDb();
    db.faces = [
      { id: 100, photo_id: 'photo-x', embedding: embeddingOf(1, 1, 1), person_id: null },
      { id: 101, photo_id: 'photo-y', embedding: embeddingOf(1, 1, 1), person_id: null },
    ];

    const { facesAssigned } = await applyClusteringResults(makeEnv(db), [
      {
        clusterId: null,
        centroidEmbedding: [1, 1, 1],
        faceCount: 2,
        addedFaceIds: [100, 101],
        coverPhotoId: 'photo-x',
      },
    ]);

    expect(facesAssigned).toBe(2);
    expect(db.clusters).toHaveLength(1);
    expect(db.faces.every((f) => f.person_id === db.clusters[0].id)).toBe(true);
  });

  it("updates an existing cluster's centroid/face_count and assigns its newly-added faces", async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [{ id: 5, centroid_embedding: embeddingOf(0, 0, 0), face_count: 3 }];
    db.faces = [{ id: 200, photo_id: 'photo-z', embedding: embeddingOf(2, 2, 2), person_id: null }];

    await applyClusteringResults(makeEnv(db), [
      { clusterId: 5, centroidEmbedding: [0.5, 0.5, 0.5], faceCount: 4, addedFaceIds: [200] },
    ]);

    expect(db.clusters[0].face_count).toBe(4);
    expect(Array.from(new Float32Array(db.clusters[0].centroid_embedding))).toEqual([0.5, 0.5, 0.5]);
    expect(db.faces[0].person_id).toBe(5);
  });

  it('chunks large addedFaceIds lists to stay under D1 bound-parameter limits', async () => {
    const db = new FakeFaceClusteringDb();
    const faceIds = Array.from({ length: 250 }, (_, i) => 1000 + i);
    db.faces = faceIds.map((id) => ({ id, photo_id: `photo-${id}`, embedding: embeddingOf(1, 1, 1), person_id: null }));

    const { facesAssigned } = await applyClusteringResults(makeEnv(db), [
      { clusterId: null, centroidEmbedding: [1, 1, 1], faceCount: 250, addedFaceIds: faceIds, coverPhotoId: 'photo-1000' },
    ]);

    expect(facesAssigned).toBe(250);
    expect(db.faces.every((f) => f.person_id !== null)).toBe(true);
  });

  it('handles multiple results (mix of new and existing clusters) in one call', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [{ id: 1, centroid_embedding: embeddingOf(9, 9, 9), face_count: 1 }];
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embeddingOf(9, 9, 9), person_id: null },
      { id: 2, photo_id: 'photo-b', embedding: embeddingOf(50, 50, 50), person_id: null },
    ];

    await applyClusteringResults(makeEnv(db), [
      { clusterId: 1, centroidEmbedding: [9, 9, 9], faceCount: 2, addedFaceIds: [1] },
      { clusterId: null, centroidEmbedding: [50, 50, 50], faceCount: 1, addedFaceIds: [2], coverPhotoId: 'photo-b' },
    ]);

    expect(db.clusters).toHaveLength(2);
    expect(db.faces.find((f) => f.id === 1)?.person_id).toBe(1);
    expect(db.faces.find((f) => f.id === 2)?.person_id).toBe(db.clusters[1].id);
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
    db.faces = [{ id: 1, photo_id: 'photo-a', embedding: embeddingOf(1, 1, 1), person_id: 1 }];
    expect(await countUnclusteredFaces(makeEnv(db))).toBe(0);
  });
});
