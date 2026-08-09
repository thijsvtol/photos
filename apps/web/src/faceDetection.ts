/**
 * Client-side face detection using @vladmandic/human (MediaPipe BlazeFace
 * detector + FaceMesh + FaceRes description/embedding model). Runs entirely
 * in the browser/WebView — Workers AI has no face-embedding model, so this
 * follows the same pattern as this app's existing client-side EXIF/
 * blur-placeholder/RAW-decode processing rather than a server-side/AI-binding
 * approach.
 *
 * Switched from face-api.js to @vladmandic/human (2026-08) because this
 * app's photos are heavily action/sports (ice skating, cycling) with
 * goggles/helmets/angled faces — face-api.js's TinyFaceDetector (2019,
 * trained mostly on frontal/unoccluded faces) missed a lot of these. Human's
 * default detector (MediaPipe BlazeFace "back" variant) is trained for a
 * wider range of head poses/sizes and generally has better recall on
 * angled/partial faces, though goggles/full-face helmets still won't be
 * detected as faces by ANY off-the-shelf face model — that's a hard
 * ceiling, not a config issue.
 *
 * Human's face descriptor is NO LONGER USED as the clustering embedding (2026-08-04) — it
 * was found to be insufficiently discriminative between different identities for this app's
 * content (see faceClusteringClient.ts's top-of-file doc comment for the full saga). Human is
 * now used ONLY for detection (bounding box + 468-point FaceMesh landmarks); the actual
 * embedding comes from a purpose-built ArcFace ResNet100 face-RECOGNITION model run via
 * onnxruntime-web (see faceAlignment.ts for the 112x112 landmark-based alignment crop, and
 * faceEmbeddingOnnx.ts for the ONNX inference + L2-normalization), producing a 512-dim
 * embedding instead of Human's previous 1024-dim descriptor.
 *
 * @vladmandic/human (which bundles @tensorflow/tfjs) is loaded via a
 * DYNAMIC import, not a static one — this app's public gallery is viewed by
 * far more anonymous visitors than uploaders, and a static top-level import
 * would ship this (and its TensorFlow.js dependency) in the main entry
 * chunk for every single page view. Confirmed via `npm run build` +
 * grepping the output chunk with face-api.js before this fix; re-verified
 * after switching to Human. Dynamic import defers the fetch until the
 * first actual call to detectFaces() (i.e. only browsers that complete an
 * upload or run the People backfill scan ever download it).
 *
 * Models are loaded lazily (only once, on first use) from /models — see
 * apps/web/public/models/ (blazeface, facemesh, faceres — copied from
 * node_modules/@vladmandic/human/models at install time), ~8.9MB total,
 * fetched once and cached by the browser. Body/hand/object/gesture/
 * segmentation detection are explicitly disabled since this app only needs
 * faces — Human ships many more capabilities than we use, and disabling the
 * unused modules means their (much larger) models are never downloaded.
 */

import { alignFace } from './faceAlignment';
import { computeFaceEmbedding } from './faceEmbeddingOnnx';

const MODEL_URL = '/models';

/**
 * Every detection pass runs against an image capped to this on its longest side —
 * the same 1920px cap `createPreview()` (imageUtils.ts) uses for the stored preview,
 * so all three detection paths (upload, native folder-sync drain, admin backfill
 * scan) now see equivalent pixels.
 *
 * This REVERSES the 2026-08-06 change that moved the backfill scan from previews to
 * full originals for recall. That change was correct about recall and wrong about
 * cost: decoding originals is what made the Android WebView's renderer process run
 * out of memory and take the whole app process with it (`Render process kill (OOM)
 * wasn't handed by all associated webviews, killing application`). A 12MP photo is
 * ~48MB decoded as RGBA and this app ingests up to 108MP originals (~430MB) — with
 * detection taking seconds per photo, even a handful in flight exhausted the
 * renderer. Capping here costs some recall on small/distant faces; crashing the app
 * costs all of it.
 *
 * Partly self-compensating: the enhanced retry pass below (upscale ×1.5, capped at
 * RETRY_MAX_DIMENSION) used to be a no-op on any original ≥3000px, because
 * computeRetryScale() returned ≤1. At a 1920px input it genuinely upscales to
 * 2880px on the zero-face retry, recovering some of what the downscale costs.
 */
const DETECTION_MAX_DIMENSION = 1920;

let humanInstancePromise: Promise<import('@vladmandic/human').Human> | null = null;

