import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UploadQueueItem } from '../types';

/**
 * Tests for the client-side face-detection upload-queue watcher
 * (faceDetectionQueue.ts). This module is a decoupled listener on top of
 * uploadManager's subscribe() pattern — deliberately NOT part of
 * uploadManager.ts itself (see repo notes: that file is fragile/critical).
 * These tests lock in the two most important safety properties:
 *   - only newly-completed IMAGE items are processed (not videos/RAW/other
 *     statuses), and each item is processed at most once
 *   - a face-detection/save failure never throws out of the listener
 */

let subscribedListener: ((items: UploadQueueItem[]) => void) | null = null;

vi.mock('../services/uploadManager', () => ({
  uploadManager: {
    subscribe: (listener: (items: UploadQueueItem[]) => void) => {
      subscribedListener = listener;
      return () => { subscribedListener = null; };
    },
  },
}));

const detectFacesMock = vi.fn();
vi.mock('../faceDetection', () => ({
  detectFaces: (...args: unknown[]) => detectFacesMock(...args),
}));

const saveFacesMock = vi.fn();
vi.mock('../api', () => ({
  saveFaces: (...args: unknown[]) => saveFacesMock(...args),
}));

function makeItem(overrides: Partial<UploadQueueItem> = {}): UploadQueueItem {
  return {
    id: 'queue-1',
    eventSlug: 'my-event',
    file: new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
    status: 'completed',
    progress: 100,
    photoId: 'photo-1',
    fileType: 'image/jpeg',
    ...overrides,
  } as UploadQueueItem;
}

beforeEach(async () => {
  vi.resetModules();
  detectFacesMock.mockReset();
  saveFacesMock.mockReset();
  subscribedListener = null;

  // jsdom does not implement createObjectURL/revokeObjectURL.
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
});

async function loadQueue() {
  const mod = await import('../faceDetectionQueue');
  mod.startFaceDetectionQueue();
  if (!subscribedListener) throw new Error('Listener was not registered');
  return subscribedListener;
}

// Flushes pending microtasks so processItem()'s fire-and-forget promise resolves.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('faceDetectionQueue', () => {
  it('processes a newly-completed image item and saves detected faces', async () => {
    detectFacesMock.mockResolvedValue([{ embedding: [1, 2, 3], bbox: { x: 0, y: 0, width: 10, height: 10 } }]);
    const listener = await loadQueue();

    listener([makeItem()]);
    await flush();

    expect(detectFacesMock).toHaveBeenCalledWith('blob:mock-url');
    expect(saveFacesMock).toHaveBeenCalledWith('my-event', 'photo-1', [
      { embedding: [1, 2, 3], bbox: { x: 0, y: 0, width: 10, height: 10 } },
    ]);
  });

  it('does not call saveFaces when no faces are detected', async () => {
    detectFacesMock.mockResolvedValue([]);
    const listener = await loadQueue();

    listener([makeItem()]);
    await flush();

    expect(detectFacesMock).toHaveBeenCalled();
    expect(saveFacesMock).not.toHaveBeenCalled();
  });

  it('ignores non-image items (e.g. videos)', async () => {
    detectFacesMock.mockResolvedValue([]);
    const listener = await loadQueue();

    listener([makeItem({ fileType: 'video/mp4', file: new File(['x'], 'v.mp4', { type: 'video/mp4' }) })]);
    await flush();

    expect(detectFacesMock).not.toHaveBeenCalled();
  });

  it('ignores items that are not yet completed', async () => {
    detectFacesMock.mockResolvedValue([]);
    const listener = await loadQueue();

    listener([makeItem({ status: 'uploading' })]);
    await flush();

    expect(detectFacesMock).not.toHaveBeenCalled();
  });

  it('processes the same completed item only once across multiple notifications', async () => {
    detectFacesMock.mockResolvedValue([]);
    const listener = await loadQueue();

    const item = makeItem();
    listener([item]);
    await flush();
    listener([item]);
    await flush();

    expect(detectFacesMock).toHaveBeenCalledTimes(1);
  });

  it('never throws even if face detection or saving fails', async () => {
    detectFacesMock.mockRejectedValue(new Error('model failed to load'));
    const listener = await loadQueue();

    expect(() => listener([makeItem()])).not.toThrow();
    await flush();
  });
});
