/**
 * Shared validation for client-reported face detections (POST .../faces
 * endpoints in routes/admin/uploads.ts and routes/admin/photos.ts). Face
 * descriptors/bboxes are computed entirely client-side (@vladmandic/human —
 * see apps/web/src/faceDetection.ts) and posted to the worker, so even
 * though both endpoints are behind permission checks (upload permission for
 * the per-event upload-time endpoint, admin-only for the cross-event
 * backfill endpoint), this is a defense-in-depth check against a
 * buggy/malicious client sending malformed or oversized payloads that would
 * otherwise bloat the DB or corrupt the face-clustering centroids.
 */
export interface RawFaceInput {
  embedding: number[];
  bbox: { x: number; y: number; width: number; height: number };
}

// Face embeddings are computed client-side via a purpose-built ArcFace ONNX recognition model
// (see apps/web/src/faceEmbeddingOnnx.ts), which always produces exactly 512 numbers. Was
// 1024 (@vladmandic/human's FaceRes descriptor) until 2026-08-04, and 128 (face-api.js's
// FaceRecognitionNet) before that. Exported so faceClustering.ts can size its CPU-budget
// calculations off the SAME constant instead of duplicating the magic number.
export const EXPECTED_EMBEDDING_LENGTH = 512;

export function isValidFaceInput(face: unknown): face is RawFaceInput {
  if (!face || typeof face !== 'object') return false;
  const f = face as { embedding?: unknown; bbox?: unknown };

  if (
    !Array.isArray(f.embedding) ||
    f.embedding.length !== EXPECTED_EMBEDDING_LENGTH ||
    !f.embedding.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    return false;
  }

  const bbox = f.bbox as Record<string, unknown> | undefined;
  return (
    !!bbox &&
    ['x', 'y', 'width', 'height'].every((key) => typeof bbox[key] === 'number' && Number.isFinite(bbox[key] as number))
  );
}
