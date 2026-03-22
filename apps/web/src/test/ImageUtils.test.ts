import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for Instagram image processing logic
 * Validates that processForInstagram always produces a fixed 4:5 (1080×1350) canvas
 * with at least 3% white border on all sides.
 */

describe('processForInstagram', () => {
  let mockCtx: Record<string, any>;
  let mockCanvas: Record<string, any>;

  beforeEach(() => {
    mockCtx = {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: '',
    };
    mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockCtx),
      toBlob: vi.fn((cb: (blob: Blob | null) => void) => {
        cb(new Blob(['test'], { type: 'image/jpeg' }));
      }),
    };

    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return mockCanvas as any;
      return document.createElement(tag);
    });
  });

  function setupImage(width: number, height: number) {
    // Mock global Image constructor
    const originalImage = global.Image;
    (global as any).Image = class {
      width = width;
      height = height;
      crossOrigin = '';
      src = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() {
        // Trigger onload asynchronously after src is set
        const self = this;
        let _src = '';
        Object.defineProperty(this, 'src', {
          get() { return _src; },
          set(val: string) {
            _src = val;
            setTimeout(() => {
              if (self.onload) self.onload();
            }, 0);
          },
        });
      }
    };
    return () => { (global as any).Image = originalImage; };
  }

  it('should always produce a 1080×1350 canvas (4:5 portrait)', async () => {
    const restore = setupImage(3000, 2000); // landscape 3:2 image
    try {
      const { processForInstagram } = await import('../imageUtils');
      await processForInstagram('http://example.com/test.jpg');

      expect(mockCanvas.width).toBe(1080);
      expect(mockCanvas.height).toBe(1350);
    } finally {
      restore();
    }
  });

  it('should always produce 1080×1350 for a portrait image', async () => {
    const restore = setupImage(800, 1200); // portrait 2:3
    try {
      const { processForInstagram } = await import('../imageUtils');
      await processForInstagram('http://example.com/portrait.jpg');

      expect(mockCanvas.width).toBe(1080);
      expect(mockCanvas.height).toBe(1350);
    } finally {
      restore();
    }
  });

  it('should always produce 1080×1350 for a square image', async () => {
    const restore = setupImage(2000, 2000); // square 1:1
    try {
      const { processForInstagram } = await import('../imageUtils');
      await processForInstagram('http://example.com/square.jpg');

      expect(mockCanvas.width).toBe(1080);
      expect(mockCanvas.height).toBe(1350);
    } finally {
      restore();
    }
  });

  it('should fill canvas with white background', async () => {
    const restore = setupImage(2000, 1000);
    try {
      const { processForInstagram } = await import('../imageUtils');
      await processForInstagram('http://example.com/test.jpg');

      expect(mockCtx.fillStyle).toBe('#ffffff');
      expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 1080, 1350);
    } finally {
      restore();
    }
  });

  it('should ensure at least 3% border on all sides', async () => {
    const restore = setupImage(2000, 1000); // landscape
    try {
      const { processForInstagram } = await import('../imageUtils');
      await processForInstagram('http://example.com/test.jpg');

      const drawCall = mockCtx.drawImage.mock.calls[0];
      // drawImage(img, offsetX, offsetY, drawWidth, drawHeight)
      const [, offsetX, offsetY, drawWidth, drawHeight] = drawCall;

      const minBorderX = 1080 * 0.03;
      const minBorderY = 1350 * 0.03;

      // Left border
      expect(offsetX).toBeGreaterThanOrEqual(minBorderX - 1); // allow rounding
      // Right border
      expect(1080 - (offsetX + drawWidth)).toBeGreaterThanOrEqual(minBorderX - 1);
      // Top border
      expect(offsetY).toBeGreaterThanOrEqual(minBorderY - 1);
      // Bottom border
      expect(1350 - (offsetY + drawHeight)).toBeGreaterThanOrEqual(minBorderY - 1);
    } finally {
      restore();
    }
  });

  it('should enable high-quality image smoothing', async () => {
    const restore = setupImage(2000, 1000);
    try {
      const { processForInstagram } = await import('../imageUtils');
      await processForInstagram('http://example.com/test.jpg');

      expect(mockCtx.imageSmoothingEnabled).toBe(true);
      expect(mockCtx.imageSmoothingQuality).toBe('high');
    } finally {
      restore();
    }
  });

  it('should export as JPEG at 0.95 quality', async () => {
    const restore = setupImage(2000, 1000);
    try {
      const { processForInstagram } = await import('../imageUtils');
      await processForInstagram('http://example.com/test.jpg');

      expect(mockCanvas.toBlob).toHaveBeenCalledWith(
        expect.any(Function),
        'image/jpeg',
        0.95
      );
    } finally {
      restore();
    }
  });

  it('should centre the image on the canvas', async () => {
    const restore = setupImage(1000, 1000); // square image
    try {
      const { processForInstagram } = await import('../imageUtils');
      await processForInstagram('http://example.com/square.jpg');

      const drawCall = mockCtx.drawImage.mock.calls[0];
      const [, offsetX, offsetY, drawWidth, drawHeight] = drawCall;

      // Image should be horizontally and vertically centred
      const expectedOffsetX = Math.round((1080 - drawWidth) / 2);
      const expectedOffsetY = Math.round((1350 - drawHeight) / 2);

      expect(offsetX).toBe(expectedOffsetX);
      expect(offsetY).toBe(expectedOffsetY);
    } finally {
      restore();
    }
  });
});
