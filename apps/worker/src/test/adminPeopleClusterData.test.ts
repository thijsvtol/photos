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
const getLegacyFaceStatsMock = vi.fn();
const resetLegacyFacesMock = vi.fn();
const mergeClustersMock = vi.fn();
const assignPhotosToPersonMock = vi.fn();
const resetAllClustersMock = vi.fn();

vi.mock('../faceClustering', () => ({
  getClusterData: (...args: unknown[]) => getClusterDataMock(...args),
  applyClusteringResults: (...args: unknown[]) => applyClusteringResultsMock(...args),
  countUnclusteredFaces: (...args: unknown[]) => countUnclusteredFacesMock(...args),
  getLegacyFaceStats: (...args: unknown[]) => getLegacyFaceStatsMock(...args),
  resetLegacyFaces: (...args: unknown[]) => resetLegacyFacesMock(...args),
  mergeClusters: (...args: unknown[]) => mergeClustersMock(...args),
  assignPhotosToPerson: (...args: unknown[]) => assignPhotosToPersonMock(...args),
  resetAllClusters: (...args: unknown[]) => resetAllClustersMock(...args),
}));

import peopleRouter from '../routes/admin/people';

function makeEnv(bucketGetImpl?: (key: string) => Promise<unknown>) {
  return {
    DB: {} as unknown as D1Database,
    PHOTOS_BUCKET: { get: bucketGetImpl ?? (async () => null) } as any,
  } as any;
}

beforeEach(() => {
  currentUser = { id: 'u1', email: 'admin@example.com' };
  currentIsAdmin = true;
  getClusterDataMock.mockReset();
  applyClusteringResultsMock.mockReset();
  countUnclusteredFacesMock.mockReset();
  getLegacyFaceStatsMock.mockReset();
  resetLegacyFacesMock.mockReset();
  mergeClustersMock.mockReset();
  assignPhotosToPersonMock.mockReset();
  resetAllClustersMock.mockReset();
});

describe('GET /admin/people/cluster-data', () => {
  it('fetches with includeFaces=true by default', async () => {
    getClusterDataMock.mockResolvedValue({ faces: [{ id: 1, photoId: 'p1', embedding: [1] }], clusters: [] });

    const res = await peopleRouter.request('http://localhost/cluster-data', {}, makeEnv());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.faces).toHaveLength(1);
    expect(getClusterDataMock).toHaveBeenCalledWith(expect.anything(), true, 0, 0, true);
  });

  it('passes includeFaces=false through when ?includeFaces=0 is given', async () => {
    getClusterDataMock.mockResolvedValue({ faces: [], clusters: [{ id: 1, centroidEmbedding: [1], faceCount: 2 }] });

    await peopleRouter.request('http://localhost/cluster-data?includeFaces=0', {}, makeEnv());

    expect(getClusterDataMock).toHaveBeenCalledWith(expect.anything(), false, 0, 0, true);
  });

  it('passes unclusteredOnly=false through when ?unclusteredOnly=0 is given (deep-rebuild mode)', async () => {
    getClusterDataMock.mockResolvedValue({ faces: [], clusters: [] });

    await peopleRouter.request('http://localhost/cluster-data?unclusteredOnly=0', {}, makeEnv());

    expect(getClusterDataMock).toHaveBeenCalledWith(expect.anything(), true, 0, 0, false);
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
  it('persists results and reports facesAssigned/remaining/rejected', async () => {
    applyClusteringResultsMock.mockResolvedValue({ facesAssigned: 3, rejected: 0 });
    countUnclusteredFacesMock.mockResolvedValue(7);

    const results = [{ clusterId: null, centroidEmbedding: [1, 2], faceCount: 1, addedFaceIds: [10], coverPhotoId: 'p1' }];
    const res = await peopleRouter.request(
      'http://localhost/apply-clustering',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) },
      makeEnv()
    );
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body).toEqual({ facesAssigned: 3, remaining: 7, rejected: 0 });
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

describe('GET /admin/people/legacy-face-stats', () => {
  it('returns the legacy counts', async () => {
    getLegacyFaceStatsMock.mockResolvedValue({ legacyFaces: 4, legacyClusters: 2 });

    const res = await peopleRouter.request('http://localhost/legacy-face-stats', {}, makeEnv());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body).toEqual({ legacyFaces: 4, legacyClusters: 2 });
  });

  it('rejects non-admin requests', async () => {
    currentIsAdmin = false;

    const res = await peopleRouter.request('http://localhost/legacy-face-stats', {}, makeEnv());

    expect(res.status).toBe(403);
    expect(getLegacyFaceStatsMock).not.toHaveBeenCalled();
  });

  it('returns 500 if the stats query throws', async () => {
    getLegacyFaceStatsMock.mockRejectedValue(new Error('D1 boom'));

    const res = await peopleRouter.request('http://localhost/legacy-face-stats', {}, makeEnv());

    expect(res.status).toBe(500);
  });
});

describe('POST /admin/people/reset-legacy-faces', () => {
  it('runs the repair and returns the counts', async () => {
    resetLegacyFacesMock.mockResolvedValue({ facesReset: 3, clustersRemoved: 1 });

    const res = await peopleRouter.request('http://localhost/reset-legacy-faces', { method: 'POST' }, makeEnv());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body).toEqual({ facesReset: 3, clustersRemoved: 1 });
  });

  it('rejects non-admin requests', async () => {
    currentIsAdmin = false;

    const res = await peopleRouter.request('http://localhost/reset-legacy-faces', { method: 'POST' }, makeEnv());

    expect(res.status).toBe(403);
    expect(resetLegacyFacesMock).not.toHaveBeenCalled();
  });

  it('returns 500 if the repair throws', async () => {
    resetLegacyFacesMock.mockRejectedValue(new Error('D1 boom'));

    const res = await peopleRouter.request('http://localhost/reset-legacy-faces', { method: 'POST' }, makeEnv());

    expect(res.status).toBe(500);
  });
});

