import { describe, expect, it } from 'vitest';
import { getClusterData, applyClusteringResults, countUnclusteredFaces, getLegacyFaceStats, resetLegacyFaces, blobToFloat32Array, mergeClusters, assignPhotosToPerson, resetAllClusters } from '../faceClustering';
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
  name?: string | null;
  linked_user_email?: string | null;
}

class FakeFaceClusteringDb {
  faces: FaceRow[] = [];
  clusters: ClusterRow[] = [];
  photos: { id: string; faces_processed_at: string | null }[] = [];
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
        if (query.includes('SELECT id, centroid_embedding, face_count, name, linked_user_email FROM person_clusters WHERE id IN')) {
          const ids = boundArgs as number[];
          const results = db.clusters
            .filter((c) => ids.includes(c.id))
            .map((c) => ({ id: c.id, centroid_embedding: c.centroid_embedding, face_count: c.face_count, name: c.name ?? null, linked_user_email: c.linked_user_email ?? null }));
          return { results: results as T[] };
        }
        if (query.includes('SELECT id, embedding, person_id FROM photo_faces WHERE photo_id IN')) {
          const photoIds = boundArgs as string[];
          const results = db.faces
            .filter((f) => photoIds.includes(f.photo_id))
            .map((f) => ({ id: f.id, embedding: f.embedding, person_id: f.person_id }));
          return { results: results as T[] };
        }
        if (query.includes('SELECT id, centroid_embedding FROM person_clusters WHERE LENGTH(centroid_embedding)')) {
          const [expectedBytes] = boundArgs as [number];
          const results = db.clusters
            .filter((c) => c.centroid_embedding.byteLength === expectedBytes)
            .map((c) => ({ id: c.id, centroid_embedding: c.centroid_embedding }));
          return { results: results as T[] };
        }
        if (query.includes('SELECT id FROM person_clusters WHERE LENGTH(centroid_embedding)')) {
          const [expectedBytes] = boundArgs as [number];
          const results = db.clusters
            .filter((c) => c.centroid_embedding.byteLength !== expectedBytes)
            .map((c) => ({ id: c.id }));
          return { results: results as T[] };
        }
        if (query.includes('SELECT DISTINCT photo_id FROM photo_faces WHERE LENGTH(embedding)')) {
          const [expectedBytes] = boundArgs as [number];
          const photoIds = [...new Set(db.faces.filter((f) => f.embedding.byteLength !== expectedBytes).map((f) => f.photo_id))];
          return { results: photoIds.map((photo_id) => ({ photo_id })) as T[] };
        }
        if (query.includes('FROM person_clusters') && query.includes('WHERE id > ?')) {
          const [afterId, limit] = boundArgs as [number, number];
          const results = [...db.clusters]
            .sort((a, b) => a.id - b.id)
            .filter((c) => c.id > afterId)
            .slice(0, limit)
            .map((c) => ({ id: c.id, centroid_embedding: c.centroid_embedding, face_count: c.face_count }));
          return { results: results as T[] };
        }
        if (query.includes('FROM person_clusters')) {
          const sorted = [...db.clusters].sort((a, b) => a.id - b.id);
          const results = sorted.map((c) => ({
            id: c.id,
            centroid_embedding: c.centroid_embedding,
            face_count: c.face_count,
          }));
          return { results: results as T[] };
        }
        if (query.includes('FROM photo_faces') && query.includes('WHERE person_id IS NULL AND id > ?')) {
          const [afterId, limit] = boundArgs as [number, number];
          const results = [...db.faces]
            .sort((a, b) => a.id - b.id)
            .filter((f) => f.person_id === null && f.id > afterId)
            .slice(0, limit)
            .map((f) => ({ id: f.id, photo_id: f.photo_id, embedding: f.embedding }));
          return { results: results as T[] };
        }
        if (query.includes('FROM photo_faces') && query.includes('WHERE id > ?') && !query.includes('person_id')) {
          const [afterId, limit] = boundArgs as [number, number];
          const results = [...db.faces]
            .sort((a, b) => a.id - b.id)
            .filter((f) => f.id > afterId)
            .slice(0, limit)
            .map((f) => ({ id: f.id, photo_id: f.photo_id, embedding: f.embedding }));
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
        if (query.includes('SELECT centroid_embedding, face_count, name, linked_user_email FROM person_clusters WHERE id = ?')) {
          const [id] = boundArgs as [number];
          const cluster = db.clusters.find((c) => c.id === id);
          if (!cluster) return null;
          return { centroid_embedding: cluster.centroid_embedding, face_count: cluster.face_count, name: cluster.name ?? null, linked_user_email: cluster.linked_user_email ?? null } as T;
        }
        if (query.includes('SELECT centroid_embedding, face_count FROM person_clusters WHERE id = ?')) {
          const [id] = boundArgs as [number];
          const cluster = db.clusters.find((c) => c.id === id);
          if (!cluster) return null;
          return { centroid_embedding: cluster.centroid_embedding, face_count: cluster.face_count } as T;
        }
        if (query.includes('SELECT face_count FROM person_clusters WHERE id = ?')) {
          const [id] = boundArgs as [number];
          const cluster = db.clusters.find((c) => c.id === id);
          if (!cluster) return null;
          return { face_count: cluster.face_count } as T;
        }
        if (query.includes('SELECT COUNT(*) as count FROM photo_faces WHERE person_id = ?')) {
          const [id] = boundArgs as [number];
          const count = db.faces.filter((f) => f.person_id === id).length;
          return { count } as T;
        }
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
        if (query.includes('SELECT COUNT(*) as count FROM photo_faces WHERE LENGTH(embedding)')) {
          const [expectedBytes] = boundArgs as [number];
          const count = db.faces.filter((f) => f.embedding.byteLength !== expectedBytes).length;
          return { count } as T;
        }
        if (query.includes('SELECT COUNT(*) as count FROM person_clusters WHERE LENGTH(centroid_embedding)')) {
          const [expectedBytes] = boundArgs as [number];
          const count = db.clusters.filter((c) => c.centroid_embedding.byteLength !== expectedBytes).length;
          return { count } as T;
        }
        return null;
      },
      async run() {
        if (query.includes('UPDATE person_clusters SET centroid_embedding') && query.includes('linked_user_email')) {
          const [centroidEmbedding, faceCount, name, linkedUserEmail, id] = boundArgs as [ArrayBuffer, number, string | null, string | null, number];
          const cluster = db.clusters.find((c) => c.id === id);
          if (cluster) {
            cluster.centroid_embedding = centroidEmbedding;
            cluster.face_count = faceCount;
            cluster.name = name;
            cluster.linked_user_email = linkedUserEmail;
          }
        } else if (query.includes('UPDATE person_clusters SET centroid_embedding')) {
          const [centroidEmbedding, faceCount, id] = boundArgs as [ArrayBuffer, number, number];
          const cluster = db.clusters.find((c) => c.id === id);
          if (cluster) {
            cluster.centroid_embedding = centroidEmbedding;
            cluster.face_count = faceCount;
          }
        }
        if (query.includes('UPDATE person_clusters SET face_count = ?') && !query.includes('centroid_embedding')) {
          const [faceCount, id] = boundArgs as [number, number];
          const cluster = db.clusters.find((c) => c.id === id);
          if (cluster) cluster.face_count = faceCount;
        }
        if (query.includes('DELETE FROM person_clusters WHERE id = ?')) {
          const [id] = boundArgs as [number];
          db.clusters = db.clusters.filter((c) => c.id !== id);
        }
        if (query.includes('UPDATE photo_faces SET person_id = ? WHERE id = ?')) {
          const [personId, faceId] = boundArgs as [number, number];
          const face = db.faces.find((f) => f.id === faceId);
          if (face) face.person_id = personId;
        }
        if (query.includes('UPDATE photo_faces SET person_id = ? WHERE id IN')) {
          const [personId, ...faceIds] = boundArgs as [number, ...number[]];
          for (const faceId of faceIds) {
            const face = db.faces.find((f) => f.id === faceId);
            if (face) face.person_id = personId;
          }
        }
        if (query.includes('UPDATE photo_faces SET person_id = ? WHERE person_id IN')) {
          const [newPersonId, ...oldPersonIds] = boundArgs as [number, ...number[]];
          for (const face of db.faces) {
            if (face.person_id !== null && oldPersonIds.includes(face.person_id)) {
              face.person_id = newPersonId;
            }
          }
        }
        if (query.includes('UPDATE photo_faces SET person_id = NULL WHERE person_id IN')) {
          const clusterIds = boundArgs as number[];
          for (const face of db.faces) {
            if (face.person_id !== null && clusterIds.includes(face.person_id)) {
              face.person_id = null;
            }
          }
        }
        if (query.includes('DELETE FROM person_clusters WHERE id IN')) {
          const clusterIds = boundArgs as number[];
          db.clusters = db.clusters.filter((c) => !clusterIds.includes(c.id));
        }
        if (query.includes('DELETE FROM photo_faces WHERE LENGTH(embedding)')) {
          const [expectedBytes] = boundArgs as [number];
          db.faces = db.faces.filter((f) => f.embedding.byteLength === expectedBytes);
        }
        if (query.includes('UPDATE photos SET faces_processed_at = NULL WHERE id IN')) {
          const photoIds = boundArgs as string[];
          for (const photo of db.photos) {
            if (photoIds.includes(photo.id)) photo.faces_processed_at = null;
          }
        }
        if (query.includes('UPDATE photo_faces SET person_id = NULL WHERE person_id IS NOT NULL')) {
          const changed = db.faces.filter((f) => f.person_id !== null).length;
          for (const face of db.faces) face.person_id = null;
          return { success: true, meta: { changes: changed } };
        }
        if (query === 'DELETE FROM person_clusters') {
          const changed = db.clusters.length;
          db.clusters = [];
          return { success: true, meta: { changes: changed } };
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

// applyClusteringResults() now hard-rejects any centroidEmbedding that isn't exactly
// EXPECTED_EMBEDDING_LENGTH (512, the ArcFace ONNX embedding dimension — was 1024 for Human's
// FaceRes descriptor before 2026-08-04) — see faceClustering.ts's top-of-file doc comment for
// the production incident this guards against. Pads a short, easy-to-read list of values out
// to the full 512-length array (zeros for the remainder) so these tests can keep using small,
// readable numbers while still passing the length guard.
function resultCentroidOf(...values: number[]): number[] {
  const padded = new Array(512).fill(0);
  values.forEach((v, i) => { padded[i] = v; });
  return padded;
}

// Same padding idea as resultCentroidOf(), but returning a real 512-float ArrayBuffer BLOB —
// used for mergeClusters()/assignPhotosToPerson() tests, which also require exactly
// EXPECTED_EMBEDDING_LENGTH-shaped stored data.
function embedding1024Of(...values: number[]): ArrayBuffer {
  return new Float32Array(resultCentroidOf(...values)).buffer;
}

describe('blobToFloat32Array', () => {
  it('correctly reinterprets a genuine ArrayBuffer\'s bytes as packed floats (the normal case)', () => {
    const original = new Float32Array([1.5, -2.25, 3.0]);
    const result = blobToFloat32Array(original.buffer);
    expect(Array.from(result)).toEqual([1.5, -2.25, 3.0]);
    expect(result.length).toBe(3);
  });

  it("does NOT corrupt data when D1 hands back a Uint8Array VIEW instead of a raw ArrayBuffer — the exact production incident this guards against", () => {
    // Simulates the confirmed production bug: D1 (or some intermediate layer) returning the
    // BLOB as a Uint8Array view rather than a bare ArrayBuffer. Passing that Uint8Array
    // straight into `new Float32Array(...)` would (per the JS spec) copy each BYTE VALUE
    // (0-255) as its own float element — 4x too many "floats", each a meaningless small
    // integer — instead of correctly reinterpreting every 4 bytes as one packed float.
    const original = new Float32Array([1.5, -2.25, 3.0, 1000.25]);
    const view = new Uint8Array(original.buffer); // a VIEW, not the raw ArrayBuffer itself

    const result = blobToFloat32Array(view);

    expect(result.length).toBe(4); // NOT 16 (4 bytes/float * 4 floats)
    expect(Array.from(result)).toEqual([1.5, -2.25, 3.0, 1000.25]);
  });

  it('correctly handles a Uint8Array view with a nonzero byteOffset into a larger shared buffer', () => {
    const original = new Float32Array([9, 8, 7]);
    // Simulate a view that doesn't start at byte 0 of its underlying buffer (e.g. a Node
    // Buffer slice or a D1 result sharing a larger response buffer).
    const padded = new ArrayBuffer(8 + original.buffer.byteLength);
    new Uint8Array(padded, 8).set(new Uint8Array(original.buffer));
    const offsetView = new Uint8Array(padded, 8, original.buffer.byteLength);

    const result = blobToFloat32Array(offsetView);

    expect(result.length).toBe(3);
    expect(Array.from(result)).toEqual([9, 8, 7]);
  });

  it("does NOT corrupt data when D1 hands back a plain JS Array of raw byte values instead of an ArrayBuffer/view — confirmed live in production via wrangler tail (2026-08-03)", () => {
    // This is the ACTUAL shape D1's binding API was observed returning for BLOB columns in
    // production, beyond the two shapes (ArrayBuffer, ArrayBufferView) this function originally
    // handled — a plain `Array` (`Array.isArray() === true`, NOT `ArrayBuffer.isView()`) of raw
    // byte values (0-255). `new Float32Array(plainArray)` treats a plain array as array-like and
    // copies each element's VALUE as its own float (same behavior as the ArrayBufferView case),
    // producing the exact same 4x-inflated, byte-value corruption if not handled explicitly.
    const original = new Float32Array([1.5, -2.25, 3.0, 1000.25]);
    const plainByteArray = Array.from(new Uint8Array(original.buffer)); // a plain number[], not a typed array

    const result = blobToFloat32Array(plainByteArray);

    expect(result.length).toBe(4); // NOT 16
    expect(Array.from(result)).toEqual([1.5, -2.25, 3.0, 1000.25]);
  });
});

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
    expect(data).toEqual({ faces: [], clusters: [], nextClusterCursor: null, nextFaceCursor: null });
  });

