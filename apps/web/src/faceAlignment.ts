/**
 * Face alignment for the ArcFace-style recognition embedding (see faceEmbeddingOnnx.ts) —
 * ArcFace/InsightFace models are trained on a fixed 112x112 crop where 5 facial landmarks
 * (left eye, right eye, nose tip, left mouth corner, right mouth corner) are warped to a
 * standard reference template via a similarity transform (uniform scale + rotation +
 * translation, no shear/reflection) — see the official onnx/models ArcFace
 * `dependencies/face_preprocess.py`'s `preprocess()` function, which this module ports.
 *
 * @vladmandic/human's FaceMesh (468-point MediaPipe topology, `face.mesh`) doesn't directly
 * output the same "5 keypoints" MTCNN produces, but the required points can be derived from
 * well-known fixed MediaPipe FaceMesh vertex indices:
 *   - eye centers: average of each eye's inner/outer corner (33/133 and 362/263)
 *   - nose tip: index 1
 *   - mouth corners: 61 and 291
 * "Left"/"right" here means LEFT-OF-IMAGE and RIGHT-OF-IMAGE (not the subject's own left/
 * right), decided by comparing x-coordinates — this avoids relying on an assumption about
 * which literal MediaPipe index is anatomically which eye for a mirrored/rotated face, and
 * matches how the eyes are naturally ordered when a face is roughly upright.
 */

export type Point2D = [number, number];

// Standard 112x112 ArcFace reference template (onnx/models face_preprocess.py's `src`,
// with the +8.0 x-offset already applied for the 112-wide variant).
const REFERENCE_TEMPLATE: Point2D[] = [
  [38.2946, 51.6963], // left-of-image eye
  [73.5318, 51.5014], // right-of-image eye
  [56.0252, 71.7366], // nose tip
  [41.5493, 92.3655], // left-of-image mouth corner
  [70.7299, 92.2041], // right-of-image mouth corner
];

export const ALIGNED_FACE_SIZE = 112;

/** Extracts the 5 alignment keypoints from a Human FaceMesh (468-point) result, ordered to
 *  match REFERENCE_TEMPLATE (left-of-image eye, right-of-image eye, nose, left-of-image mouth
 *  corner, right-of-image mouth corner). `mesh` entries are [x, y, z] tuples in image pixel
 *  space (Human's mesh output). */
export function meshToFivePoints(mesh: Array<[number, number, number] | number[]>): Point2D[] {
  const p = (i: number): Point2D => [mesh[i][0], mesh[i][1]];
  const midpoint = (a: Point2D, b: Point2D): Point2D => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  const eyeA = midpoint(p(33), p(133));
  const eyeB = midpoint(p(362), p(263));
  const [leftEye, rightEye] = eyeA[0] <= eyeB[0] ? [eyeA, eyeB] : [eyeB, eyeA];

  const mouthA = p(61);
  const mouthB = p(291);
  const [leftMouth, rightMouth] = mouthA[0] <= mouthB[0] ? [mouthA, mouthB] : [mouthB, mouthA];

  const nose = p(1);

  return [leftEye, rightEye, nose, leftMouth, rightMouth];
}

/** The 4 parameters of a non-reflective 2D similarity transform: (x,y) -> (a*x - b*y + tx,
 *  b*x + a*y + ty). This form (using a single shared `a`/`b` pair for both axes, rather than
 *  4 independent affine coefficients) constrains the fit to pure uniform-scale + rotation +
 *  translation — never a reflection or shear — matching skimage's `SimilarityTransform` used
 *  by the reference ArcFace preprocessing. */
