import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same vi.mock path-resolution rationale as adminPeopleLinking.test.ts — this
// mocks the real faceClustering module's exports so the route test only
// exercises the HTTP-layer wiring (auth, response shape), not the actual
// clustering math (already covered by faceClustering.test.ts).
let currentUser: { id: string; email: string; name?: string } | null = { id: 'u1', email: 'admin@example.com' };
let currentIsAdmin = true;

vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>();
  return {
    ...actual,
    requireAdmin: async (c: any, next: any) => {
      if (!currentUser) return c.json({ error: 'Authentication required' }, 401);
      if (!currentIsAdmin) return c.json({ error: 'Admin access required' }, 403);
      c.set('user', currentUser);
      await next();
    },
  };
});

const runFaceClusteringMock = vi.fn();
const countUnclusteredFacesMock = vi.fn();
const findMergeSuggestionsMock = vi.fn();

vi.mock('../faceClustering', () => ({
  runFaceClustering: (...args: unknown[]) => runFaceClusteringMock(...args),
  countUnclusteredFaces: (...args: unknown[]) => countUnclusteredFacesMock(...args),
  findMergeSuggestions: (...args: unknown[]) => findMergeSuggestionsMock(...args),
}));

import peopleRouter from '../routes/admin/people';

function makeEnv() {
  return { DB: {} as unknown as D1Database } as any;
}

beforeEach(() => {
  currentUser = { id: 'u1', email: 'admin@example.com' };
  currentIsAdmin = true;
  runFaceClusteringMock.mockReset();
  countUnclusteredFacesMock.mockReset();
  findMergeSuggestionsMock.mockReset();
});

describe('POST /admin/people/cluster-now', () => {
  it('runs clustering and reports processed/remaining counts', async () => {
    runFaceClusteringMock.mockResolvedValue({ processed: 200 });
    countUnclusteredFacesMock.mockResolvedValue(9800);

    const res = await peopleRouter.request('http://localhost/cluster-now', { method: 'POST' }, makeEnv());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body).toEqual({ processed: 200, remaining: 9800 });
    expect(runFaceClusteringMock).toHaveBeenCalledTimes(1);
    expect(countUnclusteredFacesMock).toHaveBeenCalledTimes(1);
  });

  it('reports remaining: 0 once the backlog is fully drained', async () => {
    runFaceClusteringMock.mockResolvedValue({ processed: 3 });
    countUnclusteredFacesMock.mockResolvedValue(0);

    const res = await peopleRouter.request('http://localhost/cluster-now', { method: 'POST' }, makeEnv());
    const body = await res.json() as any;

    expect(body).toEqual({ processed: 3, remaining: 0 });
  });

  it('rejects non-admin requests without running clustering', async () => {
    currentIsAdmin = false;

    const res = await peopleRouter.request('http://localhost/cluster-now', { method: 'POST' }, makeEnv());

    expect(res.status).toBe(403);
    expect(runFaceClusteringMock).not.toHaveBeenCalled();
  });

  it('returns 500 if clustering throws', async () => {
    runFaceClusteringMock.mockRejectedValue(new Error('D1 boom'));

    const res = await peopleRouter.request('http://localhost/cluster-now', { method: 'POST' }, makeEnv());

    expect(res.status).toBe(500);
  });
});

describe('GET /admin/people/merge-suggestions', () => {
  it('starts a fresh scan when no cursor query params are given', async () => {
    findMergeSuggestionsMock.mockResolvedValue({ suggestions: [], nextCursor: null, totalClusters: 5 });

    const res = await peopleRouter.request('http://localhost/merge-suggestions', {}, makeEnv());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body).toEqual({ suggestions: [], nextCursor: null, totalClusters: 5 });
    expect(findMergeSuggestionsMock).toHaveBeenCalledWith(expect.anything(), null, undefined);
  });

  it('passes sourceId/candidateId query params through as a cursor', async () => {
    findMergeSuggestionsMock.mockResolvedValue({
      suggestions: [{ clusterAId: 1, clusterBId: 2, similarity: 0.9 }],
      nextCursor: { sourceId: 3, candidateId: 4 },
      totalClusters: 10,
    });

    const res = await peopleRouter.request('http://localhost/merge-suggestions?sourceId=1&candidateId=2', {}, makeEnv());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.nextCursor).toEqual({ sourceId: 3, candidateId: 4 });
    expect(findMergeSuggestionsMock).toHaveBeenCalledWith(expect.anything(), { sourceId: 1, candidateId: 2 }, undefined);
  });

  it('passes a valid minSimilarity query param through unchanged', async () => {
    findMergeSuggestionsMock.mockResolvedValue({ suggestions: [], nextCursor: null, totalClusters: 5 });

    await peopleRouter.request('http://localhost/merge-suggestions?minSimilarity=0.2', {}, makeEnv());

    expect(findMergeSuggestionsMock).toHaveBeenCalledWith(expect.anything(), null, 0.2);
  });

  it('ignores an out-of-range minSimilarity query param (falls back to the function default)', async () => {
    findMergeSuggestionsMock.mockResolvedValue({ suggestions: [], nextCursor: null, totalClusters: 5 });

    await peopleRouter.request('http://localhost/merge-suggestions?minSimilarity=1.5', {}, makeEnv());

    expect(findMergeSuggestionsMock).toHaveBeenCalledWith(expect.anything(), null, undefined);
  });

  it('treats non-numeric cursor query params as no cursor', async () => {
    findMergeSuggestionsMock.mockResolvedValue({ suggestions: [], nextCursor: null, totalClusters: 0 });

    await peopleRouter.request('http://localhost/merge-suggestions?sourceId=abc&candidateId=def', {}, makeEnv());

    expect(findMergeSuggestionsMock).toHaveBeenCalledWith(expect.anything(), null, undefined);
  });

  it('rejects non-admin requests without running the scan', async () => {
    currentIsAdmin = false;

    const res = await peopleRouter.request('http://localhost/merge-suggestions', {}, makeEnv());

    expect(res.status).toBe(403);
    expect(findMergeSuggestionsMock).not.toHaveBeenCalled();
  });

  it('returns 500 if the scan throws', async () => {
    findMergeSuggestionsMock.mockRejectedValue(new Error('D1 boom'));

    const res = await peopleRouter.request('http://localhost/merge-suggestions', {}, makeEnv());

    expect(res.status).toBe(500);
  });
});