  it('correctly converts embeddings end-to-end even when D1 hands back a plain Array instead of an ArrayBuffer (the confirmed production shape)', async () => {
    const db = new FakeFaceClusteringDb();
    const realEmbedding = new Float32Array([1.5, -2.25, 3.0]);
    const asPlainByteArray = Array.from(new Uint8Array(realEmbedding.buffer));
    db.faces = [
      { id: 10, photo_id: 'photo-a', embedding: asPlainByteArray as unknown as ArrayBuffer, person_id: null },
    ];

    const data = await getClusterData(makeEnv(db), true);

    expect(data.faces).toEqual([{ id: 10, photoId: 'photo-a', embedding: [1.5, -2.25, 3.0] }]);
  });

  it('paginates clusters/faces via afterClusterId/afterFaceId, returning null cursors once fully consumed', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [
      { id: 1, centroid_embedding: embeddingOf(1, 1, 1), face_count: 1 },
      { id: 2, centroid_embedding: embeddingOf(2, 2, 2), face_count: 1 },
    ];
    db.faces = [
      { id: 10, photo_id: 'photo-a', embedding: embeddingOf(1, 1, 1), person_id: null },
      { id: 11, photo_id: 'photo-b', embedding: embeddingOf(2, 2, 2), person_id: null },
    ];

    // First page starts from the defaults (0, 0) — returns everything since PAGE_SIZE (300)
    // comfortably covers this tiny test dataset, so both cursors should already be null.
    const firstPage = await getClusterData(makeEnv(db), true, 0, 0);
    expect(firstPage.clusters.map((c) => c.id)).toEqual([1, 2]);
    expect(firstPage.faces.map((f) => f.id)).toEqual([10, 11]);
    expect(firstPage.nextClusterCursor).toBeNull();
    expect(firstPage.nextFaceCursor).toBeNull();

    // Resuming from a cursor should only return rows strictly AFTER it.
    const resumed = await getClusterData(makeEnv(db), true, 1, 10);
    expect(resumed.clusters.map((c) => c.id)).toEqual([2]);
    expect(resumed.faces.map((f) => f.id)).toEqual([11]);
  });

  it('returns EVERY face regardless of person_id when unclusteredOnly is false (deep-rebuild mode)', async () => {
    const db = new FakeFaceClusteringDb();
    db.faces = [
      { id: 10, photo_id: 'photo-a', embedding: embeddingOf(1, 1, 1), person_id: null },
      { id: 11, photo_id: 'photo-b', embedding: embeddingOf(2, 2, 2), person_id: 5 }, // already clustered
    ];

    const data = await getClusterData(makeEnv(db), true, 0, 0, false);

    expect(data.faces.map((f) => f.id)).toEqual([10, 11]);
  });
});