describe('POST /admin/people/reset-clusters', () => {
  it('runs the reset and returns the counts', async () => {
    resetAllClustersMock.mockResolvedValue({ facesUnassigned: 1288, clustersDeleted: 22 });

    const res = await peopleRouter.request('http://localhost/reset-clusters', { method: 'POST' }, makeEnv());
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body).toEqual({ facesUnassigned: 1288, clustersDeleted: 22 });
  });

  it('rejects non-admin requests', async () => {
    currentIsAdmin = false;

    const res = await peopleRouter.request('http://localhost/reset-clusters', { method: 'POST' }, makeEnv());

    expect(res.status).toBe(403);
    expect(resetAllClustersMock).not.toHaveBeenCalled();
  });

  it('returns 500 if the reset throws', async () => {
    resetAllClustersMock.mockRejectedValue(new Error('D1 boom'));

    const res = await peopleRouter.request('http://localhost/reset-clusters', { method: 'POST' }, makeEnv());

    expect(res.status).toBe(500);
  });
});

describe('POST /admin/people/merge', () => {
  it('merges source clusters into the target and returns facesMoved', async () => {
    mergeClustersMock.mockResolvedValue({ facesMoved: 5 });

    const res = await peopleRouter.request(
      'http://localhost/merge',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetPersonId: 1, sourcePersonIds: [2, 3] }) },
      makeEnv()
    );
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, facesMoved: 5 });
    expect(mergeClustersMock).toHaveBeenCalledWith(expect.anything(), 1, [2, 3]);
  });

  it('rejects a request missing targetPersonId or sourcePersonIds', async () => {
    const res = await peopleRouter.request(
      'http://localhost/merge',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetPersonId: 1, sourcePersonIds: [] }) },
      makeEnv()
    );

    expect(res.status).toBe(400);
    expect(mergeClustersMock).not.toHaveBeenCalled();
  });

  it('rejects non-admin requests', async () => {
    currentIsAdmin = false;

    const res = await peopleRouter.request(
      'http://localhost/merge',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetPersonId: 1, sourcePersonIds: [2] }) },
      makeEnv()
    );

    expect(res.status).toBe(403);
    expect(mergeClustersMock).not.toHaveBeenCalled();
  });

  it('returns 500 if merging throws', async () => {
    mergeClustersMock.mockRejectedValue(new Error('D1 boom'));

    const res = await peopleRouter.request(
      'http://localhost/merge',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetPersonId: 1, sourcePersonIds: [2] }) },
      makeEnv()
    );

    expect(res.status).toBe(500);
  });
});

describe('POST /admin/people/:personId/photos', () => {
  it('assigns the given photos to the person and returns assigned/skipped counts', async () => {
    assignPhotosToPersonMock.mockResolvedValue({ assigned: 2, skipped: 1 });

    const res = await peopleRouter.request(
      'http://localhost/42/photos',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoIds: ['photo-a', 'photo-b'] }) },
      makeEnv()
    );
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body).toEqual({ assigned: 2, skipped: 1 });
    expect(assignPhotosToPersonMock).toHaveBeenCalledWith(expect.anything(), 42, ['photo-a', 'photo-b']);
  });

  it('rejects an invalid person id', async () => {
    const res = await peopleRouter.request(
      'http://localhost/not-a-number/photos',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoIds: ['photo-a'] }) },
      makeEnv()
    );

    expect(res.status).toBe(400);
    expect(assignPhotosToPersonMock).not.toHaveBeenCalled();
  });

  it('rejects a request with an empty or missing photoIds array', async () => {
    const res = await peopleRouter.request(
      'http://localhost/42/photos',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoIds: [] }) },
      makeEnv()
    );

    expect(res.status).toBe(400);
    expect(assignPhotosToPersonMock).not.toHaveBeenCalled();
  });

  it('rejects non-admin requests', async () => {
    currentIsAdmin = false;

    const res = await peopleRouter.request(
      'http://localhost/42/photos',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoIds: ['photo-a'] }) },
      makeEnv()
    );

    expect(res.status).toBe(403);
    expect(assignPhotosToPersonMock).not.toHaveBeenCalled();
  });

  it('returns 500 if assignment throws', async () => {
    assignPhotosToPersonMock.mockRejectedValue(new Error('D1 boom'));

    const res = await peopleRouter.request(
      'http://localhost/42/photos',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoIds: ['photo-a'] }) },
      makeEnv()
    );

    expect(res.status).toBe(500);
  });
});

