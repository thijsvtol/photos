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

/**
 * THE REAL ROOT CAUSE of "clustering never groups more than 2 photos, no real matches ever
 * found" (2026-08-03, discovered by directly inspecting production D1 data after 4 rounds of
 * platform-limit fixes still didn't resolve the reported symptoms): `new Float32Array(x)`
 * behaves COMPLETELY differently depending on what `x` actually is at runtime:
 *  - If `x` is a raw `ArrayBuffer`: the bytes are REINTERPRETED as packed 32-bit floats (a
 *    4096-byte buffer becomes 1024 floats) — this is what every BLOB-reading call in this file
 *    always assumed and was typed for (`ArrayBuffer` in every D1 row type below).
 *  - If `x` is instead ANY other typed array / array-like (e.g. a `Uint8Array` VIEW), the
 *    constructor instead COPIES ELEMENT VALUES ONE-FOR-ONE with NO byte reinterpretation — a
 *    4096-byte Uint8Array (4096 elements, each a raw byte 0-255) becomes a Float32Array of
 *    4096 elements, each just that byte's numeric value (0-255) cast to float — i.e. the
 *    individual BYTES of the real embedding, not the real (4-bytes-per-float) embedding values
 *    at all. Confirmed directly against production data: every single stored
 *    `person_clusters.centroid_embedding` was 16384 bytes (4096 floats, 4x too many) and EVERY
 *    ONE of those 4096 values was a plain integer in [0, 255] — the unmistakable signature of
 *    this exact bug, not real embedding data. Whatever D1/runtime detail causes `f.embedding`/
 *    `c.centroid_embedding` to arrive as something other than a plain `ArrayBuffer` in
 *    production (this repo's own D1 mocks in tests always hand back genuine `ArrayBuffer`s, so
 *    none of this feature's many unit tests ever could have caught it), the effect is that
 *    EVERY face/centroid this Worker has ever handed to the browser for clustering has been
 *    pure noise (raw bytes reinterpreted as garbage floats) rather than real face descriptors —
 *    explaining, in one stroke, every previously-reported symptom: clustering never grouping
 *    more than 1-2 photos (comparing noise to noise essentially never "matches"), merge
 *    suggestions finding nothing (same reason), and the escalating 503s (ever-more garbage
 *    clusters accumulating, each still needing to be fetched/converted/serialized every pass).
 *
 * FIX: `blobToFloat32Array()` below normalizes ANY BLOB value D1 hands back — whether it's a
 * genuine `ArrayBuffer` or some other `ArrayBufferView` — into a CORRECTLY byte-reinterpreted
 * Float32Array, by explicitly slicing out the view's own backing bytes before constructing the
 * Float32Array, rather than ever passing an ambiguous value straight into `new Float32Array()`.
 * ALL BLOB reads in this file now go through this helper. As defense-in-depth (in case some
 * other, still-unknown mechanism produces a wrong-length array in the future),
 * `applyClusteringResults()` also now HARD-REJECTS (never writes) any result whose
 * `centroidEmbedding` isn't exactly `EXPECTED_EMBEDDING_LENGTH` — so even if a future bug
 * produces garbage client-side, it can no longer silently reach the database.
 *
 * FOLLOW-UP (confirmed live via `wrangler tail` against production, 2026-08-03): even after the
 * ArrayBuffer/ArrayBufferView handling above, clustering STILL produced zero results — logging
 * the raw value's constructor revealed D1's binding API in THIS runtime actually hands BLOB
 * columns back as a plain JS `Array` of numbers (`constructor=Array`, `isView=false`, i.e.
 * neither an `ArrayBuffer` nor any `ArrayBufferView`) — a THIRD possible shape beyond the two
 * this function originally handled. Each element of that array is one raw BYTE (0-255) of the
 * BLOB, so `new Float32Array(plainArray)` hits the exact same "copy each element's value,
 * don't reinterpret bytes" behavior as the ArrayBufferView case (a plain array is also
 * array-like, so the Float32Array constructor treats it identically) — same 4x-inflated,
 * byte-value corruption, just from yet another possible runtime representation.
 */