describe('resetAllClusters', () => {
  it('unassigns every face and deletes every cluster, returning the counts, without touching raw embeddings', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [
      { id: 1, centroid_embedding: embeddingOf(1, 1, 1), face_count: 2 },
      { id: 2, centroid_embedding: embeddingOf(2, 2, 2), face_count: 1 },
    ];
    db.faces = [
      { id: 10, photo_id: 'photo-a', embedding: embeddingOf(1, 1, 1), person_id: 1 },
      { id: 11, photo_id: 'photo-b', embedding: embeddingOf(1, 1, 1), person_id: 1 },
      { id: 12, photo_id: 'photo-c', embedding: embeddingOf(2, 2, 2), person_id: 2 },
      { id: 13, photo_id: 'photo-d', embedding: embeddingOf(3, 3, 3), person_id: null },
    ];

    const result = await resetAllClusters(makeEnv(db));

    expect(result).toEqual({ facesUnassigned: 3, clustersDeleted: 2 });
    expect(db.clusters).toEqual([]);
    expect(db.faces.every((f) => f.person_id === null)).toBe(true);
    // Raw embeddings themselves are untouched.
    expect(db.faces.map((f) => f.embedding)).toEqual([
      embeddingOf(1, 1, 1),
      embeddingOf(1, 1, 1),
      embeddingOf(2, 2, 2),
      embeddingOf(3, 3, 3),
    ]);
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
        centroidEmbedding: resultCentroidOf(1, 1, 1),
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
      { clusterId: 5, centroidEmbedding: resultCentroidOf(0.5, 0.5, 0.5), faceCount: 4, addedFaceIds: [200] },
    ]);

    expect(db.clusters[0].face_count).toBe(4);
    expect(Array.from(new Float32Array(db.clusters[0].centroid_embedding)).slice(0, 3)).toEqual([0.5, 0.5, 0.5]);
    expect(db.faces[0].person_id).toBe(5);
  });

  it('chunks large addedFaceIds lists to stay under D1 bound-parameter limits', async () => {
    const db = new FakeFaceClusteringDb();
    const faceIds = Array.from({ length: 250 }, (_, i) => 1000 + i);
    db.faces = faceIds.map((id) => ({ id, photo_id: `photo-${id}`, embedding: embeddingOf(1, 1, 1), person_id: null }));

    const { facesAssigned } = await applyClusteringResults(makeEnv(db), [
      { clusterId: null, centroidEmbedding: resultCentroidOf(1, 1, 1), faceCount: 250, addedFaceIds: faceIds, coverPhotoId: 'photo-1000' },
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
      { clusterId: 1, centroidEmbedding: resultCentroidOf(9, 9, 9), faceCount: 2, addedFaceIds: [1] },
      { clusterId: null, centroidEmbedding: resultCentroidOf(50, 50, 50), faceCount: 1, addedFaceIds: [2], coverPhotoId: 'photo-b' },
    ]);

    expect(db.clusters).toHaveLength(2);
    expect(db.faces.find((f) => f.id === 1)?.person_id).toBe(1);
    expect(db.faces.find((f) => f.id === 2)?.person_id).toBe(db.clusters[1].id);
  });

  it('rejects (never writes) a result whose centroidEmbedding is not exactly 1024 numbers, and reports it as rejected', async () => {
    const db = new FakeFaceClusteringDb();
    db.faces = [{ id: 1, photo_id: 'photo-a', embedding: embeddingOf(1, 1, 1), person_id: null }];

    const { facesAssigned, rejected } = await applyClusteringResults(makeEnv(db), [
      // Malformed: only 3 numbers instead of 1024 — e.g. what a corrupted read-side bug (see
      // this file's top-of-file doc comment) could produce.
      { clusterId: null, centroidEmbedding: [1, 1, 1], faceCount: 1, addedFaceIds: [1], coverPhotoId: 'photo-a' },
    ]);

    expect(rejected).toBe(1);
    expect(facesAssigned).toBe(0);
    expect(db.clusters).toHaveLength(0);
    expect(db.faces[0].person_id).toBeNull();
  });

  it('still applies well-formed results in the same batch as a rejected malformed one', async () => {
    const db = new FakeFaceClusteringDb();
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embeddingOf(1, 1, 1), person_id: null },
      { id: 2, photo_id: 'photo-b', embedding: embeddingOf(2, 2, 2), person_id: null },
    ];

    const { facesAssigned, rejected } = await applyClusteringResults(makeEnv(db), [
      { clusterId: null, centroidEmbedding: [1, 1, 1], faceCount: 1, addedFaceIds: [1], coverPhotoId: 'photo-a' }, // malformed
      { clusterId: null, centroidEmbedding: resultCentroidOf(2, 2, 2), faceCount: 1, addedFaceIds: [2], coverPhotoId: 'photo-b' }, // well-formed
    ]);

    expect(rejected).toBe(1);
    expect(facesAssigned).toBe(1);
    expect(db.clusters).toHaveLength(1);
    expect(db.faces.find((f) => f.id === 2)?.person_id).toBe(db.clusters[0].id);
    expect(db.faces.find((f) => f.id === 1)?.person_id).toBeNull();
  });
});

