import type { Env } from './types';
import { EXPECTED_EMBEDDING_LENGTH } from './faceValidation';

/**
 * People/face clustering — the actual vector-similarity math (comparing face descriptors to
 * find matches) runs ENTIRELY CLIENT-SIDE in the admin's browser (see
 * apps/web/src/faceClusteringClient.ts), not in this Worker.
 *
 * HISTORY / WHY: this used to run server-side here, guarded by increasingly elaborate CPU-time
 * budgets (adaptive batch sizes, candidate-cluster caps, wall-clock guards, deterministic
 * dimension-operation budgets, early-exit optimizations...). Every one of those attempts still
 * eventually 503'd with Cloudflare's `Error 1102: Worker exceeded resource limits` once the
 * library grew large enough (the Workers Free plan hard-caps CPU time at just 10ms per request/
 * cron trigger — see developers.cloudflare.com/workers/platform/limits/), because there is no
 * batch size small enough to both (a) make real progress and (b) never risk exceeding 10ms of
 * REAL CPU time for an operation whose cost scales with however large the library has grown.
 * A phone/laptop browser has no such limit, and this is admin-only tooling (not per-visitor
 * page-load code), so the fix is architectural, not another tuning pass: this Worker now only
 * ever does cheap I/O (SELECT/UPDATE/INSERT), never the O(n) or O(n²) vector math itself.
 *
 * This file now only contains:
 *  - Pure I/O helpers to fetch the raw data the client needs (getClusterData) and to persist
 *    the client's already-computed results (applyClusteringResults).
 *  - countUnclusteredFaces(), a trivial COUNT(*) used by the People page for progress display.
 *
 * The distance/similarity formula itself (ported from vladmandic/human's src/face/match.ts) is
 * now duplicated in faceClusteringClient.ts on the web side, since these are two separate npm
 * packages (apps/worker and apps/web) with no shared-code build step in this repo — see that
 * file's own doc comment for the exact same math + rationale as this file used to have.
 */

/** Raw data needed to run one full clustering pass — see faceClusteringClient.ts. */
export interface ClusterDataFace {
  id: number;
  photoId: string;
  embedding: number[];
}

export interface ClusterDataCluster {
  id: number;
  centroidEmbedding: number[];
  faceCount: number;
}

export interface ClusterData {
  faces: ClusterDataFace[];
  clusters: ClusterDataCluster[];
}

/**
 * Fetches ALL currently-unclustered faces and ALL existing person clusters in one go — pure I/O,
 * no vector math, so this is cheap regardless of how large the library has grown (D1
 * reads/writes don't count against Workers' CPU-time limit, only actual JS computation does).
 * `includeFaces=false` skips the (potentially large) unclustered-faces array entirely for
 * callers that only need cluster centroids (e.g. the merge-suggestions scan, which never reads
 * photo_faces at all).
 */
export async function getClusterData(env: Env, includeFaces: boolean): Promise<ClusterData> {
  const { results: clusterRows } = await env.DB
    .prepare('SELECT id, centroid_embedding, face_count FROM person_clusters ORDER BY id ASC')
    .all<{ id: number; centroid_embedding: ArrayBuffer; face_count: number }>();

  const clusters: ClusterDataCluster[] = (clusterRows || []).map((c) => ({
    id: c.id,
    centroidEmbedding: Array.from(new Float32Array(c.centroid_embedding)),
    faceCount: c.face_count,
  }));

  if (!includeFaces) {
    return { faces: [], clusters };
  }

  const { results: faceRows } = await env.DB
    .prepare(`
      SELECT id, photo_id, embedding
      FROM photo_faces
      WHERE person_id IS NULL
      ORDER BY created_at ASC
    `)
    .all<{ id: number; photo_id: string; embedding: ArrayBuffer }>();

  const faces: ClusterDataFace[] = (faceRows || []).map((f) => ({
    id: f.id,
    photoId: f.photo_id,
    embedding: Array.from(new Float32Array(f.embedding)),
  }));

  return { faces, clusters };
}

/** One cluster's final state after the client's greedy-clustering pass, ready to persist. */
export interface ClusterResult {
  /** null = brand-new cluster (never existed before this pass); otherwise an existing cluster id. */
  clusterId: number | null;
  centroidEmbedding: number[];
  faceCount: number;
  /** photo_faces.id values to assign to this cluster (only the NEWLY assigned ones this pass). */
  addedFaceIds: number[];
  /** Required (and only used) when clusterId is null — becomes the new cluster's cover photo. */
  coverPhotoId?: string;
}

// D1 (SQLite) has a bound-parameter-count limit per statement; chunk large face-id lists the
// same way photoDeletion.ts already does for DELETE statements, to stay well under it.
const FACE_ID_CHUNK_SIZE = 90;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Persists the client's already-computed clustering results — pure I/O (INSERT/UPDATE), no
 * vector math. See ClusterResult above for the shape the client sends.
 */
