import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * HTTP-layer wiring tests for the "Unnamed people" cleanup routes (GET /unnamed,
 * POST /merge-unnamed-confident). Mocks the faceClustering module so this only exercises route
 * wiring — auth, response shape, activity logging, and (critically) that GET /unnamed is matched
 * before GET /:personId rather than being swallowed as a person id. The actual SQL/decision logic
 * is covered by unnamedSuggestion.test.ts and faceClustering.test.ts.
 */

let currentUser: { id: string; email: string } | null = { id: 'u1', email: 'admin@example.com' };
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

const getUnnamedPeopleWithSuggestionsMock = vi.fn();
const mergeConfidentUnnamedIntoTaggedMock = vi.fn();

// Keep every real faceClustering export, override only the two under test — so the router's other
// imports still resolve and route registration is unaffected.
vi.mock('../faceClustering', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../faceClustering')>();
  return {
    ...actual,
    getUnnamedPeopleWithSuggestions: (...args: unknown[]) => getUnnamedPeopleWithSuggestionsMock(...args),
    mergeConfidentUnnamedIntoTagged: (...args: unknown[]) => mergeConfidentUnnamedIntoTaggedMock(...args),
  };
});

const logActivityMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../activityLog', () => ({ logActivity: (...args: unknown[]) => logActivityMock(...args) }));

import peopleRouter from '../routes/admin/people';

const makeEnv = () => ({ DB: {} as unknown as D1Database }) as any;

beforeEach(() => {
  currentUser = { id: 'u1', email: 'admin@example.com' };
  currentIsAdmin = true;
  getUnnamedPeopleWithSuggestionsMock.mockReset();
  mergeConfidentUnnamedIntoTaggedMock.mockReset();
  logActivityMock.mockClear();
});

describe('GET /admin/people/unnamed', () => {
  it('returns the unnamed people list (and is not captured by /:personId)', async () => {
    getUnnamedPeopleWithSuggestionsMock.mockResolvedValue([
      { id: 12, face_count: 3, photo_count: 3, suggestion: { personId: 5, name: 'Anna', sharedPhotos: 3, totalPhotos: 3, centroidSimilarity: 0.9 }, confident: true },
    ]);

    const res = await peopleRouter.request('http://localhost/unnamed', {}, makeEnv());
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(getUnnamedPeopleWithSuggestionsMock).toHaveBeenCalledTimes(1);
    expect(body.people).toHaveLength(1);
    expect(body.people[0]).toMatchObject({ id: 12, confident: true });
  });

  it('rejects non-admin requests', async () => {
    currentIsAdmin = false;
    const res = await peopleRouter.request('http://localhost/unnamed', {}, makeEnv());
    expect(res.status).toBe(403);
    expect(getUnnamedPeopleWithSuggestionsMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the lookup throws', async () => {
    getUnnamedPeopleWithSuggestionsMock.mockRejectedValue(new Error('D1 boom'));
    const res = await peopleRouter.request('http://localhost/unnamed', {}, makeEnv());
    expect(res.status).toBe(500);
  });
});

describe('POST /admin/people/merge-unnamed-confident', () => {
  it('merges and logs activity when something was merged', async () => {
    mergeConfidentUnnamedIntoTaggedMock.mockResolvedValue({ merged: 4, remaining: 2 });

    const res = await peopleRouter.request('http://localhost/merge-unnamed-confident', { method: 'POST' }, makeEnv());
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, merged: 4, remaining: 2 });
    expect(logActivityMock).toHaveBeenCalledTimes(1);
  });

  it('does not log activity when nothing was merged', async () => {
    mergeConfidentUnnamedIntoTaggedMock.mockResolvedValue({ merged: 0, remaining: 0 });

    const res = await peopleRouter.request('http://localhost/merge-unnamed-confident', { method: 'POST' }, makeEnv());

    expect(res.status).toBe(200);
    expect(logActivityMock).not.toHaveBeenCalled();
  });

  it('rejects non-admin requests', async () => {
    currentIsAdmin = false;
    const res = await peopleRouter.request('http://localhost/merge-unnamed-confident', { method: 'POST' }, makeEnv());
    expect(res.status).toBe(403);
    expect(mergeConfidentUnnamedIntoTaggedMock).not.toHaveBeenCalled();
  });
});
