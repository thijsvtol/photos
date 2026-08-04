import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Tests for the "retry once on an enhanced image if zero faces found" logic added to
 * detectFaces() (2026-08-03) — targets small/distant or harsh-lighting faces common in this
 * app's action-sports (speed skating, cycling) photos that the detector misses on a first pass
 * over the unmodified image.
 */

describe('computeRetryScale', () => {
  it('returns the standard 1.5x upscale for a normal-sized image', async () => {
    const { computeRetryScale } = await import('../faceDetection');
    expect(computeRetryScale(800, 600)).toBe(1.5);
  });

  it('caps the scale so the longest side never exceeds RETRY_MAX_DIMENSION (3000)', async () => {
    const { computeRetryScale } = await import('../faceDetection');
    // 2500 * 1.5 = 3750 > 3000, so scale must be capped to 3000/2500 = 1.2.
    expect(computeRetryScale(2500, 2000)).toBeCloseTo(1.2, 5);
  });

  it('returns <= 1 (no upscaling) for an image already at/above the cap', async () => {
    const { computeRetryScale } = await import('../faceDetection');
    expect(computeRetryScale(4000, 3000)).toBeLessThanOrEqual(1);
  });

  it('returns 1 for zero/missing dimensions instead of dividing by zero', async () => {
    const { computeRetryScale } = await import('../faceDetection');
    expect(computeRetryScale(0, 0)).toBe(1);
  });
});

describe('detectFaces retry-on-empty-result behavior', () => {
  const detectMock = vi.fn();
  const loadMock = vi.fn().mockResolvedValue(undefined);
  const alignFaceMock = vi.fn().mockReturnValue('fake-aligned-canvas');
  const computeFaceEmbeddingMock = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);

  beforeEach(() => {
    vi.resetModules();
    detectMock.mockReset();
    loadMock.mockClear();
    alignFaceMock.mockClear();
    computeFaceEmbeddingMock.mockClear();

    vi.doMock('@vladmandic/human', () => ({
      Human: class {
        load = loadMock;
        detect = detectMock;
      },
    }));
    // Human's own embedding is no longer used (see faceDetection.ts's doc comment) —
    // detection just needs to produce a bbox + mesh; alignment/embedding are mocked out
    // separately below since they depend on real canvas pixel data + ONNX inference, neither
    // available in jsdom.
    vi.doMock('../faceAlignment', () => ({ alignFace: alignFaceMock }));
    vi.doMock('../faceEmbeddingOnnx', () => ({ computeFaceEmbedding: computeFaceEmbeddingMock }));

    // jsdom's <img> never actually loads a real image, so make src assignment
    // synchronously fire onload (like a cached/instant local image) and give it fake
    // dimensions so computeRetryScale() has something to work with.
    Object.defineProperty(global.Image.prototype, 'src', {
      configurable: true,
      set(this: HTMLImageElement, _value: string) {
        Object.defineProperty(this, 'naturalWidth', { value: 800, configurable: true });
        Object.defineProperty(this, 'naturalHeight', { value: 600, configurable: true });
        queueMicrotask(() => this.onload?.(new Event('load')));
      },
    });

    // jsdom doesn't implement canvas 2d contexts (no 'canvas' npm package installed) — stub
    // just enough of the API buildEnhancedCanvas() touches so the retry path can run.
    vi.spyOn(global.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      filter: '',
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  function faceResult(count: number) {
    return {
      face: Array.from({ length: count }, (_, i) => ({
        mesh: [[i, i, 0]], // presence is all detectAndEmbedFaces() checks; contents are opaque
        box: [0, 0, 10, 10],
      })),
    };
  }

  it('returns faces from the first pass without retrying when faces are found', async () => {
    detectMock.mockResolvedValue(faceResult(1));
    const { detectFaces } = await import('../faceDetection');

    const faces = await detectFaces('blob://fake.jpg');

    expect(faces).toHaveLength(1);
    expect(detectMock).toHaveBeenCalledTimes(1);
  });

  it('retries once against an enhanced canvas when the first pass finds zero faces', async () => {
    detectMock.mockResolvedValueOnce(faceResult(0)).mockResolvedValueOnce(faceResult(1));
    const { detectFaces } = await import('../faceDetection');

    const faces = await detectFaces('blob://fake.jpg');

    expect(faces).toHaveLength(1);
    expect(detectMock).toHaveBeenCalledTimes(2);
    // Second call's input should be a canvas (the enhanced retry), not the original <img>.
    const secondCallInput = detectMock.mock.calls[1][0];
    expect(secondCallInput).toBeInstanceOf(global.HTMLCanvasElement);
  });

  it('returns an empty array (not an error) if both the original and retry pass find nothing', async () => {
    detectMock.mockResolvedValue(faceResult(0));
    const { detectFaces } = await import('../faceDetection');

    const faces = await detectFaces('blob://fake.jpg');

    expect(faces).toEqual([]);
    expect(detectMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the (empty) first-pass result if the retry pass itself throws', async () => {
    detectMock.mockResolvedValueOnce(faceResult(0)).mockRejectedValueOnce(new Error('retry boom'));
    const { detectFaces } = await import('../faceDetection');

    const faces = await detectFaces('blob://fake.jpg');

    expect(faces).toEqual([]);
  });

  it('aligns and embeds each detected face via the ArcFace pipeline instead of using a Human-provided embedding', async () => {
    detectMock.mockResolvedValue(faceResult(1));
    const { detectFaces } = await import('../faceDetection');

    const faces = await detectFaces('blob://fake.jpg');

    expect(faces).toEqual([{ embedding: [0.1, 0.2, 0.3], bbox: { x: 0, y: 0, width: 10, height: 10 } }]);
    expect(alignFaceMock).toHaveBeenCalledTimes(1);
    expect(computeFaceEmbeddingMock).toHaveBeenCalledWith('fake-aligned-canvas');
  });

  it('skips a detected face with no mesh landmarks (alignment is impossible without them) instead of throwing', async () => {
    detectMock.mockResolvedValue({ face: [{ box: [0, 0, 10, 10] }] }); // no `mesh` property
    const { detectFaces } = await import('../faceDetection');

    const faces = await detectFaces('blob://fake.jpg');

    expect(faces).toEqual([]);
    expect(alignFaceMock).not.toHaveBeenCalled();
  });

  it('skips a face whose alignment/embedding throws, without failing the whole detection pass', async () => {
    alignFaceMock.mockImplementationOnce(() => {
      throw new Error('alignment boom');
    });
    // Two faces in one pass: the first's alignment throws, the second succeeds normally —
    // proves one bad face doesn't abort/skip the rest of the same detection pass.
    detectMock.mockResolvedValue(faceResult(2));
    const { detectFaces } = await import('../faceDetection');

    const faces = await detectFaces('blob://fake.jpg');

    expect(faces).toEqual([{ embedding: [0.1, 0.2, 0.3], bbox: { x: 0, y: 0, width: 10, height: 10 } }]);
  });
});
