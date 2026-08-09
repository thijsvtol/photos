import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UploadQueueItem } from '../types';

/**
 * Tests for the client-side face-detection upload-queue watcher
 * (faceDetectionQueue.ts). This module is a decoupled listener on top of
 * uploadManager's subscribe() pattern — deliberately NOT part of
 * uploadManager.ts itself (see repo notes: that file is fragile/critical).
 * These tests lock in the most important safety properties:
 *   - only newly-completed IMAGE items are processed (not videos/RAW/other
 *     statuses), and each item is processed at most once
 *   - a face-detection/save failure never throws out of the listener
 *   - detections run STRICTLY ONE AT A TIME (see the concurrency block below)
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
    const item = makeItem();

    listener([item]);
    await flush();

    // The File goes straight through: detectFaces() does its own bounded decode, so this no
    // longer wraps it in an object URL (which forced a full-resolution decode).
    expect(detectFacesMock).toHaveBeenCalledWith(item.file);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
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

  it('skips a completed item whose File has not arrived yet, then processes it once it has', async () => {
    detectFacesMock.mockResolvedValue([]);
    const listener = await loadQueue();

    // Completion can be reported by backgroundSync BEFORE the queue item's File has been
    // backfilled from Dexie. Marking the id processed at that point would skip the photo
    // permanently, so the guard must defer instead.
    listener([makeItem({ file: undefined as unknown as File })]);
    await flush();
    expect(detectFacesMock).not.toHaveBeenCalled();

    listener([makeItem()]);
    await flush();
    expect(detectFacesMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Regression guard for the 2026-08-08 crash: the Android WebView's renderer process ran out of
 * memory during bulk uploads and Android killed the whole app ("Render process kill (OOM or
 * update) wasn't handed by all associated webviews, killing application").
 *
 * The cause lived here. Each completed upload was launched with a bare `void processItem(item)`,
 * and uploadManager.notify() hands every listener the WHOLE queue snapshot — so a bulk upload
 * started a detection per photo with no cap. Detection takes seconds each (BlazeFace + FaceMesh
 * + an ArcFace ONNX inference) while uploads complete 2-6 at a time, so in-flight detections
 * accumulated, each pinning a decoded image plus model tensors.
 *
 * The invariant: never more than one detection in flight.
 */
describe('faceDetectionQueue concurrency', () => {
  it('runs at most one detection at a time when a bulk upload completes', async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const releases: Array<() => void> = [];

    detectFacesMock.mockImplementation(() => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      return new Promise((resolve) => {
        releases.push(() => {
          inFlight--;
          resolve([]);
        });
      });
    });

    const listener = await loadQueue();

    // One notification carrying ten finished uploads — the shape that caused the crash.
    listener(Array.from({ length: 10 }, (_, i) => makeItem({ id: `q-${i}`, photoId: `p-${i}` })));
    await flush();

    expect(peakInFlight).toBe(1);
    expect(detectFacesMock).toHaveBeenCalledTimes(1);

    // Drain one at a time; the peak must never climb above 1.
    for (let i = 0; i < 10; i++) {
      releases[i]?.();
      await flush();
    }

    expect(peakInFlight).toBe(1);
    expect(detectFacesMock).toHaveBeenCalledTimes(10);
  });

  it('keeps draining after a detection rejects instead of stalling the chain', async () => {
    detectFacesMock.mockRejectedValueOnce(new Error('detect boom')).mockResolvedValue([]);
    const listener = await loadQueue();

    listener([
      makeItem({ id: 'q-a', photoId: 'p-a' }),
      makeItem({ id: 'q-b', photoId: 'p-b' }),
      makeItem({ id: 'q-c', photoId: 'p-c' }),
    ]);
    await flush();

    // A rejected task must not poison the promise chain and silently halt all later work.
    expect(detectFacesMock).toHaveBeenCalledTimes(3);
  });
});
