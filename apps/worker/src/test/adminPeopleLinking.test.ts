import { describe, it, expect, vi, beforeEach } from 'vitest';

// See adminPhotosTrash.test.ts for why this mocks '../auth' (relative to
// THIS test file's own directory) rather than '../../auth' (which is what
// routes/admin/people.ts itself imports) — vi.mock() paths resolve relative
// to the calling test file, and both paths happen to point at the same
// src/auth.ts module.
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

import peopleRouter from '../routes/admin/people';

interface FakePersonCluster {
  id: number;
  linked_user_email: string | null;
}

function createFakeEnv(clusters: FakePersonCluster[], users: string[]) {
  const db = {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async first<T>() {
          if (query.includes('SELECT id FROM person_clusters WHERE id = ?')) {
            const [id] = boundArgs as [number];
            const cluster = clusters.find((cl) => cl.id === id);
            return (cluster ? { id: cluster.id } : null) as T | null;
          }
          if (query.includes('SELECT email FROM users WHERE LOWER(email) = LOWER(?)')) {
            const [email] = boundArgs as [string];
            const match = users.find((u) => u.toLowerCase() === (email as string).toLowerCase());
            return (match ? { email: match } : null) as T | null;
          }
          if (query.includes('SELECT id FROM person_clusters WHERE LOWER(linked_user_email) = LOWER(?) AND id != ?')) {
            const [email, excludeId] = boundArgs as [string, number];
            const conflict = clusters.find(
              (cl) => cl.id !== excludeId && cl.linked_user_email?.toLowerCase() === (email as string).toLowerCase()
            );
            return (conflict ? { id: conflict.id } : null) as T | null;
          }
          return null as T | null;
        },
        async run() {
          if (query.includes('UPDATE person_clusters SET') && query.includes('linked_user_email = ?')) {
            const [, , linkedUserEmail, id] = boundArgs as [unknown, unknown, string | null, number];
            const cluster = clusters.find((cl) => cl.id === id);
            if (cluster) cluster.linked_user_email = linkedUserEmail;
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };

  return { db };
}

function makeEnv(fake: ReturnType<typeof createFakeEnv>) {
  return { DB: fake.db as unknown as D1Database, ADMIN_EMAILS: 'admin@example.com' } as any;
}

beforeEach(() => {
  currentUser = { id: 'u1', email: 'admin@example.com' };
  currentIsAdmin = true;
});

describe('PUT /admin/people/:personId — linking a user account', () => {
  it('links an existing account to a person cluster', async () => {
    const clusters: FakePersonCluster[] = [{ id: 1, linked_user_email: null }];
    const fake = createFakeEnv(clusters, ['guest@example.com']);

    const res = await peopleRouter.request(
      'http://localhost/1',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkedUserEmail: 'guest@example.com' }) },
      makeEnv(fake)
    );

    expect(res.status).toBe(200);
    expect(clusters[0].linked_user_email).toBe('guest@example.com');
  });

  it('rejects linking to an email with no matching account', async () => {
    const clusters: FakePersonCluster[] = [{ id: 1, linked_user_email: null }];
    const fake = createFakeEnv(clusters, []);

    const res = await peopleRouter.request(
      'http://localhost/1',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkedUserEmail: 'nobody@example.com' }) },
      makeEnv(fake)
    );

    expect(res.status).toBe(400);
    expect(clusters[0].linked_user_email).toBeNull();
  });

  it('rejects linking an account already linked to a different person', async () => {
    const clusters: FakePersonCluster[] = [
      { id: 1, linked_user_email: 'guest@example.com' },
      { id: 2, linked_user_email: null },
    ];
    const fake = createFakeEnv(clusters, ['guest@example.com']);

    const res = await peopleRouter.request(
      'http://localhost/2',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkedUserEmail: 'guest@example.com' }) },
      makeEnv(fake)
    );

    expect(res.status).toBe(409);
    expect(clusters[1].linked_user_email).toBeNull();
  });

  it('unlinks a person cluster when linkedUserEmail is explicitly null', async () => {
    const clusters: FakePersonCluster[] = [{ id: 1, linked_user_email: 'guest@example.com' }];
    const fake = createFakeEnv(clusters, ['guest@example.com']);

    const res = await peopleRouter.request(
      'http://localhost/1',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkedUserEmail: null }) },
      makeEnv(fake)
    );

    expect(res.status).toBe(200);
    expect(clusters[0].linked_user_email).toBeNull();
  });

  it('leaves linked_user_email untouched when the field is omitted entirely', async () => {
    const clusters: FakePersonCluster[] = [{ id: 1, linked_user_email: 'guest@example.com' }];
    const fake = createFakeEnv(clusters, ['guest@example.com']);

    const res = await peopleRouter.request(
      'http://localhost/1',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Jane Doe' }) },
      makeEnv(fake)
    );

    expect(res.status).toBe(200);
    expect(clusters[0].linked_user_email).toBe('guest@example.com');
  });

  it('returns 404 for an unknown person id', async () => {
    const fake = createFakeEnv([], ['guest@example.com']);

    const res = await peopleRouter.request(
      'http://localhost/999',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkedUserEmail: 'guest@example.com' }) },
      makeEnv(fake)
    );

    expect(res.status).toBe(404);
  });

  it('rejects non-admin requests', async () => {
    currentIsAdmin = false;
    const clusters: FakePersonCluster[] = [{ id: 1, linked_user_email: null }];
    const fake = createFakeEnv(clusters, ['guest@example.com']);

    const res = await peopleRouter.request(
      'http://localhost/1',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkedUserEmail: 'guest@example.com' }) },
      makeEnv(fake)
    );

    expect(res.status).toBe(403);
  });
});