describe('mergeClusters', () => {
  it("recomputes the target's centroid as a face_count-weighted average of target + sources (the \"learn from merge\" behavior)", async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [
      { id: 1, centroid_embedding: embedding1024Of(0, 0, 0), face_count: 1 }, // target
      { id: 2, centroid_embedding: embedding1024Of(10, 0, 0), face_count: 3 }, // source
    ];
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embedding1024Of(0, 0, 0), person_id: 1 },
      { id: 2, photo_id: 'photo-b', embedding: embedding1024Of(10, 0, 0), person_id: 2 },
      { id: 3, photo_id: 'photo-c', embedding: embedding1024Of(10, 0, 0), person_id: 2 },
      { id: 4, photo_id: 'photo-d', embedding: embedding1024Of(10, 0, 0), person_id: 2 },
    ];

    const { facesMoved } = await mergeClusters(makeEnv(db), 1, [2]);

    expect(facesMoved).toBe(4);
    expect(db.clusters).toHaveLength(1);
    expect(db.clusters[0].face_count).toBe(4);
    // Weighted average: (0*1 + 10*3) / 4 = 7.5, NOT a naive unweighted average of the two
    // centroids (which would incorrectly give 5).
    expect(Array.from(blobToFloat32Array(db.clusters[0].centroid_embedding))[0]).toBeCloseTo(7.5, 5);
    expect(db.faces.every((f) => f.person_id === 1)).toBe(true);
  });

  it('merges multiple source clusters into one target in a single call', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [
      { id: 1, centroid_embedding: embedding1024Of(0, 0, 0), face_count: 2 },
      { id: 2, centroid_embedding: embedding1024Of(10, 0, 0), face_count: 1 },
      { id: 3, centroid_embedding: embedding1024Of(20, 0, 0), face_count: 1 },
    ];
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embedding1024Of(0, 0, 0), person_id: 1 },
      { id: 2, photo_id: 'photo-b', embedding: embedding1024Of(0, 0, 0), person_id: 1 },
      { id: 3, photo_id: 'photo-c', embedding: embedding1024Of(10, 0, 0), person_id: 2 },
      { id: 4, photo_id: 'photo-d', embedding: embedding1024Of(20, 0, 0), person_id: 3 },
    ];

    const { facesMoved } = await mergeClusters(makeEnv(db), 1, [2, 3]);

    expect(facesMoved).toBe(4);
    expect(db.clusters).toHaveLength(1);
    // (0*2 + 10*1 + 20*1) / 4 = 7.5
    expect(Array.from(blobToFloat32Array(db.clusters[0].centroid_embedding))[0]).toBeCloseTo(7.5, 5);
  });

  it('is a no-op when sourcePersonIds only contains the target itself', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [{ id: 1, centroid_embedding: embedding1024Of(0, 0, 0), face_count: 1 }];

    const { facesMoved } = await mergeClusters(makeEnv(db), 1, [1]);

    expect(facesMoved).toBe(0);
    expect(db.clusters).toHaveLength(1);
  });

  it('excludes a malformed-centroid source from the weighted-average math, but still moves its faces', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [
      { id: 1, centroid_embedding: embedding1024Of(0, 0, 0), face_count: 1 },
      { id: 2, centroid_embedding: embeddingOf(1, 1, 1), face_count: 1 }, // malformed — only 3 floats
    ];
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embedding1024Of(0, 0, 0), person_id: 1 },
      { id: 2, photo_id: 'photo-b', embedding: embedding1024Of(1, 1, 1), person_id: 2 },
    ];

    const { facesMoved } = await mergeClusters(makeEnv(db), 1, [2]);

    expect(facesMoved).toBe(2);
    // Centroid stays exactly the target's original value since the malformed source was
    // excluded from the average entirely (not zeroed/garbage-averaged in).
    expect(Array.from(blobToFloat32Array(db.clusters[0].centroid_embedding))[0]).toBeCloseTo(0, 5);
  });

  it('keeps the target\'s existing name/linked account when it already has one, even if a source also has one set', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [
      { id: 1, centroid_embedding: embedding1024Of(0, 0, 0), face_count: 1, name: 'Alice', linked_user_email: 'alice@example.com' },
      { id: 2, centroid_embedding: embedding1024Of(10, 0, 0), face_count: 1, name: 'Bob', linked_user_email: 'bob@example.com' },
    ];
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embedding1024Of(0, 0, 0), person_id: 1 },
      { id: 2, photo_id: 'photo-b', embedding: embedding1024Of(10, 0, 0), person_id: 2 },
    ];

    await mergeClusters(makeEnv(db), 1, [2]);

    expect(db.clusters[0].name).toBe('Alice');
    expect(db.clusters[0].linked_user_email).toBe('alice@example.com');
  });

  it("fills in the target's name/linked account from a source when the target (e.g. an \"Unnamed\" duplicate) doesn't have one", async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [
      { id: 1, centroid_embedding: embedding1024Of(0, 0, 0), face_count: 1, name: null, linked_user_email: null },
      { id: 2, centroid_embedding: embedding1024Of(10, 0, 0), face_count: 1, name: 'Bob', linked_user_email: 'bob@example.com' },
    ];
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embedding1024Of(0, 0, 0), person_id: 1 },
      { id: 2, photo_id: 'photo-b', embedding: embedding1024Of(10, 0, 0), person_id: 2 },
    ];

    await mergeClusters(makeEnv(db), 1, [2]);

    expect(db.clusters[0].name).toBe('Bob');
    expect(db.clusters[0].linked_user_email).toBe('bob@example.com');
  });

  it('leaves name/linked account null when merging two unnamed clusters', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [
      { id: 1, centroid_embedding: embedding1024Of(0, 0, 0), face_count: 1, name: null, linked_user_email: null },
      { id: 2, centroid_embedding: embedding1024Of(10, 0, 0), face_count: 1, name: null, linked_user_email: null },
    ];
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embedding1024Of(0, 0, 0), person_id: 1 },
      { id: 2, photo_id: 'photo-b', embedding: embedding1024Of(10, 0, 0), person_id: 2 },
    ];

    await mergeClusters(makeEnv(db), 1, [2]);

    expect(db.clusters[0].name).toBeNull();
    expect(db.clusters[0].linked_user_email).toBeNull();
  });
});

