import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bypass Cloudflare Access JWT parsing — the admin gate itself is covered by
// auth.test.ts/accessControl.test.ts. These tests are about the feed query.
vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>();
  return {
    ...actual,
    requireAdmin: async (c: any, next: any) => {
      c.set('user', { id: 'u1', email: 'admin@example.com' });
      await next();
    },
  };
});

import { Hono } from 'hono';
import analyticsRouter from '../routes/admin/analytics';

interface ActivityRow {
  id: number;
  event_id: number | null;
  actor_email: string;
  action: string;
  metadata: string | null;
  created_at: string;
}

interface CollabRow {
  id: number;
  event_id: number;
  user_email: string;
  action_type: string;
  target_user_email: string | null;
  metadata: string | null;
  created_at: string;
}

/**
 * Stands in for D1 by executing the union endpoint's shape in JS: both source
 * tables are normalised the same way the SQL does, then filtered/sorted/limited
 * against the bound parameters. Good enough to lock in the behaviours that
 * matter here — interleaving by time, the `collab_` namespacing, cursor
 * paging, and the filters — without a real SQLite.
 */
function createFakeEnv(activity: ActivityRow[], collab: CollabRow[], events: { id: number; slug: string; name: string }[]) {
  const db = {
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async first<T>() {
          return null as T | null;
        },
        async all<T>() {
          if (query.includes('SELECT DISTINCT actor_email')) {
            const emails = new Set([
              ...activity.map((a) => a.actor_email),
              ...collab.map((h) => h.user_email),
            ]);
            return { results: Array.from(emails).sort().map((actor_email) => ({ actor_email })) as T[] };
          }

          if (!query.includes('UNION ALL')) {
            return { results: [] as T[] };
          }

          const eventFor = (id: number | null) => events.find((e) => e.id === id) || null;

          let rows = [
            ...activity.map((a) => ({
              source: 'activity',
              id: a.id,
              event_id: a.event_id,
              actor_email: a.actor_email,
              action: a.action,
              target_type: null,
              target_id: null,
              target_user_email: null,
              metadata: a.metadata,
              created_at: a.created_at,
              event_name: eventFor(a.event_id)?.name ?? null,
              event_slug: eventFor(a.event_id)?.slug ?? null,
            })),
            ...collab.map((h) => ({
              source: 'collab',
              id: h.id,
              event_id: h.event_id,
              actor_email: h.user_email,
              action: `collab_${h.action_type}`,
              target_type: null,
              target_id: null,
              target_user_email: h.target_user_email,
              metadata: h.metadata,
              created_at: h.created_at,
              event_name: eventFor(h.event_id)?.name ?? null,
              event_slug: eventFor(h.event_id)?.slug ?? null,
            })),
          ];

          // Bound params arrive in the order the handler pushes them:
          // before, eventSlug, actor, ...action prefixes, then limit.
          const args = [...boundArgs];
          const limit = args.pop() as number;

          if (query.includes('t.created_at < ?')) {
            const before = args.shift() as string;
            rows = rows.filter((r) => r.created_at < before);
          }
          if (query.includes('e.slug = ?')) {
            const slug = args.shift() as string;
            rows = rows.filter((r) => r.event_slug === slug);
          }
          if (query.includes('LOWER(t.actor_email) = LOWER(?)')) {
            const actor = (args.shift() as string).toLowerCase();
            rows = rows.filter((r) => r.actor_email.toLowerCase() === actor);
          }
          if (query.includes('t.action LIKE ?')) {
            const prefixes = args.map((a) => String(a).replace('%', ''));
            rows = rows.filter((r) => prefixes.some((p) => r.action.startsWith(p)));
          }

          rows.sort((a, b) =>
            a.created_at === b.created_at ? b.id - a.id : (a.created_at < b.created_at ? 1 : -1)
          );

          return { results: rows.slice(0, limit) as T[] };
        },
      };
      return stmt;
    },
  };

  return { DB: db } as any;
}

function buildApp() {
  const app = new Hono();
  app.route('/stats', analyticsRouter);
  return app;
}