function loadHuman(): Promise<import('@vladmandic/human').Human> {
  if (!humanInstancePromise) {
    humanInstancePromise = (async () => {
      const { Human } = await import('@vladmandic/human');
      const human = new Human({
        modelBasePath: MODEL_URL,
        face: {
          enabled: true,
          detector: { rotation: true, return: true },
          mesh: { enabled: true },
          description: { enabled: false },
          iris: { enabled: false },
          emotion: { enabled: false },
          antispoof: { enabled: false },
          liveness: { enabled: false },
        },
        body: { enabled: false },
        hand: { enabled: false },
        object: { enabled: false },
        gesture: { enabled: false },
        segmentation: { enabled: false },
      });
      await human.load();
      return human;
    })();
  }
  return humanInstancePromise;
}

export interface DetectedFace {
  /** 512-dim L2-normalized ArcFace embedding (see faceEmbeddingOnnx.ts) — replaced Human's
   *  1024-dim FaceRes descriptor (2026-08-04), which wasn't discriminative enough between
   *  different identities for this app's content (see faceClusteringClient.ts's doc comment
   *  for the full saga this was ultimately needed to fix). */
  embedding: number[];
  bbox: { x: number; y: number; width: number; height: number };
}

type HumanInstance = import('@vladmandic/human').Human;
type DetectInput = HTMLImageElement | HTMLCanvasElement;

/**
 * Runs Human purely for face DETECTION (bounding box + 468-point FaceMesh landmarks) — Human's
 * own face descriptor is no longer used at all; the real embedding comes from the ArcFace ONNX
 * model instead (see faceAlignment.ts + faceEmbeddingOnnx.ts), which is computed separately
 * per detected face using the ORIGINAL image pixels (not Human's internal, possibly
 * downscaled, detector input) for the best possible alignment crop quality.
 */
async function detectAndEmbedFaces(human: HumanInstance, input: DetectInput): Promise<DetectedFace[]> {
  const result = await human.detect(input);
  const faces: DetectedFace[] = [];
  for (const face of result.face) {
    if (!face.mesh || face.mesh.length === 0) continue; // alignment needs mesh landmarks
    const [x, y, width, height] = face.box;
    try {
      const aligned = alignFace(input, face.mesh as Array<[number, number, number]>);
      const embedding = await computeFaceEmbedding(aligned);
      faces.push({ embedding, bbox: { x, y, width, height } });
    } catch (err) {
      console.warn('[faceDetection] Failed to align/embed a detected face:', err);
    }
  }
  return faces;
}

// Retry pass multiplier/enhancement applied ONLY when the first (fast, unmodified) detection
// pass finds literally zero faces — this app's photos are almost entirely action/sports
// (speed skating, cycling), where small, motion-blurred, or low-contrast faces (distant
// subjects, harsh outdoor lighting/shadows under helmets) are a common cause of the detector
// missing a face outright, as opposed to detecting-but-not-matching (which is a clustering/
// threshold concern, not a detection one — see faceClusteringClient.ts). Upscaling gives the
// detector's fixed-input-size model more effective pixels to work with for small/distant
// faces; the contrast/brightness boost helps recover faces lost in shadow (a full-face helmet
// visor, bright sky backgrounds common in outdoor rink/course photography). Only ever run as a
// SECOND pass (never first) since it roughly doubles detection cost per photo — most photos
// already detect fine on the first, cheap pass.
const RETRY_SCALE = 1.5;
const RETRY_CONTRAST = 1.3;
const RETRY_BRIGHTNESS = 1.15;
// Canvas dimensions are capped to avoid excessive memory/compute on already-large source images
// (the enhancement is aimed at recovering SMALL/distant faces, which benefit most from
// upscaling — an already-large image gains little from it and risks an oversized canvas).
const RETRY_MAX_DIMENSION = 3000;

/** Pure helper (no DOM) so the scale-selection logic is unit-testable without a real
 *  Image/canvas — returns the upscale factor to use, or a value <= 1 if upscaling wouldn't
 *  help (image already at/above RETRY_MAX_DIMENSION on its longest side). */
export function computeRetryScale(width: number, height: number): number {
  if (!width || !height) return 1;
  return Math.min(RETRY_SCALE, RETRY_MAX_DIMENSION / Math.max(width, height));
}

/** Source dimensions of whichever input type the first pass ran on. */
function inputSize(input: DetectInput): { width: number; height: number } {
  return input instanceof HTMLCanvasElement
    ? { width: input.width, height: input.height }
    : { width: input.naturalWidth, height: input.naturalHeight };
}

