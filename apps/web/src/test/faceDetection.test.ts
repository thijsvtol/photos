import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the "retry once on an enhanced image if zero faces found" logic added to
 * detectFaces() (2026-08-03) — targets small/distant or harsh-lighting faces common in this
 * app's action-sports (speed skating, cycling) photos that the detector misses on a first pass
 * over the unmodified image.
 */

describe('computeDetectionScale', () => {
  it('leaves an image at or under the 1920px cap untouched', async () => {
    const { computeDetectionScale } = await import('../faceDetection');
    expect(computeDetectionScale(1920, 1080)).toBe(1);
    expect(computeDetectionScale(800, 600)).toBe(1);
  });

  it('downscales so the LONGEST side lands on the cap, whichever axis that is', async () => {
    const { computeDetectionScale } = await import('../faceDetection');
    // 4032x3024 (a typical 12MP phone photo) -> 1920/4032
    expect(computeDetectionScale(4032, 3024)).toBeCloseTo(1920 / 4032, 5);
    // Portrait: the cap applies to height instead.
    expect(computeDetectionScale(3024, 4032)).toBeCloseTo(1920 / 4032, 5);
  });

  it('bounds a 108MP original hard enough to matter', async () => {
    const { computeDetectionScale } = await import('../faceDetection');
    // 12000x9000. Decoded RGBA that is ~430MB, which is what killed the renderer;
    // after scaling the longest side is the cap, i.e. ~1920x1440 (~11MB).
    const scale = computeDetectionScale(12000, 9000);
    expect(Math.round(12000 * scale)).toBe(1920);
  });

  it('returns 1 for zero/missing dimensions instead of dividing by zero', async () => {
    const { computeDetectionScale } = await import('../faceDetection');
    expect(computeDetectionScale(0, 0)).toBe(1);
  });
});

