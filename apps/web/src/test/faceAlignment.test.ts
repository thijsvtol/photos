import { describe, expect, it } from 'vitest';
import { solveSimilarityTransform, meshToFivePoints } from '../faceAlignment';

/**
 * Tests for the closed-form non-reflective similarity transform solver used to align a face
 * to the standard 112x112 ArcFace template (see faceAlignment.ts's doc comment). Verified
 * against SYNTHETIC data with a KNOWN ground-truth transform (scale/rotate/translate a set of
 * points, then check the solver recovers the same parameters) — this is the only way to trust
 * the math without being able to visually verify real face alignment output in this
 * environment.
 */
describe('solveSimilarityTransform', () => {
  it('recovers an exact identity transform (a=1, b=0, tx=0, ty=0) when src === dst', () => {
    const points: [number, number][] = [
      [10, 20],
      [50, 20],
      [30, 40],
      [15, 60],
      [45, 60],
    ];

    const { a, b, tx, ty } = solveSimilarityTransform(points, points);

    expect(a).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(0, 5);
    expect(tx).toBeCloseTo(0, 5);
    expect(ty).toBeCloseTo(0, 5);
  });

  it('recovers a known pure translation', () => {
    const src: [number, number][] = [
      [10, 20],
      [50, 20],
      [30, 40],
      [15, 60],
      [45, 60],
    ];
    const dst: [number, number][] = src.map(([x, y]) => [x + 7, y - 3]);

    const { a, b, tx, ty } = solveSimilarityTransform(src, dst);

    expect(a).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(0, 5);
    expect(tx).toBeCloseTo(7, 5);
    expect(ty).toBeCloseTo(-3, 5);
  });

  it('recovers a known uniform scale', () => {
    const src: [number, number][] = [
      [10, 20],
      [50, 20],
      [30, 40],
      [15, 60],
      [45, 60],
    ];
    const scale = 2.5;
    const dst: [number, number][] = src.map(([x, y]) => [x * scale, y * scale]);

    const { a, b, tx, ty } = solveSimilarityTransform(src, dst);

    expect(a).toBeCloseTo(scale, 5);
    expect(b).toBeCloseTo(0, 5);
    expect(tx).toBeCloseTo(0, 4);
    expect(ty).toBeCloseTo(0, 4);
  });

  it('recovers a known rotation + scale + translation combined (the general case)', () => {
    const src: [number, number][] = [
      [10, 20],
      [50, 20],
      [30, 40],
      [15, 60],
      [45, 60],
    ];
    const scale = 1.8;
    const angle = Math.PI / 6; // 30 degrees
    const trueA = scale * Math.cos(angle);
    const trueB = scale * Math.sin(angle);
    const trueTx = 12;
    const trueTy = -8;
    // Apply the SAME forward model this module fits: (x,y) -> (a*x - b*y + tx, b*x + a*y + ty)
    const dst: [number, number][] = src.map(([x, y]) => [
      trueA * x - trueB * y + trueTx,
      trueB * x + trueA * y + trueTy,
    ]);

    const { a, b, tx, ty } = solveSimilarityTransform(src, dst);

    expect(a).toBeCloseTo(trueA, 5);
    expect(b).toBeCloseTo(trueB, 5);
    expect(tx).toBeCloseTo(trueTx, 4);
    expect(ty).toBeCloseTo(trueTy, 4);
  });

  it('finds a good least-squares fit even with slightly noisy correspondences (not an exact solve)', () => {
    const src: [number, number][] = [
      [10, 20],
      [50, 20],
      [30, 40],
      [15, 60],
      [45, 60],
    ];
    const trueA = 1.2;
    const trueB = 0.3;
    const trueTx = 5;
    const trueTy = 5;
    const noise = [
      [0.5, -0.5],
      [-0.3, 0.2],
      [0.1, 0.1],
      [-0.4, 0.3],
      [0.2, -0.2],
    ];
    const dst: [number, number][] = src.map(([x, y], i) => [
      trueA * x - trueB * y + trueTx + noise[i][0],
      trueB * x + trueA * y + trueTy + noise[i][1],
    ]);

    const { a, b, tx, ty } = solveSimilarityTransform(src, dst);

    // With small noise, the fitted parameters should still land close to the true ones.
    expect(a).toBeCloseTo(trueA, 1);
    expect(b).toBeCloseTo(trueB, 1);
    expect(tx).toBeCloseTo(trueTx, 0);
    expect(ty).toBeCloseTo(trueTy, 0);
  });
});

describe('meshToFivePoints', () => {
  it('orders eyes and mouth corners by x-coordinate (left-of-image first) regardless of MediaPipe index handedness', () => {
    // Build a minimal fake 468-point mesh (all zeros) and only populate the indices this
    // function actually reads, at exact synthetic coordinates so left/right ordering is
    // unambiguous.
    const mesh: number[][] = Array.from({ length: 468 }, () => [0, 0, 0]);
    // Right-of-image eye corners (higher x) placed at indices 362/263.
    mesh[362] = [80, 50, 0];
    mesh[263] = [90, 50, 0];
    // Left-of-image eye corners (lower x) placed at indices 33/133.
    mesh[33] = [20, 50, 0];
    mesh[133] = [30, 50, 0];
    mesh[1] = [55, 70, 0]; // nose
    mesh[61] = [25, 90, 0]; // left-of-image mouth corner
    mesh[291] = [85, 90, 0]; // right-of-image mouth corner

    const [leftEye, rightEye, nose, leftMouth, rightMouth] = meshToFivePoints(mesh);

    expect(leftEye[0]).toBeLessThan(rightEye[0]);
    expect(leftMouth[0]).toBeLessThan(rightMouth[0]);
    expect(nose).toEqual([55, 70]);
  });
});