function buildEnhancedCanvas(input: DetectInput): HTMLCanvasElement | null {
  const { width: sourceWidth, height: sourceHeight } = inputSize(input);
  if (!sourceWidth || !sourceHeight) return null;

  const scale = computeRetryScale(sourceWidth, sourceHeight);
  if (scale <= 1) return null; // image is already large enough that upscaling wouldn't help

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.filter = `contrast(${RETRY_CONTRAST}) brightness(${RETRY_BRIGHTNESS})`;
  ctx.drawImage(input, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Pure helper (no DOM) so the cap logic is unit-testable: returns the factor to scale an
 *  image by so its longest side lands on DETECTION_MAX_DIMENSION, or 1 if it's already at
 *  or under the cap (never upscales — that would waste memory without adding detail). */
export function computeDetectionScale(width: number, height: number): number {
  if (!width || !height) return 1;
  return Math.min(1, DETECTION_MAX_DIMENSION / Math.max(width, height));
}

/** Frees a canvas's backing store immediately rather than waiting for GC — under the memory
 *  pressure this whole module is guarding against, "eventually" is too late. */
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Decodes `blob` to a canvas capped at DETECTION_MAX_DIMENSION.
 *
 * Uses createImageBitmap and closes the bitmap as soon as it has been drawn, so the
 * full-resolution pixels live in the browser's own image memory for a moment rather than
 * being held in an HTMLImageElement that stays alive for the entire multi-second detection.
 * Returns null when createImageBitmap is unavailable (jsdom in tests, very old WebViews) so
 * the caller can fall back to the plain <img> path.
 */
async function decodeCapped(blob: Blob): Promise<HTMLCanvasElement | null> {
  if (typeof createImageBitmap !== 'function') return null;

  const bitmap = await createImageBitmap(blob);
  try {
    const scale = computeDetectionScale(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      releaseCanvas(canvas);
      return null;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/** Loads a URL into an <img>. Fallback path only — see decodeCapped() for why this is not
 *  preferred (the element, and its full-resolution decoded pixels, stay alive for the whole
 *  detection). */
function loadImageElement(imageUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  return new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for face detection'));
    img.src = imageUrl;
  });
}

/**
 * Detects faces in `source` and returns their bounding boxes + embeddings. Returns an empty
 * array (never throws) on any failure — face detection is a best-effort enhancement, not a
 * critical path, and must never surface errors to the uploader.
 *
 * Prefer passing a Blob: all three callers already hold one, and it lets the decode go
 * through decodeCapped() (bounded memory, see DETECTION_MAX_DIMENSION). A string URL is
 * still accepted, and is loaded via a plain <img> without the cap.
 *
 * If the first pass finds zero faces, automatically retries ONCE against an upscaled/contrast-
 * enhanced version of the same image (see buildEnhancedCanvas() above) before giving up — this
 * specifically targets small/distant or harsh-lighting faces common in this app's action-sports
 * photos that the detector misses on a first pass over the unmodified image.
 */
export async function detectFaces(source: Blob | string): Promise<DetectedFace[]> {
  // Tracked so every canvas/element this pass allocates is released on the way out,
  // including on the error paths.
  const canvases: HTMLCanvasElement[] = [];
  let img: HTMLImageElement | null = null;

  try {
    const human = await loadHuman();

    let input: DetectInput | null = null;
    if (typeof source !== 'string') {
      const canvas = await decodeCapped(source);
      if (canvas) {
        canvases.push(canvas);
        input = canvas;
      }
    }
    if (!input) {
      // Either a URL was passed, or createImageBitmap isn't available.
      const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
      try {
        img = await loadImageElement(objectUrl ?? (source as string));
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
      input = img;
    }

    const detect = async (detectInput: DetectInput) => detectAndEmbedFaces(human, detectInput);

    const faces = await detect(input);
    if (faces.length > 0) return faces;

    const enhancedCanvas = buildEnhancedCanvas(input);
    if (!enhancedCanvas) return faces;
    canvases.push(enhancedCanvas);

    try {
      return await detect(enhancedCanvas);
    } catch (retryErr) {
      console.warn('[faceDetection] Enhanced retry pass failed:', retryErr);
      return faces;
    }
  } catch (err) {
    console.warn('[faceDetection] Failed to detect faces:', err);
    return [];
  } finally {
    canvases.forEach(releaseCanvas);
    if (img) img.src = '';
  }
}