export function blobToFloat32Array(blob: ArrayBuffer | ArrayBufferView | number[]): Float32Array {
  if (Array.isArray(blob)) {
    // A plain array of raw byte values (0-255) — build a real Uint8Array from it first, then
    // reinterpret ITS backing buffer as packed floats.
    return new Float32Array(Uint8Array.from(blob).buffer);
  }
  if (ArrayBuffer.isView(blob)) {
    // blob is some other typed array/view (Uint8Array, Buffer, etc.) — slice out exactly its
    // own backing bytes into a fresh, tightly-sized ArrayBuffer before reinterpreting, so the
    // result is correct regardless of the view's element type, offset, or any surrounding
    // buffer padding/pooling.
    return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
  }
  return new Float32Array(blob);
}

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
  /** Pass as `afterClusterId` on the next call to fetch the next page of clusters; null once
   *  every cluster has been returned. */
  nextClusterCursor: number | null;
  /** Pass as `afterFaceId` on the next call to fetch the next page of faces; null once every
   *  unclustered face has been returned (or `includeFaces` was false). */
  nextFaceCursor: number | null;
}

// Converting a BLOB embedding into a plain number[] (Array.from(new Float32Array(...))) is
// REAL synchronous CPU work — 1024 floats per row — and so is JSON-encoding the resulting
// payload; both scale with however many cluster/face ROWS are fetched in one call, even though
// the SQL query itself is cheap I/O. A large library (thousands of clusters and/or unclustered
// faces) can make a single "fetch everything" call alone exceed the Workers Free plan's 10ms
// CPU-time limit purely from this marshalling work, with ZERO vector-similarity math involved —
// this is a DIFFERENT bug from (but the same failure class as) the CPU-time issues that moved
// the actual clustering math to the browser in the first place; see this file's top-of-file
// doc comment and repo memory for that earlier history. Fix: this endpoint is now CURSOR-
// PAGINATED (id-based, ORDER BY id ASC) — each call converts/serializes at most PAGE_SIZE rows
// of each kind, bounding the CPU cost of a SINGLE invocation regardless of total library size.
// The client (apps/web/src/api.ts's getFullClusterData()) loops calling this repeatedly,
// accumulating the full dataset across many small, safe requests before running the actual
// clustering/merge-suggestion math in the browser.
const PAGE_SIZE = 300;

/**
 * Fetches ONE PAGE of currently-unclustered faces and ONE PAGE of existing person clusters —
 * pure I/O plus bounded (PAGE_SIZE-capped) marshalling work, safe regardless of how large the
 * library has grown overall (see PAGE_SIZE's doc comment above for why marshalling itself,
 * not just the SQL query, needed to be bounded). `includeFaces=false` skips fetching faces
 * entirely for callers that only need cluster centroids (e.g. the merge-suggestions scan,
 * which never reads photo_faces at all). `unclusteredOnly=false` (added 2026-08-04 for the
 * "Rebuild All" deep-reclustering mode) drops the `WHERE person_id IS NULL` filter, returning
 * EVERY face regardless of current assignment — used when recomputing every cluster from
 * scratch using each face's REAL embedding (see faceClusteringClient.ts's
 * runDeepRebuildClustering()), rather than only the not-yet-clustered ones incremental
 * clustering cares about.
 */
