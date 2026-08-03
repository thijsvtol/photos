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
 * Human's face descriptor ("embedding") is a 1024-element array (NOT the
 * 128-dim face-api.js used) — see faceValidation.ts (worker) which validates
 * this length, and faceClustering.ts (worker) which uses Human's own
 * documented distance/similarity formula (ported from
 * vladmandic/human/src/face/match.ts, MIT licensed) so the "same person"
 * threshold matches the library author's own guidance rather than a
 * guessed number.
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

const MODEL_URL = '/models';

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
          description: { enabled: true },
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
  /** 1024-dim face descriptor from Human's FaceRes description model. */
  embedding: number[];
  bbox: { x: number; y: number; width: number; height: number };
}

type HumanInstance = import('@vladmandic/human').Human;
type DetectInput = HTMLImageElement | HTMLCanvasElement;

function mapResultToFaces(result: Awaited<ReturnType<HumanInstance['detect']>>): DetectedFace[] {
  return result.face
    .filter((face) => Array.isArray(face.embedding) && face.embedding.length > 0)
    .map((face) => {
      const [x, y, width, height] = face.box;
      return {
        embedding: face.embedding as number[],
        bbox: { x, y, width, height },
      };
    });
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

function buildEnhancedCanvas(img: HTMLImageElement): HTMLCanvasElement | null {
  const naturalWidth = img.naturalWidth;
  const naturalHeight = img.naturalHeight;
  if (!naturalWidth || !naturalHeight) return null;

  const scale = computeRetryScale(naturalWidth, naturalHeight);
  if (scale <= 1) return null; // image is already large enough that upscaling wouldn't help

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(naturalWidth * scale);
  canvas.height = Math.round(naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.filter = `contrast(${RETRY_CONTRAST}) brightness(${RETRY_BRIGHTNESS})`;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Detects faces in the image at `imageUrl` (must be same-origin or a blob:
 * URL — see faceDetectionQueue.ts for how the caller ensures this) and
 * returns their bounding boxes + descriptors. Returns an empty array (never
 * throws) on any failure — face detection is a best-effort enhancement, not
 * a critical path, and must never surface errors to the uploader.
 *
 * If the first pass finds zero faces, automatically retries ONCE against an upscaled/contrast-
 * enhanced version of the same image (see buildEnhancedCanvas() above) before giving up — this
 * specifically targets small/distant or harsh-lighting faces common in this app's action-sports
 * photos that the detector misses on a first pass over the unmodified image.
 */
export async function detectFaces(imageUrl: string): Promise<DetectedFace[]> {
  try {
    const human = await loadHuman();

    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image for face detection'));
      img.src = imageUrl;
    });

    const detect = async (input: DetectInput) => mapResultToFaces(await human.detect(input));

    const faces = await detect(img);
    if (faces.length > 0) return faces;

    const enhancedCanvas = buildEnhancedCanvas(img);
    if (!enhancedCanvas) return faces;

    try {
      return await detect(enhancedCanvas);
    } catch (retryErr) {
      console.warn('[faceDetection] Enhanced retry pass failed:', retryErr);
      return faces;
    }
  } catch (err) {
    console.warn('[faceDetection] Failed to detect faces:', err);
    return [];
  }
}