export async function applyClusteringResults(env: Env, results: ClusterResult[]): Promise<{ facesAssigned: number }> {
  let facesAssigned = 0;

  for (const result of results) {
    let clusterId = result.clusterId;

    if (clusterId === null) {
      const inserted = await env.DB
        .prepare('INSERT INTO person_clusters (centroid_embedding, face_count, cover_photo_id) VALUES (?, ?, ?) RETURNING id')
        .bind(new Float32Array(result.centroidEmbedding).buffer, result.faceCount, result.coverPhotoId ?? null)
        .first<{ id: number }>();
      if (!inserted) continue;
      clusterId = inserted.id;
    } else {
      await env.DB
        .prepare("UPDATE person_clusters SET centroid_embedding = ?, face_count = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(new Float32Array(result.centroidEmbedding).buffer, result.faceCount, clusterId)
        .run();
    }

    for (const idChunk of chunk(result.addedFaceIds, FACE_ID_CHUNK_SIZE)) {
      if (idChunk.length === 0) continue;
      const placeholders = idChunk.map(() => '?').join(',');
      await env.DB
        .prepare(`UPDATE photo_faces SET person_id = ? WHERE id IN (${placeholders})`)
        .bind(clusterId, ...idChunk)
        .run();
      facesAssigned += idChunk.length;
    }
  }

  return { facesAssigned };
}

/** Count of faces still awaiting clustering — used by the People page for progress display. */
export async function countUnclusteredFaces(env: Env): Promise<number> {
  const row = await env.DB
    .prepare('SELECT COUNT(*) as count FROM photo_faces WHERE person_id IS NULL')
    .first<{ count: number }>();
  return row?.count ?? 0;
}

// Every embedding is a Float32Array BLOB, so its expected byte length is dims * 4 bytes/float.
// See faceValidation.ts's EXPECTED_EMBEDDING_LENGTH doc comment for the full history: this app
// switched face-embedding models in 2026-08 (face-api.js's 128-dim FaceRecognitionNet ->
// @vladmandic/human's 1024-dim FaceRes descriptor). Rows/clusters created before that switch
// (`faces_processed_at` was already set, so the backfill scan never revisits them) are stuck
// with 128-dim (512-byte) embeddings/centroids forever — comparing a 512-byte BLOB against a
// 4096-byte one in humanDistance()/humanSimilarity() (which loops `Math.min(a.length,
// b.length)`) silently truncates to the first 128 of the 1024 dimensions, comparing two
// completely incompatible embedding spaces. In practice this makes every genuine "same person"
// match against a pre-switch cluster score as if the faces were near-total strangers, which is
// exactly why merge suggestions/clustering can find literally 0 matches for people who
// obviously DO recur in the library: their older photos are still tagged with the old,
// incomparable embedding.
const EXPECTED_EMBEDDING_BYTES = EXPECTED_EMBEDDING_LENGTH * 4;

/** Number of photo_faces rows and person_clusters rows still using the legacy pre-2026-08
 *  face-api.js embedding format (see EXPECTED_EMBEDDING_BYTES doc comment above) — surfaced to
 *  the admin so they know why "same person" matches might be silently missing, and so they can
 *  trigger resetLegacyFaces() to fix it. `corruptedClusters` counts a SEPARATE, worse problem:
 *  clusters whose centroid is already the CORRECT byte length but contains `NaN` values — see
 *  findCorruptedClusterIds()'s doc comment below for exactly how this happens. */
export interface LegacyFaceStats {
  legacyFaces: number;
  legacyClusters: number;
  corruptedClusters: number;
}

/**
 * Finds person_clusters whose centroid_embedding is the CORRECT byte length (so
 * getLegacyFaceStats()'s simple LENGTH() check misses them) but contains `NaN` in one or more
 * dimensions — this happens when a legacy (128-dim) face was, before humanDistance()'s
 * dimension-mismatch guard existed (see faceClusteringClient.ts's doc comment on humanDistance
 * for the full incident), incorrectly matched via a truncated 128-dim-only comparison into an
 * otherwise-healthy 1024-dim cluster: the running-average centroid update indexes the new
 * face's embedding by the EXISTING (1024-dim) cluster's length, so reading past the shorter
 * legacy embedding's end produces `undefined`, and `undefined - number` is `NaN` — permanently
 * corrupting that cluster's centroid in every dimension beyond 128, silently breaking ALL
 * future comparisons against it (a `NaN` in any operand makes every comparison false, so a
 * corrupted cluster can never again match a genuinely-matching face, forcing new near-duplicate
 * clusters to form for what should be the same person — the "lots of 2-photo duplicate people"
 * symptom this exists to catch). Deliberately does the NaN check in JS after fetching each
 * candidate cluster's raw bytes, since SQLite has no portable way to test individual float32
 * BLOB elements for NaN.
 */
async function findCorruptedClusterIds(env: Env): Promise<number[]> {
  const { results } = await env.DB
    .prepare('SELECT id, centroid_embedding FROM person_clusters WHERE LENGTH(centroid_embedding) = ?')
    .bind(EXPECTED_EMBEDDING_BYTES)
    .all<{ id: number; centroid_embedding: ArrayBuffer }>();

  return (results || [])
    .filter((row) => new Float32Array(row.centroid_embedding).some((v) => Number.isNaN(v)))
    .map((row) => row.id);
}

export async function getLegacyFaceStats(env: Env): Promise<LegacyFaceStats> {
  const [faceRow, clusterRow, corruptedClusterIds] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM photo_faces WHERE LENGTH(embedding) != ?')
      .bind(EXPECTED_EMBEDDING_BYTES)
      .first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) as count FROM person_clusters WHERE LENGTH(centroid_embedding) != ?')
      .bind(EXPECTED_EMBEDDING_BYTES)
      .first<{ count: number }>(),
    findCorruptedClusterIds(env),
  ]);
  return {
    legacyFaces: faceRow?.count ?? 0,
    legacyClusters: clusterRow?.count ?? 0,
    corruptedClusters: corruptedClusterIds.length,
  };
}

