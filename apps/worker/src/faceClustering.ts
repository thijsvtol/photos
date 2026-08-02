import type { Env } from './types';
import { createLogger } from './logger';

/**
 * Greedy nearest-centroid face clustering — pure JS vector math, no AI
 * binding needed (Workers AI has no face-embedding model; face descriptors
 * are computed CLIENT-SIDE via @vladmandic/human at upload time, see
 * apps/web/src/faceDetection.ts + faceDetectionQueue.ts, and posted to
 * POST /admin/events/:slug/uploads/:photoId/faces which just stores the raw
 * detections in `photo_faces`). This job assigns each not-yet-clustered
 * face to the nearest existing `person_clusters` centroid (within a
 * similarity threshold), or creates a new cluster if none match closely
 * enough, and updates a running-average centroid — same architectural
 * pattern as the trash-purge/AI-enrichment cron jobs (batch-limited,
 * runs hourly alongside them, no new infrastructure).
 *
 * The distance()/similarity() functions below are a direct port of
 * vladmandic/human's src/face/match.ts (MIT licensed) rather than an
 * invented formula — Human's own docs state "Similarity match above 50%
 * can be considered a match", so reusing their exact math means our
 * SAME_PERSON_THRESHOLD is grounded in the library author's own guidance
 * for this specific embedding space, not a guessed number. This matters
 * because Human's 1024-dim FaceRes descriptor is NOT on the same distance
 * scale as face-api.js's 128-dim descriptor this app used previously.
 */

const BATCH_SIZE = 200;

// Human's default similarity() options: order=2 (Euclidean), multiplier=25,
// normalize the resulting root-distance into a 0..1 "similarity" using a
// [min, max] = [0.2, 0.8] window before clamping. See vladmandic/human's
// wiki/Embedding: "Similarity match above 50% can be considered a match".
const MATCH_ORDER = 2;
const MATCH_MULTIPLIER = 25;
const MATCH_MIN = 0.2;
const MATCH_MAX = 0.8;
export const SAME_PERSON_THRESHOLD = 0.5;

/**
 * Minkowski distance between two descriptors (order=2 = Euclidean),
 * ported from Human's `distance()` — NOT square-rooted here (matches the
 * upstream implementation, which takes the root later inside
 * `normalizeDistance`/`similarity`).
 */
export function humanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.round(100 * MATCH_MULTIPLIER * sum) / 100;
}

/**
 * Normalized 0..1 similarity between two face descriptors, ported from
 * Human's `similarity()`/`normalizeDistance()`. 0 = no similarity, 1 =
 * perfect match; per Human's own docs, >=0.5 is considered a match.
 */
export function humanSimilarity(a: Float32Array, b: Float32Array): number {
  const dist = humanDistance(a, b);
  if (dist === 0) return 1; // short-circuit for identical inputs
  const root = MATCH_ORDER === 2 ? Math.sqrt(dist) : dist ** (1 / MATCH_ORDER);
  const norm = (1 - (root / 100) - MATCH_MIN) / (MATCH_MAX - MATCH_MIN);
  return Math.round(100 * Math.max(Math.min(norm, 1), 0)) / 100;
}

export async function runFaceClustering(env: Env): Promise<void> {
  const log = createLogger(env);

  const { results: faceRows } = await env.DB.prepare(`
    SELECT f.id, f.photo_id, f.embedding
    FROM photo_faces f
    WHERE f.person_id IS NULL
    ORDER BY f.created_at ASC
    LIMIT ?
  `).bind(BATCH_SIZE).all<{ id: number; photo_id: string; embedding: ArrayBuffer }>();

  const faces = faceRows || [];
  if (faces.length === 0) {
    log.debug('[runFaceClustering] No unclustered faces pending');
    return;
  }

  const { results: clusterRows } = await env.DB.prepare(`
    SELECT id, centroid_embedding, face_count FROM person_clusters
  `).all<{ id: number; centroid_embedding: ArrayBuffer; face_count: number }>();

  // In-memory working copy of clusters — updated as we go so faces within
  // the same batch can join a cluster created earlier in the same run.
  const clusters = (clusterRows || []).map((c) => ({
    id: c.id,
    centroid: new Float32Array(c.centroid_embedding),
    count: c.face_count,
  }));

  for (const face of faces) {
    try {
      const embedding = new Float32Array(face.embedding);

      let bestClusterIndex = -1;
      let bestSimilarity = -Infinity;
      for (let i = 0; i < clusters.length; i++) {
        const similarity = humanSimilarity(embedding, clusters[i].centroid);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestClusterIndex = i;
        }
      }

      if (bestClusterIndex >= 0 && bestSimilarity >= SAME_PERSON_THRESHOLD) {
        const cluster = clusters[bestClusterIndex];
        const newCount = cluster.count + 1;
        // Running average centroid: newCentroid = old + (embedding - old) / newCount
        const newCentroid = new Float32Array(cluster.centroid.length);
        for (let i = 0; i < newCentroid.length; i++) {
          newCentroid[i] = cluster.centroid[i] + (embedding[i] - cluster.centroid[i]) / newCount;
        }
        cluster.centroid = newCentroid;
        cluster.count = newCount;

        await env.DB.prepare(`
          UPDATE person_clusters SET centroid_embedding = ?, face_count = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(newCentroid.buffer, newCount, cluster.id).run();

        await env.DB.prepare('UPDATE photo_faces SET person_id = ? WHERE id = ?')
          .bind(cluster.id, face.id).run();
      } else {
        const result = await env.DB.prepare(`
          INSERT INTO person_clusters (centroid_embedding, face_count, cover_photo_id) VALUES (?, 1, ?) RETURNING id
        `).bind(embedding.buffer, face.photo_id).first<{ id: number }>();

        if (result) {
          clusters.push({ id: result.id, centroid: embedding, count: 1 });
          await env.DB.prepare('UPDATE photo_faces SET person_id = ? WHERE id = ?')
            .bind(result.id, face.id).run();
        }
      }
    } catch (err) {
      log.error(`[runFaceClustering] Failed to cluster face ${face.id}:`, err);
    }
  }

  log.debug(`[runFaceClustering] Processed ${faces.length} face(s) across ${clusters.length} cluster(s)`);
}
