/**
 * Client-side ArcFace-style face-recognition embedding via onnxruntime-web — replaces
 * @vladmandic/human's FaceRes descriptor (a general-purpose face DESCRIPTION model, never
 * trained to discriminate between different identities) as the source of the embeddings fed
 * into faceClusteringClient.ts. See repo memory / this app's People-feature history for why:
 * seven rounds of clustering-ALGORITHM tuning (centroid drift caps, adaptive thresholds,
 * representative-sample matching, etc.) all eventually hit the same wall — no algorithm can
 * make up for a fundamentally under-discriminative embedding for this app's content (similar
 * gear/lighting, small pool of recurring athletes).
 *
 * Model: ArcFace ResNet100 (int8-quantized, ~63MB), from the official ONNX Model Zoo
 * (onnx/models, `validated/vision/body_analysis/arcface`) — a purpose-built face-verification
 * model trained with an additive angular margin loss specifically to maximize between-identity
 * distance and minimize within-identity distance (unlike Human's FaceRes). Licensed for
 * non-commercial research use (this app is a personal/non-commercial gallery). Too large for a
 * Cloudflare Pages static asset (25MiB per-file limit) — hosted in R2 and served via the
 * `GET /api/me/face-embedding-model` Worker route, gated to any AUTHENTICATED user (not
 * admin-only — see routes/me.ts's doc comment for why: this model is fetched for EVERY
 * upload's face detection, not just admin actions), fetched here through `api.ts`'s
 * `getEmbeddingModelBuffer()`
 * (the SHARED axios instance) rather than a raw `fetch()` — a raw fetch bypasses this app's
 * auth entirely (native/Capacitor admin sessions authenticate via a Bearer token added by an
 * axios request interceptor, not a cookie), which silently 401'd on every single face and was
 * swallowed by faceDetection.ts's per-face try/catch, making "Scan Library for Faces" appear to
 * run successfully while actually finding zero faces for every photo (confirmed in production:
 * 6415 photos marked faces_processed_at, 0 rows in photo_faces).
 *
 * Input: a 112x112 aligned face crop (see faceAlignment.ts) — the model expects raw RGB pixel
 * values (0..255, NOT normalized to 0..1 or mean-subtracted) in NCHW layout, exactly matching
 * the official preprocessing (`face_preprocess.py`/`arcface_inference.ipynb`'s
 * `get_input()`/`get_feature()`).
 *
 * Output: a 512-dim embedding, L2-NORMALIZED here (matching the reference
 * `sklearn.preprocessing.normalize(embedding)` postprocessing step) so that COSINE similarity
 * (a plain dot product of two already-unit-length vectors) is a valid, cheap similarity
 * measure — see faceClusteringClient.ts's updated `humanSimilarity()`/`humanDistance()` for
 * where this embedding actually gets compared.
 *
 * onnxruntime-web's WASM runtime files are loaded from a CDN (jsdelivr) rather than
 * self-hosted, since they're separate from the (already R2-hosted) model file and this avoids
 * needing to manage/copy them as build assets.
 */

let sessionPromise: Promise<import('onnxruntime-web').InferenceSession> | null = null;

const EMBEDDING_DIM = 512;

async function loadSession(): Promise<import('onnxruntime-web').InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const [ort, { getEmbeddingModelBuffer }] = await Promise.all([
        import('onnxruntime-web'),
        import('./api'),
      ]);
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';

      const modelBuffer = await getEmbeddingModelBuffer();
      return ort.InferenceSession.create(modelBuffer, { executionProviders: ['wasm'] });
    })();
  }
  return sessionPromise;
}

/** Extracts raw RGB pixel values (0..255) from a 112x112 canvas in NCHW ([1,3,112,112])
 *  layout, matching the reference preprocessing's `np.transpose(nimg, (2,0,1))` — NO
 *  normalization/scaling is applied, since the reference model was trained on raw 0..255
 *  pixel values passed straight through. */
function canvasToNCHW(canvas: HTMLCanvasElement): Float32Array {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvasToNCHW: 2D canvas context unavailable');
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height); // RGBA, 0..255

  const chw = new Float32Array(3 * width * height);
  const plane = width * height;
  for (let i = 0; i < plane; i++) {
    const rgbaOffset = i * 4;
    chw[i] = data[rgbaOffset]; // R plane
    chw[plane + i] = data[rgbaOffset + 1]; // G plane
    chw[2 * plane + i] = data[rgbaOffset + 2]; // B plane
  }
  return chw;
}

function l2Normalize(vec: Float32Array): number[] {
  let sumSquares = 0;
  for (let i = 0; i < vec.length; i++) sumSquares += vec[i] * vec[i];
  const norm = Math.sqrt(sumSquares) || 1; // guard against an all-zero embedding
  const normalized = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) normalized[i] = vec[i] / norm;
  return normalized;
}

/**
 * Runs the ArcFace model on an already-aligned 112x112 face canvas (see
 * faceAlignment.ts's `alignFace()`), returning a 512-dim L2-normalized embedding as a plain
 * number[] (ready to store as a photo_faces.embedding BLOB, same shape/handling as the
 * previous Human-based embeddings, just a different dimension/model).
 */
export async function computeFaceEmbedding(alignedFace: HTMLCanvasElement): Promise<number[]> {
  const ort = await import('onnxruntime-web');
  const session = await loadSession();
  const inputData = canvasToNCHW(alignedFace);
  const inputTensor = new ort.Tensor('float32', inputData, [1, 3, alignedFace.height, alignedFace.width]);
  const inputName = session.inputNames[0];
  const outputs = await session.run({ [inputName]: inputTensor });
  const outputName = session.outputNames[0];
  const raw = outputs[outputName].data as Float32Array;
  if (raw.length !== EMBEDDING_DIM) {
    throw new Error(`computeFaceEmbedding: unexpected output length ${raw.length} (expected ${EMBEDDING_DIM})`);
  }
  return l2Normalize(raw);
}

export { EMBEDDING_DIM };