/**
 * One-time repair for the legacy-embedding-dimension problem described above. There is no way
 * to "fix" an old 128-dim embedding in place — the original descriptor values are simply the
 * wrong shape for the new model, and can only be regenerated by re-running face DETECTION
 * (client-side, see faceDetection.ts) on the original photo. So this:
 *  1. Deletes every photo_faces row with a legacy-dimension embedding, and resets that photo's
 *     `faces_processed_at` back to NULL so it's picked up again by the next "Scan Library for
 *     Faces" backfill pass (which will re-detect it fresh under the current model).
 *  2. Deletes every person_clusters row with a legacy-dimension centroid (their membership is
 *     gone anyway once step 1 deletes their member faces; a cluster's centroid also can't be
 *     "fixed" in place, since it's an average of embeddings that no longer exist in a
 *     comparable form) — any *other*, correctly-dimensioned faces that had been (incorrectly,
 *     via truncated-comparison) assigned to that legacy cluster are unassigned back to
 *     unclustered (`person_id = NULL`) rather than deleted, so they simply get a chance to
 *     re-cluster correctly on the next "Cluster Now" pass.
 *  3. Deletes every person_clusters row whose centroid is already NaN-corrupted (see
 *     findCorruptedClusterIds() above) — unlike step 2, ALL of that cluster's member faces are
 *     unassigned back to unclustered (not deleted), since those faces themselves are perfectly
 *     valid, correctly-dimensioned data; only the cluster's centroid/grouping is untrustworthy.
 * Pure I/O, safe to run repeatedly (a no-op once no legacy/corrupted rows remain).
 */
export async function resetLegacyFaces(env: Env): Promise<{ facesReset: number; clustersRemoved: number }> {
  const [{ results: legacyClusterRows }, corruptedClusterIds] = await Promise.all([
    env.DB.prepare('SELECT id FROM person_clusters WHERE LENGTH(centroid_embedding) != ?')
      .bind(EXPECTED_EMBEDDING_BYTES)
      .all<{ id: number }>(),
    findCorruptedClusterIds(env),
  ]);
  const legacyClusterIds = [...new Set([...(legacyClusterRows || []).map((r) => r.id), ...corruptedClusterIds])];

  for (const idChunk of chunk(legacyClusterIds, FACE_ID_CHUNK_SIZE)) {
    if (idChunk.length === 0) continue;
    const placeholders = idChunk.map(() => '?').join(',');
    await env.DB
      .prepare(`UPDATE photo_faces SET person_id = NULL WHERE person_id IN (${placeholders})`)
      .bind(...idChunk)
      .run();
    await env.DB
      .prepare(`DELETE FROM person_clusters WHERE id IN (${placeholders})`)
      .bind(...idChunk)
      .run();
  }

  const { results: legacyFaceRows } = await env.DB
    .prepare('SELECT DISTINCT photo_id FROM photo_faces WHERE LENGTH(embedding) != ?')
    .bind(EXPECTED_EMBEDDING_BYTES)
    .all<{ photo_id: string }>();
  const legacyPhotoIds = (legacyFaceRows || []).map((r) => r.photo_id);

  await env.DB
    .prepare('DELETE FROM photo_faces WHERE LENGTH(embedding) != ?')
    .bind(EXPECTED_EMBEDDING_BYTES)
    .run();

  for (const idChunk of chunk(legacyPhotoIds, FACE_ID_CHUNK_SIZE)) {
    if (idChunk.length === 0) continue;
    const placeholders = idChunk.map(() => '?').join(',');
    await env.DB
      .prepare(`UPDATE photos SET faces_processed_at = NULL WHERE id IN (${placeholders})`)
      .bind(...idChunk)
      .run();
  }

  return { facesReset: legacyPhotoIds.length, clustersRemoved: legacyClusterIds.length };
}