describe('GET /admin/stats/activity', () => {
  let activity: ActivityRow[];
  let collab: CollabRow[];
  let env: ReturnType<typeof createFakeEnv>;

  beforeEach(() => {
    activity = [
      { id: 1, event_id: 1, actor_email: 'admin@example.com', action: 'photo_trash', metadata: null, created_at: '2026-08-06 10:00:00' },
      { id: 2, event_id: 1, actor_email: 'admin@example.com', action: 'event_update', metadata: JSON.stringify({ changed: ['visibility'] }), created_at: '2026-08-06 08:00:00' },
      { id: 3, event_id: null, actor_email: 'admin@example.com', action: 'tag_create', metadata: null, created_at: '2026-08-05 08:00:00' },
    ];
    collab = [
      { id: 1, event_id: 1, user_email: 'friend@example.com', action_type: 'upload', target_user_email: null, metadata: null, created_at: '2026-08-06 09:00:00' },
      { id: 2, event_id: 1, user_email: 'admin@example.com', action_type: 'invite', target_user_email: 'friend@example.com', metadata: null, created_at: '2026-08-06 07:00:00' },
    ];
    env = createFakeEnv(activity, collab, [{ id: 1, slug: 'my-event', name: 'My Event' }]);
  });

  it('interleaves both sources by time, newest first', async () => {
    const res = await buildApp().request('/stats/activity', {}, env);
    expect(res.status).toBe(200);

    const body = await res.json<{ activity: any[] }>();
    expect(body.activity.map((e) => e.created_at)).toEqual([
      '2026-08-06 10:00:00',
      '2026-08-06 09:00:00',
      '2026-08-06 08:00:00',
      '2026-08-06 07:00:00',
      '2026-08-05 08:00:00',
    ]);
  });

  it('namespaces collaboration actions and tags each row with its source', async () => {
    const res = await buildApp().request('/stats/activity', {}, env);
    const body = await res.json<{ activity: any[] }>();

    const upload = body.activity.find((e) => e.created_at === '2026-08-06 09:00:00');
    expect(upload.source).toBe('collab');
    expect(upload.action).toBe('collab_upload');

    const trash = body.activity.find((e) => e.created_at === '2026-08-06 10:00:00');
    expect(trash.source).toBe('activity');
    expect(trash.action).toBe('photo_trash');
  });

  it('emits rows whose id collides across sources, so callers must key on source+id', async () => {
    const res = await buildApp().request('/stats/activity', {}, env);
    const body = await res.json<{ activity: any[] }>();

    const ids = body.activity.map((e) => e.id);
    expect(new Set(ids).size).toBeLessThan(ids.length);

    const composite = body.activity.map((e) => `${e.source}-${e.id}`);
    expect(new Set(composite).size).toBe(composite.length);
  });

  it('paginates with a cursor and stops when the last page is reached', async () => {
    const first = await buildApp().request('/stats/activity?limit=2', {}, env);
    const firstBody = await first.json<{ activity: any[]; nextCursor: string | null }>();
    expect(firstBody.activity).toHaveLength(2);
    expect(firstBody.nextCursor).toBe('2026-08-06 09:00:00');

    const second = await buildApp().request(
      `/stats/activity?limit=2&before=${encodeURIComponent(firstBody.nextCursor!)}`,
      {},
      env
    );
    const secondBody = await second.json<{ activity: any[]; nextCursor: string | null }>();
    expect(secondBody.activity.map((e) => e.created_at)).toEqual([
      '2026-08-06 08:00:00',
      '2026-08-06 07:00:00',
    ]);

    const third = await buildApp().request(
      `/stats/activity?limit=2&before=${encodeURIComponent(secondBody.nextCursor!)}`,
      {},
      env
    );
    const thirdBody = await third.json<{ activity: any[]; nextCursor: string | null }>();
    expect(thirdBody.activity).toHaveLength(1);
    // Last page: fewer rows than the limit means no further cursor.
    expect(thirdBody.nextCursor).toBeNull();
  });

  it('filters by domain, mapping the domain to its action prefix', async () => {
    const res = await buildApp().request('/stats/activity?domain=sharing', {}, env);
    const body = await res.json<{ activity: any[] }>();

    expect(body.activity).toHaveLength(2);
    expect(body.activity.every((e) => e.action.startsWith('collab_'))).toBe(true);
  });

  it('filters by actor across both sources', async () => {
    const res = await buildApp().request('/stats/activity?actor=friend@example.com', {}, env);
    const body = await res.json<{ activity: any[] }>();

    expect(body.activity).toHaveLength(1);
    expect(body.activity[0].action).toBe('collab_upload');
  });

  it('ignores an unknown domain rather than returning nothing', async () => {
    const res = await buildApp().request('/stats/activity?domain=nonsense', {}, env);
    const body = await res.json<{ activity: any[] }>();

    expect(body.activity).toHaveLength(5);
  });
});

describe('GET /admin/stats/activity/actors', () => {
  it('returns the distinct actors across both feeds', async () => {
    const env = createFakeEnv(
      [{ id: 1, event_id: null, actor_email: 'admin@example.com', action: 'tag_create', metadata: null, created_at: '2026-08-06 10:00:00' }],
      [{ id: 1, event_id: 1, user_email: 'friend@example.com', action_type: 'upload', target_user_email: null, metadata: null, created_at: '2026-08-06 09:00:00' }],
      [{ id: 1, slug: 'my-event', name: 'My Event' }]
    );

    const res = await buildApp().request('/stats/activity/actors', {}, env);
    expect(res.status).toBe(200);

    const body = await res.json<{ actors: string[] }>();
    expect(body.actors).toEqual(['admin@example.com', 'friend@example.com']);
  });
});