export interface SimilarityTransform {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

/**
 * Least-squares fit of a non-reflective similarity transform mapping `src` points onto `dst`
 * points (exactly the pairing order used by skimage's `tform.estimate(dst, src)` in the
 * reference implementation — here `src` is this function's `src` param, `dst` is `dst`).
 * Closed-form via the normal equations of the linear system
 *   a*x_i - b*y_i + tx = dst_x_i
 *   b*x_i + a*y_i + ty = dst_y_i
 * (4 unknowns a,b,tx,ty; 2 equations per point, exact for >=2 non-degenerate points) — this is
 * mathematically equivalent to the Umeyama algorithm for the same non-reflective-similarity
 * constraint, without needing a general SVD implementation.
 */
export function solveSimilarityTransform(src: Point2D[], dst: Point2D[]): SimilarityTransform {
  // Accumulate raw sums once, then derive the CENTERED cross/variance sums algebraically
  // (sum((x-mx)*(dx-mdx)) = sum(x*dx) - sum(x)*sum(dx)/n, etc.) — mathematically required
  // for a correct least-squares fit of (a,b) (fitting on un-centered sums instead would bias
  // the rotation/scale estimate whenever the point sets aren't already zero-mean), while
  // still only needing a single pass over the points.
  let sumXX = 0, sumYY = 0, sumX = 0, sumY = 0, n = 0;
  let sumXDx = 0, sumYDx = 0, sumDx = 0;
  let sumXDy = 0, sumYDy = 0, sumDy = 0;

  for (let i = 0; i < src.length; i++) {
    const [x, y] = src[i];
    const [dx, dy] = dst[i];
    sumXX += x * x;
    sumYY += y * y;
    sumX += x;
    sumY += y;
    n += 1;
    sumXDx += x * dx;
    sumYDx += y * dx;
    sumDx += dx;
    sumXDy += x * dy;
    sumYDy += y * dy;
    sumDy += dy;
  }

  const centeredXX = sumXX - (sumX * sumX) / n;
  const centeredYY = sumYY - (sumY * sumY) / n;
  const centeredXDx = sumXDx - (sumX * sumDx) / n;
  const centeredYDy = sumYDy - (sumY * sumDy) / n;
  const centeredXDy = sumXDy - (sumX * sumDy) / n;
  const centeredYDx = sumYDx - (sumY * sumDx) / n;

  // Closed-form least-squares fit of a non-reflective 2D similarity transform (see e.g.
  // Umeyama 1991, restricted to this parameterization) — derived by substituting the
  // (tx,ty)-eliminated, centroid-relative residuals into the sum-of-squares objective and
  // solving the resulting 2x2 normal equations for (a,b) directly.
  const denom = centeredXX + centeredYY;
  const a = (centeredXDx + centeredYDy) / denom;
  const b = (centeredXDy - centeredYDx) / denom;
  const tx = (sumDx - a * sumX + b * sumY) / n;
  const ty = (sumDy - b * sumX - a * sumY) / n;

  return { a, b, tx, ty };
}

/**
 * Produces a 112x112 aligned face crop from the original image, given Human's FaceMesh
 * landmarks — draws the ORIGINAL (unmodified pixel values, matching the reference
 * preprocessing which does NOT normalize to 0..1 or subtract a mean) image onto a 112x112
 * canvas using the fitted similarity transform, via Canvas2D's `setTransform` (whose matrix
 * convention `(a, b, c, d, e, f)` mapping `(x,y) -> (a*x + c*y + e, b*x + d*y + f)` exactly
 * matches our `(a, b, tx, ty)` representation with `c = -b`, `d = a`).
 */
export function alignFace(
  image: HTMLImageElement | HTMLCanvasElement,
  mesh: Array<[number, number, number] | number[]>
): HTMLCanvasElement {
  const points = meshToFivePoints(mesh);
  const { a, b, tx, ty } = solveSimilarityTransform(points, REFERENCE_TEMPLATE);

  const canvas = document.createElement('canvas');
  canvas.width = ALIGNED_FACE_SIZE;
  canvas.height = ALIGNED_FACE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('alignFace: 2D canvas context unavailable');

  ctx.setTransform(a, b, -b, a, tx, ty);
  ctx.drawImage(image, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0); // reset for any future draws on this canvas

  return canvas;
}
