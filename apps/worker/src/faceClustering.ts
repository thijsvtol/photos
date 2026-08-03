import type { Env } from './types';

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