describe('assignPhotosToPerson', () => {
  it("assigns an unclustered photo's face to a person and incorporates its embedding into the centroid (\"learn from that\")", async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [{ id: 1, centroid_embedding: embedding1024Of(0, 0, 0), face_count: 1 }];
    db.faces = [
      { id: 1, photo_id: 'photo-existing', embedding: embedding1024Of(0, 0, 0), person_id: 1 },
      { id: 2, photo_id: 'photo-new', embedding: embedding1024Of(3, 0, 0), person_id: null },
    ];

    const { assigned, skipped } = await assignPhotosToPerson(makeEnv(db), 1, ['photo-new']);

    expect(assigned).toBe(1);
    expect(skipped).toBe(0);
    expect(db.faces.find((f) => f.id === 2)?.person_id).toBe(1);
    expect(db.clusters[0].face_count).toBe(2);
    // Capped drift formula: weight = 1/min(2,30) = 0.5 -> centroid[0] = 0 + (3-0)*0.5 = 1.5.
    expect(Array.from(blobToFloat32Array(db.clusters[0].centroid_embedding))[0]).toBeCloseTo(1.5, 5);
  });

  it('moves a face away from its OLD cluster (decrementing face_count) when reassigning to a different person', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [
      { id: 1, centroid_embedding: embedding1024Of(0, 0, 0), face_count: 1 },
      { id: 2, centroid_embedding: embedding1024Of(5, 0, 0), face_count: 2 },
    ];
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embedding1024Of(0, 0, 0), person_id: 1 },
      { id: 2, photo_id: 'photo-b', embedding: embedding1024Of(5, 0, 0), person_id: 2 }, // misclustered under person 2
      { id: 3, photo_id: 'photo-c', embedding: embedding1024Of(5, 0, 0), person_id: 2 },
    ];

    const { assigned } = await assignPhotosToPerson(makeEnv(db), 1, ['photo-b']);

    expect(assigned).toBe(1);
    expect(db.faces.find((f) => f.id === 2)?.person_id).toBe(1);
    // Old cluster (person 2) shrinks from 2 to 1, but is NOT deleted (still has 1 member left).
    expect(db.clusters.find((c) => c.id === 2)?.face_count).toBe(1);
  });

  it('deletes the OLD cluster entirely once its last face is reassigned away', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [
      { id: 1, centroid_embedding: embedding1024Of(0, 0, 0), face_count: 1 },
      { id: 2, centroid_embedding: embedding1024Of(5, 0, 0), face_count: 1 },
    ];
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embedding1024Of(0, 0, 0), person_id: 1 },
      { id: 2, photo_id: 'photo-b', embedding: embedding1024Of(5, 0, 0), person_id: 2 },
    ];

    await assignPhotosToPerson(makeEnv(db), 1, ['photo-b']);

    expect(db.clusters.find((c) => c.id === 2)).toBeUndefined();
    expect(db.clusters).toHaveLength(1);
  });

  it('skips a face already belonging to the target person (no-op, not double-counted)', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [{ id: 1, centroid_embedding: embedding1024Of(0, 0, 0), face_count: 1 }];
    db.faces = [{ id: 1, photo_id: 'photo-a', embedding: embedding1024Of(0, 0, 0), person_id: 1 }];

    const { assigned, skipped } = await assignPhotosToPerson(makeEnv(db), 1, ['photo-a']);

    expect(assigned).toBe(0);
    expect(skipped).toBe(1);
    expect(db.clusters[0].face_count).toBe(1);
  });

  it('assigns every face on a multi-face photo, not just the first', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [{ id: 1, centroid_embedding: embedding1024Of(0, 0, 0), face_count: 1 }];
    db.faces = [
      { id: 1, photo_id: 'photo-existing', embedding: embedding1024Of(0, 0, 0), person_id: 1 },
      { id: 2, photo_id: 'photo-group', embedding: embedding1024Of(1, 0, 0), person_id: null },
      { id: 3, photo_id: 'photo-group', embedding: embedding1024Of(2, 0, 0), person_id: null },
    ];

    const { assigned } = await assignPhotosToPerson(makeEnv(db), 1, ['photo-group']);

    expect(assigned).toBe(2);
    expect(db.faces.find((f) => f.id === 2)?.person_id).toBe(1);
    expect(db.faces.find((f) => f.id === 3)?.person_id).toBe(1);
    expect(db.clusters[0].face_count).toBe(3);
  });

  it('skips a face with a malformed embedding length instead of corrupting the centroid', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [{ id: 1, centroid_embedding: embedding1024Of(0, 0, 0), face_count: 1 }];
    db.faces = [
      { id: 1, photo_id: 'photo-existing', embedding: embedding1024Of(0, 0, 0), person_id: 1 },
      { id: 2, photo_id: 'photo-bad', embedding: embeddingOf(1, 1, 1), person_id: null }, // malformed
    ];

    const { assigned, skipped } = await assignPhotosToPerson(makeEnv(db), 1, ['photo-bad']);

    expect(assigned).toBe(0);
    expect(skipped).toBe(1);
    expect(db.faces.find((f) => f.id === 2)?.person_id).toBeNull();
  });

  it('throws if the target person does not exist', async () => {
    const db = new FakeFaceClusteringDb();
    db.faces = [{ id: 1, photo_id: 'photo-a', embedding: embedding1024Of(0, 0, 0), person_id: null }];

    await expect(assignPhotosToPerson(makeEnv(db), 999, ['photo-a'])).rejects.toThrow();
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

// A legacy (pre-2026-08 face-api.js) embedding is 128 floats = 512 bytes, vs the current
// @vladmandic/human 1024-float/4096-byte format — see EXPECTED_EMBEDDING_BYTES's doc comment.
function legacyEmbedding(): ArrayBuffer {
  return new Float32Array(128).buffer;
}

describe('getLegacyFaceStats', () => {
  it('counts legacy-dimension faces and clusters separately', async () => {
    const db = new FakeFaceClusteringDb();
    db.faces = [
      { id: 1, photo_id: 'photo-a', embedding: embeddingOf(...Array(512).fill(0)), person_id: null },
      { id: 2, photo_id: 'photo-b', embedding: legacyEmbedding(), person_id: null },
    ];
    db.clusters = [
      { id: 1, centroid_embedding: embeddingOf(...Array(512).fill(0)), face_count: 1 },
      { id: 2, centroid_embedding: legacyEmbedding(), face_count: 1 },
    ];

    const stats = await getLegacyFaceStats(makeEnv(db));

    expect(stats).toEqual({ legacyFaces: 1, legacyClusters: 1, corruptedClusters: 0 });
  });

  it('returns all zeros for a fully up-to-date library', async () => {
    const db = new FakeFaceClusteringDb();
    db.faces = [{ id: 1, photo_id: 'photo-a', embedding: embeddingOf(...Array(512).fill(0)), person_id: null }];
    db.clusters = [{ id: 1, centroid_embedding: embeddingOf(...Array(512).fill(0)), face_count: 1 }];

    expect(await getLegacyFaceStats(makeEnv(db))).toEqual({ legacyFaces: 0, legacyClusters: 0, corruptedClusters: 0 });
  });

  it('separately counts clusters whose centroid is the CORRECT byte length but contains NaN (corrupted by a past truncated-comparison merge)', async () => {
    const db = new FakeFaceClusteringDb();
    const corrupted = new Float32Array(512).fill(0);
    corrupted[300] = NaN; // simulates the dimension-mismatch-update bug described in faceClustering.ts
    db.clusters = [
      { id: 1, centroid_embedding: embeddingOf(...Array(512).fill(0)), face_count: 1 }, // healthy
      { id: 2, centroid_embedding: corrupted.buffer, face_count: 3 }, // corrupted, but right length
    ];

    const stats = await getLegacyFaceStats(makeEnv(db));

    expect(stats).toEqual({ legacyFaces: 0, legacyClusters: 0, corruptedClusters: 1 });
  });
});

describe('resetLegacyFaces', () => {
  it('deletes legacy faces, unassigns/removes legacy clusters, and re-queues affected photos', async () => {
    const db = new FakeFaceClusteringDb();
    db.photos = [
      { id: 'photo-legacy', faces_processed_at: '2026-01-01' },
      { id: 'photo-current', faces_processed_at: '2026-08-01' },
    ];
    db.clusters = [
      { id: 1, centroid_embedding: legacyEmbedding(), face_count: 2 }, // legacy cluster
      { id: 2, centroid_embedding: embeddingOf(...Array(512).fill(0)), face_count: 1 }, // current cluster
    ];
    db.faces = [
      { id: 1, photo_id: 'photo-legacy', embedding: legacyEmbedding(), person_id: 1 },
      // A current-model face that was incorrectly truncated-matched into the legacy cluster.
      { id: 2, photo_id: 'photo-current', embedding: embeddingOf(...Array(512).fill(0)), person_id: 1 },
      { id: 3, photo_id: 'photo-current', embedding: embeddingOf(...Array(512).fill(0)), person_id: 2 },
    ];

    const result = await resetLegacyFaces(makeEnv(db));

    expect(result).toEqual({ facesReset: 1, clustersRemoved: 1 });
    // Legacy cluster gone; current cluster untouched.
    expect(db.clusters.map((c) => c.id)).toEqual([2]);
    // Legacy face row deleted entirely.
    expect(db.faces.find((f) => f.id === 1)).toBeUndefined();
    // The current-model face that had been in the legacy cluster is unassigned, not deleted.
    expect(db.faces.find((f) => f.id === 2)?.person_id).toBeNull();
    // The face already correctly in the current cluster is untouched.
    expect(db.faces.find((f) => f.id === 3)?.person_id).toBe(2);
    // Only the photo that had a legacy face gets re-queued for backfill.
    expect(db.photos.find((p) => p.id === 'photo-legacy')?.faces_processed_at).toBeNull();
    expect(db.photos.find((p) => p.id === 'photo-current')?.faces_processed_at).toBe('2026-08-01');
  });

  it('is a no-op on an already-clean library', async () => {
    const db = new FakeFaceClusteringDb();
    db.clusters = [{ id: 1, centroid_embedding: embeddingOf(...Array(512).fill(0)), face_count: 1 }];
    db.faces = [{ id: 1, photo_id: 'photo-a', embedding: embeddingOf(...Array(512).fill(0)), person_id: 1 }];

    const result = await resetLegacyFaces(makeEnv(db));

    expect(result).toEqual({ facesReset: 0, clustersRemoved: 0 });
    expect(db.clusters).toHaveLength(1);
    expect(db.faces).toHaveLength(1);
  });

  it('also cleans up a NaN-corrupted cluster (correct byte length, but a bad float from a past truncated-comparison merge), unassigning ALL its member faces', async () => {
    const db = new FakeFaceClusteringDb();
    const corrupted = new Float32Array(512).fill(0);
    corrupted[400] = NaN;
    db.photos = [{ id: 'photo-current', faces_processed_at: '2026-08-01' }];
    db.clusters = [
      { id: 1, centroid_embedding: embeddingOf(...Array(512).fill(0)), face_count: 1 }, // healthy, untouched
      { id: 2, centroid_embedding: corrupted.buffer, face_count: 2 }, // corrupted
    ];
    db.faces = [
      { id: 1, photo_id: 'photo-current', embedding: embeddingOf(...Array(512).fill(0)), person_id: 1 },
      // Both members of the corrupted cluster are perfectly valid-dimension faces — only the
      // cluster's grouping/centroid is untrustworthy, so both get unassigned (not deleted).
      { id: 2, photo_id: 'photo-current', embedding: embeddingOf(...Array(512).fill(1)), person_id: 2 },
      { id: 3, photo_id: 'photo-current', embedding: embeddingOf(...Array(512).fill(2)), person_id: 2 },
    ];

    const result = await resetLegacyFaces(makeEnv(db));

    expect(result).toEqual({ facesReset: 0, clustersRemoved: 1 });
    expect(db.clusters.map((c) => c.id)).toEqual([1]);
    expect(db.faces.find((f) => f.id === 1)?.person_id).toBe(1); // untouched
    expect(db.faces.find((f) => f.id === 2)?.person_id).toBeNull();
    expect(db.faces.find((f) => f.id === 3)?.person_id).toBeNull();
    // No embedding rows were the wrong byte length, so no photo needs re-scanning.
    expect(db.photos.find((p) => p.id === 'photo-current')?.faces_processed_at).toBe('2026-08-01');
  });
});
