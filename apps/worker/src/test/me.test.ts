import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same vi.mock path-resolution rationale as adminPeopleLinking.test.ts.
let currentUser: { id: string; email: string; name?: string } | null = null;

vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>();
  return {
    ...actual,
    requireAuth: async (c: any, next: any) => {
      if (!currentUser) return c.json({ error: 'Authentication required' }, 401);
      c.set('user', currentUser);
      await next();
    },
  };
});

import meRouter from '../routes/me';

interface FakePerson {
  id: number;
  name: string | null;
  face_count: number;
  linked_user_email: string | null;
}

interface FakePhoto {
  id: string;
  person_id: number;
  event_slug: string;
  deleted_at: string | null;
}

function createFakeEnv(people: FakePerson[], photos: FakePhoto[]) {
  const db = {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async first<T>() {
          if (query.includes('FROM person_clusters') && query.includes('linked_user_email')) {
            const [email] = boundArgs as [string];
            const match = people.find((p) => p.linked_user_email?.toLowerCase() === (email as string).toLowerCase());
            return (match ? { id: match.id, name: match.name, face_count: match.face_count } : null) as T | null;
          }
          return null as T | null;
        },
        async all() {
          if (query.includes('FROM photos p') && query.includes('photo_person_tags')) {
            const [personId] = boundArgs as [number, number];
            const results = photos.filter((p) => p.person_id === personId && p.deleted_at === null);
            return { results };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
  };

  return { db };
}

function makeEnv(fake: ReturnType<typeof createFakeEnv>) {
  return { DB: fake.db as unknown as D1Database } as any;
}

beforeEach(() => {
  currentUser = null;
});

describe('GET /api/me/photos', () => {
  it('requires authentication', async () => {
    const fake = createFakeEnv([], []);
    const res = await meRouter.request('http://localhost/api/me/photos', {}, makeEnv(fake));
    expect(res.status).toBe(401);
  });

  it('reports linked: false when the account has no linked person', async () => {
    currentUser = { id: 'u1', email: 'guest@example.com' };
    const fake = createFakeEnv([], []);
    const res = await meRouter.request('http://localhost/api/me/photos', {}, makeEnv(fake));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ linked: false });
  });

  it('only exposes the first name, never the full name', async () => {
    currentUser = { id: 'u1', email: 'guest@example.com' };
    const people: FakePerson[] = [{ id: 1, name: 'Jane Doe', face_count: 2, linked_user_email: 'guest@example.com' }];
    const photos: FakePhoto[] = [
      { id: 'p1', person_id: 1, event_slug: 'evt', deleted_at: null },
      { id: 'p2', person_id: 1, event_slug: 'evt', deleted_at: '2024-01-01' }, // trashed, should be excluded
    ];
    const fake = createFakeEnv(people, photos);
    const res = await meRouter.request('http://localhost/api/me/photos', {}, makeEnv(fake));
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.linked).toBe(true);
    expect(body.person.displayName).toBe('Jane');
    expect(body.person.displayName).not.toContain('Doe');
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0].id).toBe('p1');
  });

  it('matches the linked email case-insensitively', async () => {
    currentUser = { id: 'u1', email: 'Guest@Example.com' };
    const people: FakePerson[] = [{ id: 1, name: 'Jane Doe', face_count: 1, linked_user_email: 'guest@example.com' }];
    const fake = createFakeEnv(people, []);
    const res = await meRouter.request('http://localhost/api/me/photos', {}, makeEnv(fake));
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.linked).toBe(true);
  });
});
