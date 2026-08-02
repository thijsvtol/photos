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

/**
 * Detects faces in the image at `imageUrl` (must be same-origin or a blob:
 * URL — see faceDetectionQueue.ts for how the caller ensures this) and
 * returns their bounding boxes + descriptors. Returns an empty array (never
 * throws) on any failure — face detection is a best-effort enhancement, not
 * a critical path, and must never surface errors to the uploader.
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

    const result = await human.detect(img);

    return result.face
      .filter((face) => Array.isArray(face.embedding) && face.embedding.length > 0)
      .map((face) => {
        const [x, y, width, height] = face.box;
        return {
          embedding: face.embedding as number[],
          bbox: { x, y, width, height },
        };
      });
  } catch (err) {
    console.warn('[faceDetection] Failed to detect faces:', err);
    return [];
  }
}
