import { describe, expect, it } from 'vitest';
import { canvasToNCHW } from '../faceEmbeddingOnnx';

/**
 * Locks in the ArcFace preprocessing (raw 0..255 pixels, CHW planar layout, channel order) and
 * exercises the RGB-vs-BGR switch that the recognition-diagnostics work added. Production always
 * uses the default 'rgb' order (matching the reference notebook); 'bgr' exists only so a future
 * channel-order experiment is a measured, tested one-line change rather than a guess. See
 * faceEmbeddingOnnx.ts's doc comment.
 *
 * canvasToNCHW only touches canvas.getContext('2d'), ctx.getImageData(), and canvas.width/height,
 * so a tiny hand-built fake canvas is enough — no real DOM/canvas backend required.
 */
function fakeCanvas(width: number, height: number, rgba: number[]): HTMLCanvasElement {
  const data = new Uint8ClampedArray(rgba);
  return {
    width,
    height,
    getContext: () => ({
      getImageData: () => ({ data, width, height }),
    }),
  } as unknown as HTMLCanvasElement;
}

describe('canvasToNCHW preprocessing', () => {
  // Two pixels: pixel 0 = (R=10, G=20, B=30), pixel 1 = (R=40, G=50, B=60), alpha ignored.
  const rgba = [10, 20, 30, 255, 40, 50, 60, 255];

  it('default (rgb) produces planar [R..., G..., B...] with raw 0..255 values, no normalization', () => {
    const out = canvasToNCHW(fakeCanvas(2, 1, rgba));
    // plane = 2 pixels. R plane, then G plane, then B plane.
    expect(Array.from(out)).toEqual([10, 40, 20, 50, 30, 60]);
  });

  it('bgr swaps the first and third planes, leaving green in the middle', () => {
    const out = canvasToNCHW(fakeCanvas(2, 1, rgba), 'bgr');
    // B plane, then G plane, then R plane.
    expect(Array.from(out)).toEqual([30, 60, 20, 50, 10, 40]);
  });

  it('produces a tensor of length 3 * width * height', () => {
    const out = canvasToNCHW(fakeCanvas(2, 1, rgba));
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(3 * 2 * 1);
  });
});