export async function getClusterData(
  env: Env,
  includeFaces: boolean,
  afterClusterId = 0,
  afterFaceId = 0,
  unclusteredOnly = true
): Promise<ClusterData> {
  const { results: clusterRows } = await env.DB
    .prepare('SELECT id, centroid_embedding, face_count FROM person_clusters WHERE id > ? ORDER BY id ASC LIMIT ?')
    .bind(afterClusterId, PAGE_SIZE)
    .all<{ id: number; centroid_embedding: ArrayBuffer; face_count: number }>();

  const clusterRowsArr = clusterRows || [];
  const clusters: ClusterDataCluster[] = clusterRowsArr.map((c) => ({
    id: c.id,
    centroidEmbedding: Array.from(blobToFloat32Array(c.centroid_embedding)),
    faceCount: c.face_count,
  }));
  const nextClusterCursor = clusterRowsArr.length === PAGE_SIZE ? clusterRowsArr[clusterRowsArr.length - 1].id : null;

  if (!includeFaces) {
    return { faces: [], clusters, nextClusterCursor, nextFaceCursor: null };
  }

  const { results: faceRows } = await env.DB
    .prepare(
      unclusteredOnly
        ? `SELECT id, photo_id, embedding FROM photo_faces WHERE person_id IS NULL AND id > ? ORDER BY id ASC LIMIT ?`
        : `SELECT id, photo_id, embedding FROM photo_faces WHERE id > ? ORDER BY id ASC LIMIT ?`
    )
    .bind(afterFaceId, PAGE_SIZE)
    .all<{ id: number; photo_id: string; embedding: ArrayBuffer }>();

  const faceRowsArr = faceRows || [];
  const faces: ClusterDataFace[] = faceRowsArr.map((f) => ({
    id: f.id,
    photoId: f.photo_id,
    embedding: Array.from(blobToFloat32Array(f.embedding)),
  }));
  const nextFaceCursor = faceRowsArr.length === PAGE_SIZE ? faceRowsArr[faceRowsArr.length - 1].id : null;

  return { faces, clusters, nextClusterCursor, nextFaceCursor };
}

/**
 * Unassigns every face from its person and deletes every person cluster — used before a full
 * "Rebuild All (Deep)" reclustering pass, which recomputes every cluster from scratch using
 * each face's real embedding rather than incrementally matching against existing (possibly
 * imperfect) clusters. Raw `photo_faces.embedding` rows are NEVER touched/deleted, only the
 * derived `person_id` assignment and `person_clusters` rows — fully recoverable by running
 * clustering again, nothing is permanently lost.
 */
