import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same vi.mock path-resolution rationale as adminPeopleLinking.test.ts — this mocks the real
// faceClustering module's exports so the route test only exercises the HTTP-layer wiring
// (auth, response shape, param parsing), not the actual I/O implementations (already covered
// by faceClustering.test.ts).
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

const getClusterDataMock = vi.fn();
const applyClusteringResultsMock = vi.fn();
const countUnclusteredFacesMock = vi.fn();

vi.mock('../faceClustering', () => ({
  getClusterData: (...args: unknown[]) => getClusterDataMock(...args),
  applyClusteringResults: (...args: unknown[]) => applyClusteringResultsMock(...args),
  countUnclusteredFaces: (...args: unknown[]) => countUnclusteredFacesMock(...args),
}));

import peopleRouter from '../routes/admin/people';

function makeEnv() {
  return { DB: {} as unknown as D1Database } as any;
}

beforeEach(() => {
  currentUser = { id: 'u1', email: 'admin@example.com' };
  currentIsAdmin = true;
  getClusterDataMock.mockReset();
  applyClusteringResultsMock.mockReset();
  countUnclusteredFacesMock.mockReset();
});

describe('GET /admin/people/cluster-data', () => {
  it('fetches with includeFaces=true by default', async () => {
    getClusterDataMock.mockResolvedValue({ faces: [{ id: 1, photoId: 'p1', embedding: [1] }], clusters: [] });

    const res = await peopleRouter.request('http://localhost/cluster-data', {}, makeEnv());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.faces).toHaveLength(1);
    expect(getClusterDataMock).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('passes includeFaces=false through when ?includeFaces=0 is given', async () => {
    getClusterDataMock.mockResolvedValue({ faces: [], clusters: [{ id: 1, centroidEmbedding: [1], faceCount: 2 }] });

    await peopleRouter.request('http://localhost/cluster-data?includeFaces=0', {}, makeEnv());

    expect(getClusterDataMock).toHaveBeenCalledWith(expect.anything(), false);
  });

  it('rejects non-admin requests', async () => {
    currentIsAdmin = false;

    const res = await peopleRouter.request('http://localhost/cluster-data', {}, makeEnv());

    expect(res.status).toBe(403);
    expect(getClusterDataMock).not.toHaveBeenCalled();
  });

  it('returns 500 if fetching cluster data throws', async () => {
    getClusterDataMock.mockRejectedValue(new Error('D1 boom'));

    const res = await peopleRouter.request('http://localhost/cluster-data', {}, makeEnv());

    expect(res.status).toBe(500);
  });
});

describe('POST /admin/people/apply-clustering', () => {
  it('persists results and reports facesAssigned/remaining', async () => {
    applyClusteringResultsMock.mockResolvedValue({ facesAssigned: 3 });
    countUnclusteredFacesMock.mockResolvedValue(7);

    const results = [{ clusterId: null, centroidEmbedding: [1, 2], faceCount: 1, addedFaceIds: [10], coverPhotoId: 'p1' }];
    const res = await peopleRouter.request(
      'http://localhost/apply-clustering',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) },
      makeEnv()
    );
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body).toEqual({ facesAssigned: 3, remaining: 7 });
    expect(applyClusteringResultsMock).toHaveBeenCalledWith(expect.anything(), results);
  });

  it('rejects a request whose results field is not an array', async () => {
    const res = await peopleRouter.request(
      'http://localhost/apply-clustering',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results: 'nope' }) },
      makeEnv()
    );

    expect(res.status).toBe(400);
    expect(applyClusteringResultsMock).not.toHaveBeenCalled();
  });

  it('rejects non-admin requests', async () => {
    currentIsAdmin = false;

    const res = await peopleRouter.request(
      'http://localhost/apply-clustering',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results: [] }) },
      makeEnv()
    );

    expect(res.status).toBe(403);
    expect(applyClusteringResultsMock).not.toHaveBeenCalled();
  });

  it('returns 500 if applying results throws', async () => {
    applyClusteringResultsMock.mockRejectedValue(new Error('D1 boom'));

    const res = await peopleRouter.request(
      'http://localhost/apply-clustering',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results: [] }) },
      makeEnv()
    );

    expect(res.status).toBe(500);
  });
});
