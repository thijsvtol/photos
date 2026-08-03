import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Tests for getFullClusterData()'s pagination-accumulation loop (2026-08-03) — added alongside
 * making GET /admin/people/cluster-data itself cursor-paginated (see faceClustering.ts's
 * PAGE_SIZE doc comment): converting/serializing an unbounded number of BLOB embeddings into a
 * single JSON response is real, library-size-scaling CPU work on the Worker side, independent
 * of any vector-similarity math — a large library alone (regardless of clustering algorithm
 * correctness) could make a single "fetch everything" call exceed the Workers Free plan's 10ms
 * CPU-time limit. getFullClusterData() loops the now-paginated getClusterData() until both
 * cursors are exhausted, accumulating the full dataset client-side (safe, since browsers have
 * no such CPU-time limit).
 */

const getMock = vi.fn();

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: getMock,
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    }),
  },
}));

vi.mock('@capacitor/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, isNativePlatform: () => false },
  };
});

beforeEach(() => {
  getMock.mockReset();
});

function page(faces: unknown[], clusters: unknown[], nextFaceCursor: number | null, nextClusterCursor: number | null) {
  return { data: { faces, clusters, nextFaceCursor, nextClusterCursor } };
}

describe('getFullClusterData', () => {
  it('returns everything in one page when the dataset is small (both cursors already null)', async () => {
    getMock.mockResolvedValueOnce(
      page(
        [{ id: 1, photoId: 'p1', embedding: [1] }],
        [{ id: 1, centroidEmbedding: [1], faceCount: 1 }],
        null,
        null
      )
    );

    const { getFullClusterData } = await import('../api');
    const result = await getFullClusterData(true);

    expect(result.faces).toHaveLength(1);
    expect(result.clusters).toHaveLength(1);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('loops until both cursors are exhausted, accumulating rows across pages', async () => {
    getMock
      .mockResolvedValueOnce(
        page(
          [{ id: 1, photoId: 'p1', embedding: [1] }],
          [{ id: 1, centroidEmbedding: [1], faceCount: 1 }],
          1,
          1
        )
      )
      .mockResolvedValueOnce(
        page(
          [{ id: 2, photoId: 'p2', embedding: [2] }],
          [{ id: 2, centroidEmbedding: [2], faceCount: 1 }],
          null,
          null
        )
      );

    const { getFullClusterData } = await import('../api');
    const result = await getFullClusterData(true);

    expect(result.faces.map((f) => f.id)).toEqual([1, 2]);
    expect(result.clusters.map((c) => c.id)).toEqual([1, 2]);
    expect(getMock).toHaveBeenCalledTimes(2);
    // Second call must resume from the cursors returned by the first page.
    const secondCallParams = getMock.mock.calls[1][1]?.params;
    expect(secondCallParams).toMatchObject({ afterClusterId: 1, afterFaceId: 1 });
  });

  it('reports progress via onProgress after each page', async () => {
    getMock
      .mockResolvedValueOnce(page([{ id: 1, photoId: 'p1', embedding: [1] }], [], 1, null))
      .mockResolvedValueOnce(page([{ id: 2, photoId: 'p2', embedding: [2] }], [], null, null));

    const { getFullClusterData } = await import('../api');
    const calls: Array<[number, number]> = [];
    await getFullClusterData(true, (facesLoaded, clustersLoaded) => calls.push([facesLoaded, clustersLoaded]));

    expect(calls).toEqual([[1, 0], [2, 0]]);
  });

  it('stops looping once cluster-only mode (includeFaces=false) reports both cursors null on the first page', async () => {
    getMock.mockResolvedValueOnce(page([], [{ id: 1, centroidEmbedding: [1], faceCount: 1 }], null, null));

    const { getFullClusterData } = await import('../api');
    const result = await getFullClusterData(false);

    expect(result.clusters).toHaveLength(1);
    expect(result.faces).toEqual([]);
    expect(getMock).toHaveBeenCalledTimes(1);
  });
});
