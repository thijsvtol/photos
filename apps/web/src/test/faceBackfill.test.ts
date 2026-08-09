import { describe, expect, it, vi, beforeEach } from 'vitest';

const getFacesPendingPhotosMock = vi.fn();
const saveBackfilledFacesMock = vi.fn();
const getPreviewUrlMock = vi.fn((..._args: unknown[]) => 'https://example.com/preview.jpg');
const detectFacesMock = vi.fn();

vi.mock('../api', () => ({
  getFacesPendingPhotos: (limit?: number) => getFacesPendingPhotosMock(limit),
  saveBackfilledFaces: (photoId: string, faces: unknown) => saveBackfilledFacesMock(photoId, faces),
  getPreviewUrl: (slug: string, photoId: string, fileType?: string, cacheVersion?: number) =>
    getPreviewUrlMock(slug, photoId, fileType, cacheVersion),
}));

vi.mock('../faceDetection', () => ({
  detectFaces: (source: Blob | string) => detectFacesMock(source),
}));

import { runBackfillScan } from '../faceBackfill';

const photo = (id: string) => ({ id, file_type: 'image/jpeg', cache_version: 1, event_slug: 'my-event' });

beforeEach(() => {
  getFacesPendingPhotosMock.mockReset();
  saveBackfilledFacesMock.mockReset();
  detectFacesMock.mockReset();
  getPreviewUrlMock.mockClear();
  global.fetch = vi.fn();
  global.URL.createObjectURL = vi.fn(() => 'blob://fake');
  global.URL.revokeObjectURL = vi.fn();
});

/**
 * Tests for the "Scan Library for Faces" backfill loop — see faceBackfill.ts's doc comment on
 * processPhoto() for the bug this specifically guards against: a photo whose preview/original
 * image can never be fetched (e.g. a 404, an orphaned DB row) used to be left permanently
 * unprocessed (faces_processed_at only set on success), so GET /admin/photos/faces-pending kept
 * returning the SAME stuck batch forever — an infinite scan loop where "processed" climbed
 * without bound while "remaining" stayed stuck near 0.
 */
describe('runBackfillScan', () => {
  it('marks a photo whose preview fetch 404s as processed with 0 faces, instead of retrying it forever', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 404 });
    getFacesPendingPhotosMock
      .mockResolvedValueOnce({ photos: [photo('stuck-1')], remaining: 1 })
      .mockResolvedValueOnce({ photos: [], remaining: 0 });

    const progresses: Array<{ processed: number; remaining: number; done: boolean }> = [];
    await runBackfillScan((p) => {
      progresses.push(p);
    });

    // The broken photo was explicitly marked processed with an empty faces array...
    expect(saveBackfilledFacesMock).toHaveBeenCalledWith('stuck-1', []);
    // ...and the scan terminated (didn't loop forever re-fetching the same stuck photo).
    expect(getFacesPendingPhotosMock).toHaveBeenCalledTimes(2);
    expect(progresses[progresses.length - 1]).toEqual({ processed: 1, remaining: 0, done: true });
  });

  it('still saves real detection results for photos that succeed', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, blob: async () => new Blob() });
    const faces = [{ embedding: [1, 2, 3], bbox: { x: 0, y: 0, width: 1, height: 1 } }];
    detectFacesMock.mockResolvedValue(faces);
    getFacesPendingPhotosMock
      .mockResolvedValueOnce({ photos: [photo('good-1')], remaining: 1 })
      .mockResolvedValueOnce({ photos: [], remaining: 0 });

    await runBackfillScan(() => {});

    expect(saveBackfilledFacesMock).toHaveBeenCalledWith('good-1', faces);
  });

  it('marks a photo as processed with 0 faces when detectFaces itself throws (e.g. a corrupt image)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, blob: async () => new Blob() });
    detectFacesMock.mockRejectedValue(new Error('cannot decode image'));
    getFacesPendingPhotosMock
      .mockResolvedValueOnce({ photos: [photo('corrupt-1')], remaining: 1 })
      .mockResolvedValueOnce({ photos: [], remaining: 0 });

    await runBackfillScan(() => {});

    expect(saveBackfilledFacesMock).toHaveBeenCalledWith('corrupt-1', []);
  });

  it('processes a mixed batch (one broken, one good) without the broken photo blocking the good one', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      void url;
      return Promise.resolve({ ok: true, blob: async () => new Blob() });
    });
    let call = 0;
    detectFacesMock.mockImplementation(() => {
      call++;
      if (call === 1) throw new Error('boom');
      return Promise.resolve([]);
    });
    getFacesPendingPhotosMock
      .mockResolvedValueOnce({ photos: [photo('broken'), photo('fine')], remaining: 2 })
      .mockResolvedValueOnce({ photos: [], remaining: 0 });

    await runBackfillScan(() => {});

    expect(saveBackfilledFacesMock).toHaveBeenCalledWith('broken', []);
    expect(saveBackfilledFacesMock).toHaveBeenCalledWith('fine', []);
    expect(saveBackfilledFacesMock).toHaveBeenCalledTimes(2);
  });

  it('stops the loop early when onProgress returns false', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, blob: async () => new Blob() });
    detectFacesMock.mockResolvedValue([]);
    getFacesPendingPhotosMock.mockResolvedValue({ photos: [photo('p1')], remaining: 100 });

    await runBackfillScan(() => false);

    expect(getFacesPendingPhotosMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Scanning originals is what exhausted the Android WebView renderer and killed the app
   * (2026-08-08). See faceBackfill.ts's HISTORY note before changing this back — it has now
   * flipped twice.
   */
  it('scans the preview, not the original, and hands the blob straight to detectFaces', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, blob: async () => blob });
    detectFacesMock.mockResolvedValue([]);
    getFacesPendingPhotosMock
      .mockResolvedValueOnce({ photos: [photo('p1')], remaining: 1 })
      .mockResolvedValueOnce({ photos: [], remaining: 0 });

    await runBackfillScan(() => {});

    expect(getPreviewUrlMock).toHaveBeenCalledWith('my-event', 'p1', 'image/jpeg', 1);
    expect(global.fetch).toHaveBeenCalledWith('https://example.com/preview.jpg');
    // No object URL: detectFaces() does its own bounded decode from the blob.
    expect(detectFacesMock).toHaveBeenCalledWith(blob);
    expect(global.URL.createObjectURL).not.toHaveBeenCalled();
  });
});