export async function resetAllClusters(env: Env): Promise<{ facesUnassigned: number; clustersDeleted: number }> {
  const unassignResult = await env.DB
    .prepare('UPDATE photo_faces SET person_id = NULL WHERE person_id IS NOT NULL')
    .run();
  const deleteResult = await env.DB.prepare('DELETE FROM person_clusters').run();
  return {
    facesUnassigned: unassignResult.meta.changes ?? 0,
    clustersDeleted: deleteResult.meta.changes ?? 0,
  };
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

// Same drift-safeguard as apps/web/src/faceClusteringClient.ts's CENTROID_UPDATE_CAP (kept in
// sync manually — see that file's doc comment for the full "runaway 2354-face cluster"
// incident this prevents): once a cluster has this many members, each ADDITIONAL face still
// nudges the centroid by a fixed ~1/30 weight instead of an ever-shrinking 1/n one, so a
// large cluster's centroid stays representative of its RECENT members rather than freezing
// into an over-generic average of its entire history. Used here for manual "assign this photo
// to this person" actions (see assignPhotosToPerson()) so a manual correction "teaches" the
// centroid the same safe way automatic clustering does.
const CENTROID_UPDATE_CAP = 30;

/** Incorporates one new member embedding into a running centroid using the same drift-capped
 *  weighted-average formula as the client-side clustering algorithm (see CENTROID_UPDATE_CAP's
 *  doc comment) — used when a human manually assigns a face to a person, so that correction
 *  actually "teaches" the person's centroid instead of leaving it stale. */
function incorporateEmbedding(centroid: Float32Array, count: number, embedding: Float32Array): { centroid: Float32Array; count: number } {
  const newCount = count + 1;
  const weight = 1 / Math.min(newCount, CENTROID_UPDATE_CAP);
  const newCentroid = new Float32Array(centroid.length);
  for (let d = 0; d < newCentroid.length; d++) {
    newCentroid[d] = centroid[d] + (embedding[d] - centroid[d]) * weight;
  }
  return { centroid: newCentroid, count: newCount };
}

// Defensive cap on how many faces one manual assignment call will process — this is meant for
// "assign a photo (usually 1, occasionally a few faces) to a person", NOT a bulk-reclustering
// tool (that's what "Cluster Now" is for) — each face touched costs a handful of D1 calls
// (read + person_id update + possible old-cluster shrink/delete), so an unbounded list here
// could itself approach the Workers Free plan's 50-subrequests-per-request limit (see repo
// docs for the multi-round history of hitting that exact limit elsewhere in this feature).
export const MAX_MANUAL_ASSIGN_FACES = 40;

/**
 * Manually assigns EVERY photo_faces row belonging to the given photos to `targetPersonId` —
 * used when an admin corrects a mistake (a photo's face was never clustered, or landed under
 * the wrong person) via an "Assign to this person" action in the UI. Takes photo ids (not raw
 * face ids) since that's what the admin actually picks in the UI (a photo, not an individual
 * detected face) — most photos have exactly one face, but this resolves ALL faces on each given
 * photo so a multi-face photo doesn't leave some faces behind. For each face:
 *  1. If it currently belongs to a DIFFERENT cluster, that cluster's face_count is decremented
 *     (and the cluster deleted entirely if it reaches 0) — its centroid is NOT recomputed
 *     backward, since precisely undoing a running average without replaying its full history
 *     isn't possible; a stale centroid missing one member is a negligible, self-correcting
 *     drift (the next full "Cluster Now" recomputes everything from scratch anyway).
 *  2. The face's `person_id` is set to `targetPersonId`.
 *  3. `targetPersonId`'s centroid/face_count are updated via `incorporateEmbedding()` — this is
 *     the "the model should learn from that" behavior: a manual correction directly teaches the
 *     target person's centroid using the exact same drift-safe formula automatic clustering
 *     uses, so future automatic clustering passes benefit from the correction too.
 * Faces already belonging to `targetPersonId` are skipped (no-op, not double-counted).
 */
export async function assignPhotosToPerson(
  env: Env,
  targetPersonId: number,
  photoIds: string[]
): Promise<{ assigned: number; skipped: number }> {
  const target = await env.DB
    .prepare('SELECT centroid_embedding, face_count FROM person_clusters WHERE id = ?')
    .bind(targetPersonId)
    .first<{ centroid_embedding: ArrayBuffer; face_count: number }>();
  if (!target) {
    throw new Error(`Person ${targetPersonId} not found`);
  }

  const boundedPhotoIds = photoIds.slice(0, MAX_MANUAL_ASSIGN_FACES);
  const faceRows: { id: number; embedding: ArrayBuffer; person_id: number | null }[] = [];
  for (const photoIdChunk of chunk(boundedPhotoIds, FACE_ID_CHUNK_SIZE)) {
    if (photoIdChunk.length === 0) continue;
    const placeholders = photoIdChunk.map(() => '?').join(',');
    const { results } = await env.DB
      .prepare(`SELECT id, embedding, person_id FROM photo_faces WHERE photo_id IN (${placeholders})`)
      .bind(...photoIdChunk)
      .all<{ id: number; embedding: ArrayBuffer; person_id: number | null }>();
    faceRows.push(...(results || []));
  }
  // Defense-in-depth: even if a caller passes more photoIds than MAX_MANUAL_ASSIGN_FACES worth
  // of faces (e.g. several multi-face photos), still cap the actual per-face work performed.
  const boundedFaceRows = faceRows.slice(0, MAX_MANUAL_ASSIGN_FACES);

  let centroid = blobToFloat32Array(target.centroid_embedding);
  let count = target.face_count;
  let assigned = 0;
  let skipped = 0;

  for (const face of boundedFaceRows) {
    if (face.person_id === targetPersonId) {
      skipped++;
      continue;
    }
    if (blobToFloat32Array(face.embedding).length !== EXPECTED_EMBEDDING_LENGTH) {
      console.error(`assignPhotosToPerson: skipping face ${face.id} with a malformed embedding length`);
      skipped++;
      continue;
    }

    if (face.person_id !== null) {
      const oldCluster = await env.DB
        .prepare('SELECT face_count FROM person_clusters WHERE id = ?')
        .bind(face.person_id)
        .first<{ face_count: number }>();
      if (oldCluster) {
        const newOldCount = oldCluster.face_count - 1;
        if (newOldCount <= 0) {
          await env.DB.prepare('DELETE FROM person_clusters WHERE id = ?').bind(face.person_id).run();
        } else {
          await env.DB
            .prepare("UPDATE person_clusters SET face_count = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(newOldCount, face.person_id)
            .run();
        }
      }
    }

    await env.DB.prepare('UPDATE photo_faces SET person_id = ? WHERE id = ?').bind(targetPersonId, face.id).run();

    const embedding = blobToFloat32Array(face.embedding);
    const updated = incorporateEmbedding(centroid, count, embedding);
    centroid = updated.centroid;
    count = updated.count;
    assigned++;
  }

  if (assigned > 0) {
    await env.DB
      .prepare("UPDATE person_clusters SET centroid_embedding = ?, face_count = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(centroid.buffer, count, targetPersonId)
      .run();
  }

  return { assigned, skipped };
}

/**
 * Merges one or more source person_clusters into a target cluster (e.g. an admin recognizes
 * two groups are the same real person and combines them) — reassigns every source face to the
 * target and deletes the source clusters.
 *
 * "The model should learn from that": the target's centroid is recomputed as a proper WEIGHTED
 * AVERAGE of the target's and every source's existing centroids, weighted by each one's
 * face_count — mathematically equivalent to averaging every individual member face's embedding
 * directly (since each stored centroid is already the true average of its own members), without
 * needing to re-fetch every individual face's embedding (cheap regardless of how many photos
 * either person has — a merge of two people with thousands of photos each costs the same
 * handful of D1 calls as merging two people with 2 photos each, unlike a naive "average every
 * member face" approach which would scale with total photo count and risk the same CPU-time/
 * subrequest limits documented elsewhere in this feature's history).
 */
export async function mergeClusters(env: Env, targetPersonId: number, sourcePersonIds: number[]): Promise<{ facesMoved: number }> {
  const idsToMerge = sourcePersonIds.filter((id) => id !== targetPersonId);
  if (idsToMerge.length === 0) {
    return { facesMoved: 0 };
  }

  const target = await env.DB
    .prepare('SELECT centroid_embedding, face_count, name, linked_user_email FROM person_clusters WHERE id = ?')
    .bind(targetPersonId)
    .first<{ centroid_embedding: ArrayBuffer; face_count: number; name: string | null; linked_user_email: string | null }>();
  if (!target) {
    throw new Error(`Person ${targetPersonId} not found`);
  }

  const placeholders = idsToMerge.map(() => '?').join(',');
  const { results: sourceRows } = await env.DB
    .prepare(`SELECT id, centroid_embedding, face_count, name, linked_user_email FROM person_clusters WHERE id IN (${placeholders})`)
    .bind(...idsToMerge)
    .all<{ id: number; centroid_embedding: ArrayBuffer; face_count: number; name: string | null; linked_user_email: string | null }>();

  // Which surviving name/linked account to keep after the merge: prefer the target's own value
  // if it already has one (e.g. merging a stray "Unnamed" duplicate into an already-named
  // person shouldn't blank it out), otherwise fall back to the first source that has one set —
  // this is what lets an admin merge an "Unnamed" group into a named one (or vice versa)
  // without having to separately re-type the name/email afterward.
  const resolvedName = target.name ?? sourceRows?.find((s) => s.name)?.name ?? null;
  const resolvedLinkedUserEmail = target.linked_user_email ?? sourceRows?.find((s) => s.linked_user_email)?.linked_user_email ?? null;

  const targetCentroid = blobToFloat32Array(target.centroid_embedding);
  const weightedSum = new Float64Array(targetCentroid.length);
  for (let d = 0; d < targetCentroid.length; d++) {
    weightedSum[d] = targetCentroid[d] * target.face_count;
  }
  let totalCount = target.face_count;

  for (const source of sourceRows || []) {
    const sourceCentroid = blobToFloat32Array(source.centroid_embedding);
    if (sourceCentroid.length !== targetCentroid.length) {
      // A malformed/legacy-dimension source centroid can't be safely averaged in — its faces
      // still get moved below (they're individually valid, correctly-dimensioned rows; only
      // this cluster's OWN centroid was untrustworthy), just excluded from the weighted-average
      // math so it can't corrupt the target's centroid.
      console.error(`mergeClusters: excluding source cluster ${source.id} from centroid averaging (malformed centroid length ${sourceCentroid.length})`);
      continue;
    }
    for (let d = 0; d < weightedSum.length; d++) {
      weightedSum[d] += sourceCentroid[d] * source.face_count;
    }
    totalCount += source.face_count;
  }

  const newCentroid = new Float32Array(weightedSum.length);
  for (let d = 0; d < newCentroid.length; d++) {
    newCentroid[d] = totalCount > 0 ? weightedSum[d] / totalCount : targetCentroid[d];
  }

  await env.DB
    .prepare(`UPDATE photo_faces SET person_id = ? WHERE person_id IN (${placeholders})`)
    .bind(targetPersonId, ...idsToMerge)
    .run();

  const countRow = await env.DB
    .prepare('SELECT COUNT(*) as count FROM photo_faces WHERE person_id = ?')
    .bind(targetPersonId)
    .first<{ count: number }>();

  await env.DB
    .prepare("UPDATE person_clusters SET centroid_embedding = ?, face_count = ?, name = ?, linked_user_email = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(newCentroid.buffer, countRow?.count || 0, resolvedName, resolvedLinkedUserEmail, targetPersonId)
    .run();

  await env.DB.prepare(`DELETE FROM person_clusters WHERE id IN (${placeholders})`).bind(...idsToMerge).run();

  return { facesMoved: countRow?.count || 0 };
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
 *
 * Defense-in-depth: HARD-REJECTS (skips, never writes) any result whose `centroidEmbedding`
 * isn't exactly `EXPECTED_EMBEDDING_LENGTH` (1024) — see this file's top-of-file doc comment
 * for the exact production incident this guards against (a read-side bug once silently fed
 * 4x-too-long, garbage "embeddings" all the way through clustering and into the database).
 * Even with that read-side bug now fixed, this guard ensures no future, still-unknown bug can
 * ever again silently write a malformed centroid — better to lose one cluster update/skip one
 * new cluster than to permanently corrupt matching for that person going forward.
 */
export async function applyClusteringResults(env: Env, results: ClusterResult[]): Promise<{ facesAssigned: number; rejected: number }> {
  let facesAssigned = 0;
  let rejected = 0;

  for (const result of results) {
    if (result.centroidEmbedding.length !== EXPECTED_EMBEDDING_LENGTH) {
      console.error(
        `Rejected clustering result with malformed centroidEmbedding length ${result.centroidEmbedding.length} (expected ${EXPECTED_EMBEDDING_LENGTH})`
      );
      rejected++;
      continue;
    }

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

  return { facesAssigned, rejected };
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
    .filter((row) => blobToFloat32Array(row.centroid_embedding).some((v) => Number.isNaN(v)))
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

/** A single named person tagged on a photo, for display (e.g. PhotoDetail's Info sheet). */
export interface PhotoPerson {
  id: number;
  name: string;
}

/**
 * Returns every NAMED person appearing on a photo, combining both sources of "this person is in
 * this photo": automatically detected faces (photo_faces.person_id) AND manual admin tags
 * (photo_person_tags — see migration 026's doc comment for why manual tags are a separate table
 * rather than fake photo_faces rows). Deliberately excludes still-unnamed clusters (an
 * un-reviewed automatic grouping isn't a meaningful "who is this" answer for a viewer to see),
 * and de-duplicates a person appearing via both an automatic face AND a manual tag on the same
 * photo into a single entry.
 */
export async function getPhotoPeople(env: Env, photoId: string): Promise<PhotoPerson[]> {
  const { results } = await env.DB
    .prepare(`
      SELECT DISTINCT pc.id, pc.name
      FROM person_clusters pc
      WHERE pc.name IS NOT NULL
        AND pc.id IN (
          SELECT person_id FROM photo_faces WHERE photo_id = ? AND person_id IS NOT NULL
          UNION
          SELECT person_id FROM photo_person_tags WHERE photo_id = ?
        )
      ORDER BY pc.name COLLATE NOCASE
    `)
    .bind(photoId, photoId)
    .all<PhotoPerson>();
  return results || [];
}

/**
 * Replaces the full set of MANUALLY tagged people on a photo (photo_person_tags only — never
 * touches photo_faces/automatic detections). Used by the admin "Tag people" editor on
 * PhotoDetail, which always submits the complete desired set rather than one-at-a-time add/
 * remove calls, so a plain delete-then-insert is simplest and avoids any drift between the UI's
 * local state and the stored rows.
 */
export async function setManualPhotoPersonTags(env: Env, photoId: string, personIds: number[]): Promise<void> {
  await env.DB.prepare('DELETE FROM photo_person_tags WHERE photo_id = ?').bind(photoId).run();

  const uniqueIds = [...new Set(personIds)];
  for (const id of uniqueIds) {
    await env.DB
      .prepare('INSERT INTO photo_person_tags (photo_id, person_id) VALUES (?, ?)')
      .bind(photoId, id)
      .run();
  }
}

// Cloudflare D1 caps bound parameters per statement; used below to keep each bulk-tag INSERT
// well under that limit even for a large multi-select + multi-person combination.
const BULK_TAG_CHUNK_SIZE = 90;

/**
 * ADDS (never replaces or removes) one or more people as manually-tagged on every given photo —
 * used by the gallery's multi-select "Tag people" bulk action, where an admin/editor selects a
 * batch of photos (e.g. everyone at a group event) and tags one or more people across all of
 * them at once. Deliberately additive rather than a bulk version of setManualPhotoPersonTags()'s
 * replace-the-whole-set behavior: a bulk action must never silently wipe out tags a photo
 * already had from a previous, unrelated tagging pass (e.g. one photo in the batch already had
 * someone else tagged individually on PhotoDetail) just because it happened to also be part of
 * this selection. `INSERT OR IGNORE` naturally no-ops any (photo, person) pair already tagged,
 * so this is safe to call repeatedly / on overlapping selections.
 */
export async function addManualPhotoPersonTags(env: Env, photoIds: string[], personIds: number[]): Promise<void> {
  const uniquePhotoIds = [...new Set(photoIds)];
  const uniquePersonIds = [...new Set(personIds)];
  if (uniquePhotoIds.length === 0 || uniquePersonIds.length === 0) return;

  const pairs: [string, number][] = [];
  for (const photoId of uniquePhotoIds) {
    for (const personId of uniquePersonIds) {
      pairs.push([photoId, personId]);
    }
  }

  for (const pairChunk of chunk(pairs, BULK_TAG_CHUNK_SIZE)) {
    if (pairChunk.length === 0) continue;
    const statements = pairChunk.map(([photoId, personId]) =>
      env.DB
        .prepare('INSERT OR IGNORE INTO photo_person_tags (photo_id, person_id) VALUES (?, ?)')
        .bind(photoId, personId)
    );
    await env.DB.batch(statements);
  }
}