describe('computeRetryScale', () => {
  it('now genuinely upscales a capped (1920px) input, which it could not do on originals', async () => {
    const { computeRetryScale } = await import('../faceDetection');
    // Before the DETECTION_MAX_DIMENSION cap, first-pass input was the full original, so any
    // photo >=3000px got a scale <=1 and the enhanced retry silently never ran. Detection now
    // always runs at <=1920px, so the retry pass actually engages.
    expect(computeRetryScale(1920, 1080)).toBe(1.5);
  });


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

/**
 * Memory-bounding behaviour added 2026-08-08 after the Android WebView's renderer process ran
 * out of memory and killed the whole app during bulk uploads. The contract these lock in:
 * detection input is capped, and nothing large stays alive after a pass.
 */
describe('detectFaces memory bounding', () => {
  const detectMock = vi.fn();
  const closeMock = vi.fn();
  let createdCanvases: HTMLCanvasElement[] = [];

  beforeEach(() => {
    vi.resetModules();
    detectMock.mockReset().mockResolvedValue({ face: [] });
    closeMock.mockReset();
    createdCanvases = [];

    vi.doMock('@vladmandic/human', () => ({
      Human: class {
        load = vi.fn().mockResolvedValue(undefined);
        detect = detectMock;
      },
    }));
    vi.doMock('../faceAlignment', () => ({ alignFace: vi.fn() }));
    vi.doMock('../faceEmbeddingOnnx', () => ({ computeFaceEmbedding: vi.fn() }));

    vi.spyOn(global.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      filter: '',
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    } as unknown as CanvasRenderingContext2D);

    // Track every canvas the module allocates so the release assertions can inspect them.
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...rest: unknown[]) => {
      const el = realCreateElement(tag, ...(rest as []));
      if (tag === 'canvas') createdCanvases.push(el as HTMLCanvasElement);
      return el;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Removed between cases so the fallback-path test sees it genuinely absent.
    delete (global as unknown as { createImageBitmap?: unknown }).createImageBitmap;
  });

  /** jsdom has no createImageBitmap; stand in one reporting the given source dimensions. */
  function stubCreateImageBitmap(width: number, height: number) {
    const bitmap = { width, height, close: closeMock };
    const fn = vi.fn().mockResolvedValue(bitmap);
    // Cast rather than @ts-expect-error: the global's real signature is overloaded, and
    // whether an assignment errors varies with the lib.dom version in use.
    (global as unknown as { createImageBitmap: unknown }).createImageBitmap = fn;
    return fn;
  }

  it('caps a large original to 1920px on its longest side before detecting', async () => {
    stubCreateImageBitmap(12000, 9000);
    // Dimensions must be read DURING the pass — the canvas is zeroed on the way out.
    const sizeAtDetect: Array<{ width: number; height: number }> = [];
    detectMock.mockImplementation(async (input: HTMLCanvasElement) => {
      sizeAtDetect.push({ width: input.width, height: input.height });
      return { face: [] };
    });
    const { detectFaces } = await import('../faceDetection');

    await detectFaces(new Blob(['x'], { type: 'image/jpeg' }));

    // 12000x9000 is ~430MB decoded as RGBA — the size that killed the renderer.
    expect(sizeAtDetect[0]).toEqual({ width: 1920, height: 1440 });
  });

  it('leaves an already-small image at its native size', async () => {
    stubCreateImageBitmap(1600, 1200);
    const sizeAtDetect: Array<{ width: number; height: number }> = [];
    detectMock.mockImplementation(async (input: HTMLCanvasElement) => {
      sizeAtDetect.push({ width: input.width, height: input.height });
      return { face: [] };
    });
    const { detectFaces } = await import('../faceDetection');

    await detectFaces(new Blob(['x'], { type: 'image/jpeg' }));

    expect(sizeAtDetect[0]).toEqual({ width: 1600, height: 1200 });
  });

  it('closes the decoded bitmap immediately rather than holding it for the whole pass', async () => {
    stubCreateImageBitmap(4032, 3024);
    const { detectFaces } = await import('../faceDetection');

    await detectFaces(new Blob(['x'], { type: 'image/jpeg' }));

    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('releases every canvas it allocated once the pass finishes', async () => {
    stubCreateImageBitmap(4032, 3024);
    const { detectFaces } = await import('../faceDetection');

    await detectFaces(new Blob(['x'], { type: 'image/jpeg' }));

    expect(createdCanvases.length).toBeGreaterThan(0);
    // width/height zeroed is the documented way to drop a canvas's backing store.
    for (const canvas of createdCanvases) {
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
    }
  });

  it('releases canvases even when detection throws', async () => {
    stubCreateImageBitmap(4032, 3024);
    detectMock.mockRejectedValue(new Error('detect boom'));
    const { detectFaces } = await import('../faceDetection');

    const faces = await detectFaces(new Blob(['x'], { type: 'image/jpeg' }));

    expect(faces).toEqual([]);
    expect(closeMock).toHaveBeenCalledTimes(1);
    for (const canvas of createdCanvases) {
      expect(canvas.width).toBe(0);
    }
  });

  it('falls back to the <img> path when createImageBitmap is unavailable', async () => {
    // No stubCreateImageBitmap() call — mirrors an old WebView.
    Object.defineProperty(global.Image.prototype, 'src', {
      configurable: true,
      set(this: HTMLImageElement, _value: string) {
        Object.defineProperty(this, 'naturalWidth', { value: 800, configurable: true });
        Object.defineProperty(this, 'naturalHeight', { value: 600, configurable: true });
        queueMicrotask(() => this.onload?.(new Event('load')));
      },
    });
    const { detectFaces } = await import('../faceDetection');

    await detectFaces(new Blob(['x'], { type: 'image/jpeg' }));

    expect(detectMock).toHaveBeenCalled();
    expect(detectMock.mock.calls[0][0]).toBeInstanceOf(global.Image);
  });
});
