import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { URL } from 'node:url';
import type { Context, Next } from 'hono';
import type { Env, User } from '../types';

let user: User | null = null;
let admin = false;
let passwordAccess = false;

vi.mock('../auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('../auth')>(),
  optionalAuth: async (_c: Context, next: Next) => next(),
  requireAdmin: async (_c: Context, next: Next) => next(),
  getUser: () => user,
  isAdmin: () => admin,
  getCollaboratorRoleByEventId: async (db: D1Database, eventId: number, email: string) =>
    (await db.prepare('SELECT role FROM event_collaborators WHERE event_id = ? AND user_email = ?')
      .bind(eventId, email).first<{ role: string }>())?.role ?? null,
}));
vi.mock('../cookies', () => ({ hasEventSessionAccess: async () => passwordAccess }));

import publicRoutes from '../routes/public';
import peopleRoutes from '../routes/admin/people';
import { getUnattachedPhotos } from '../faceClustering';
import { runAiEnrichment } from '../aiEnrichment';
import { runStaleUploadCleanup, runUploadNotifications } from '../scheduled';

interface RecordedQuery {
  sql: string;
  args: SQLInputValue[];
}

let db: DatabaseSync;
let queries: RecordedQuery[];
let env: Env;

function d1(): D1Database {
  return {
    prepare(sql: string) {
      let args: SQLInputValue[] = [];
      const execute = () => {
        queries.push({ sql, args });
        return db.prepare(sql);
      };
      const statement = {
        bind(...values: SQLInputValue[]) { args = values; return statement; },
        async all() { return { results: execute().all(...args) }; },
        async first() { return execute().get(...args) ?? null; },
        async run() { return { meta: { changes: Number(execute().run(...args).changes) } }; },
      };
      return statement;
    },
  } as D1Database;
}

function plan(query: RecordedQuery): string {
  return db.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.args).map((r) => r.detail).join('\n');
}

beforeEach(() => {
  user = null;
  admin = false;
  passwordAccess = false;
  queries = [];
  db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, visibility TEXT DEFAULT 'public',
      password_hash TEXT, inferred_date TEXT, created_at TEXT DEFAULT '2026-01-01'
    );
    CREATE TABLE photos (
      id TEXT PRIMARY KEY, event_id INTEGER, original_filename TEXT DEFAULT 'photo.jpg',
      file_type TEXT DEFAULT 'image/jpeg', cache_version INTEGER DEFAULT 1,
      capture_time TEXT, uploaded_at TEXT, uploaded_by TEXT,
      deleted_at TEXT, upload_complete INTEGER DEFAULT 1, preview_complete INTEGER DEFAULT 1,
      ai_processed_at TEXT, notified_at TEXT, source_photo_id TEXT, source_event_slug TEXT,
      is_featured INTEGER DEFAULT 0, city TEXT, width INTEGER, height INTEGER, blur_placeholder TEXT
    );
    CREATE TABLE photo_faces (id INTEGER PRIMARY KEY, photo_id TEXT, person_id INTEGER);
    CREATE TABLE photo_person_tags (photo_id TEXT, person_id INTEGER, PRIMARY KEY(photo_id, person_id));
    CREATE TABLE person_clusters (
      id INTEGER PRIMARY KEY, name TEXT, face_count INTEGER DEFAULT 0, cover_photo_id TEXT,
      linked_user_email TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE users (email TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE event_collaborators (event_id INTEGER, user_email TEXT, role TEXT);
    CREATE INDEX idx_collaborators_lookup ON event_collaborators(event_id, user_email);
    CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
    CREATE TABLE event_tags (event_id INTEGER, tag_id INTEGER);
    CREATE INDEX idx_photos_deleted_at ON photos(deleted_at);
    CREATE INDEX idx_photos_event_time ON photos(event_id, capture_time);
    CREATE INDEX idx_photos_ai_processed_at ON photos(ai_processed_at);
    CREATE INDEX idx_photo_faces_person_id ON photo_faces(person_id);
    CREATE INDEX idx_photo_faces_photo_id ON photo_faces(photo_id);
    CREATE INDEX idx_photo_person_tags_person_id ON photo_person_tags(person_id);
    WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<42)
    INSERT INTO events(id,slug,name) SELECT i,'event-'||i,'Event '||i FROM n;
    WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<12000)
    INSERT INTO photos(id,event_id,capture_time,uploaded_at,deleted_at,ai_processed_at,notified_at)
    SELECT 'p'||i, (i%42)+1, printf('2026-01-%02dT%02d:%02d:%02dZ',i%28+1,i%24,i%60,i/60%60),
      printf('2026-01-%02d',i%28+1), CASE WHEN i%13=0 THEN '2026-01-01' END,
      CASE WHEN i%3=0 THEN 'done' END, 'done' FROM n;
    WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<50)
    INSERT INTO person_clusters(id,name,face_count) SELECT i,'Person '||i,100 FROM n;
    WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<5000)
    INSERT INTO photo_faces(photo_id,person_id) SELECT 'p'||i,(i%50)+1 FROM n;
    WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<3000)
    INSERT INTO photo_person_tags(photo_id,person_id) SELECT 'p'||i,(i%50)+1 FROM n;
  `);
  db.exec(readFileSync(new URL('../../../../migrations/033_reduce_d1_reads.sql', import.meta.url), 'utf8'));
  // D1's PRAGMA optimize collects statistics for every table; desktop SQLite
  // can skip untouched tables, so collect the same fixture statistics explicitly.
  db.exec('ANALYZE');
  env = { DB: d1(), EVENT_COOKIE_SECRET: 'test-secret' } as Env;
});
afterEach(() => db.close());

describe('D1 query results and indexed plans on a 12,000-photo library', () => {
  it('seeks one thumbnail per event, preserving featured ordering and video metadata', async () => {
    db.exec(`
      UPDATE photos SET is_featured=1,file_type='video/mp4',cache_version=7 WHERE id='p42';
      UPDATE photos SET is_featured=1,capture_time='2000',deleted_at='2026' WHERE id='p84';
    `);
    const response = await publicRoutes.request('/api/events', {}, env);
    expect(response.status).toBe(200);
    const body = await response.json() as { events: { id: number; preview_photo_id: string; preview_photo_file_type: string; preview_photo_cache_version: number }[] };
    expect(body.events.find((e) => e.id === 1)).toMatchObject({
      preview_photo_id: 'p42', preview_photo_file_type: 'video/mp4', preview_photo_cache_version: 7,
    });
    for (const event of body.events) {
      const expected = db.prepare(`SELECT id FROM photos WHERE event_id=? AND deleted_at IS NULL
        ORDER BY is_featured DESC,capture_time ASC LIMIT 1`).get(event.id);
      expect(event.preview_photo_id).toBe(expected?.id);
    }
    const thumbnail = queries.find((q) => q.sql.includes('as photo_id'))!;
    expect(plan(thumbnail)).toContain('idx_photos_active_event_preview');
    expect(plan(thumbnail)).not.toContain('USE TEMP B-TREE');
    const eventList = queries.find((q) => q.sql.includes('as latest_upload'))!;
    expect(plan(eventList)).toContain('idx_photos_event_uploaded_at');
  });

  it('finds event-scoped people using faces and tags, without duplicates or trashed-only matches', async () => {
    db.exec(`
      INSERT INTO person_clusters(id,name) VALUES(100,'Manual only'),(101,'Trash only');
      INSERT INTO photo_person_tags VALUES('p42',100),('p84',101);
      UPDATE photos SET deleted_at='2026' WHERE id='p84';
      INSERT INTO photo_faces(photo_id,person_id) VALUES('p42',100),('p42',100);
    `);
    const response = await publicRoutes.request('/api/people/named?event=event-1', {}, env);
    expect(response.status).toBe(200);
    const body = await response.json() as { people: { id: number }[] };
    const expected = db.prepare(`SELECT DISTINCT person_id AS id FROM (
      SELECT pf.person_id FROM photo_faces pf JOIN photos p ON p.id=pf.photo_id WHERE p.event_id=1 AND p.deleted_at IS NULL
      UNION SELECT pt.person_id FROM photo_person_tags pt JOIN photos p ON p.id=pt.photo_id WHERE p.event_id=1 AND p.deleted_at IS NULL
    ) WHERE person_id IS NOT NULL ORDER BY id`).all();
    expect(body.people.map((p) => p.id).sort((a, b) => a-b)).toEqual(expected.map((p) => p.id));
    expect(body.people.some((p) => p.id === 100)).toBe(true);
    expect(body.people.some((p) => p.id === 101)).toBe(false);
    const query = queries.find((q) => q.sql.includes('pc.id IN'))!;
    expect(plan(query)).toContain('event_id=?');
    expect(plan(query)).not.toContain('CORRELATED SCALAR SUBQUERY');
  });

  it('preserves private, collaborator and event-password boundaries for people filters', async () => {
    db.exec(`
      UPDATE events SET visibility='private' WHERE id=2;
      UPDATE events SET visibility='collaborators_only' WHERE id=3;
      UPDATE events SET password_hash='hash' WHERE id=4;
      INSERT INTO event_collaborators VALUES(3,'guest@example.com','viewer');
    `);
    for (const slug of ['event-2', 'event-3', 'event-4', 'missing']) {
      const response = await publicRoutes.request(`/api/people/named?event=${slug}`, {}, env);
      expect(await response.json()).toEqual({ people: [] });
    }
    user = { id: 'guest', email: 'guest@example.com' };
    const allowed = await publicRoutes.request('/api/people/named?event=event-3', {}, env);
    expect((await allowed.json() as { people: unknown[] }).people.length).toBeGreaterThan(0);
    passwordAccess = true;
    const unlocked = await publicRoutes.request('/api/people/named?event=event-4', {}, env);
    expect((await unlocked.json() as { people: unknown[] }).people.length).toBeGreaterThan(0);
  });

  it('global people filtering excludes inaccessible-only names and keeps admin-only orphan names', async () => {
    db.exec(`
      UPDATE events SET visibility='private' WHERE id=2;
      UPDATE events SET visibility='collaborators_only' WHERE id=3;
      INSERT INTO person_clusters(id,name) VALUES(100,'Private'),(101,'Collaborator'),(102,'Orphan');
      INSERT INTO photo_person_tags VALUES('p1',100),('p2',101);
      INSERT INTO event_collaborators VALUES(3,'guest@example.com','viewer');
    `);
    const names = async () => {
      const response = await publicRoutes.request('/api/people/named', {}, env);
      expect(response.status).toBe(200);
      return (await response.json() as { people: { id: number }[] }).people.map((p) => p.id);
    };
    expect(await names()).not.toContain(100);
    expect(await names()).not.toContain(101);
    user = { id: 'guest', email: 'guest@example.com' };
    expect(await names()).toContain(101);
    expect(await names()).not.toContain(100);
    admin = true;
    expect(await names()).toEqual(expect.arrayContaining([100,101,102]));
  });

  it('uses covering membership indexes for counts and ID-driven person details', async () => {
    const list = await peopleRoutes.request('/', {}, env);
    expect(list.status).toBe(200);
    const people = (await list.json() as { people: { id: number; photo_count: number }[] }).people;
    for (const person of people) {
      const expected = db.prepare(`SELECT COUNT(*) AS n FROM (
        SELECT photo_id FROM photo_faces WHERE person_id=?
        UNION SELECT photo_id FROM photo_person_tags WHERE person_id=?
      )`).get(person.id, person.id);
      expect(person.photo_count).toBe(expected?.n);
    }
    const countQuery = queries.at(-1)!;
    expect(plan(countQuery)).toContain('COVERING INDEX idx_photo_faces_person_photo');
    expect(plan(countQuery)).toContain('COVERING INDEX idx_photo_person_tags_person_photo');
    const detail = await peopleRoutes.request('/1', {}, env);
    expect(detail.status).toBe(200);
    const detailPlan = plan(queries.at(-1)!);
    expect(detailPlan).toContain('sqlite_autoindex_photos_1 (id=?)');
    expect(detailPlan).not.toContain('idx_photos_deleted_at');
    const lookup: RecordedQuery = {
      sql: 'SELECT p.id,p.event_id FROM photos p WHERE p.id IN (?,?,?,?,?,?,?) AND p.deleted_at IS NULL',
      args: ['p1','p2','p3','p4','p5','p6','p7'],
    };
    expect(plan(lookup)).toContain('sqlite_autoindex_photos_1 (id=?)');
  });

  it('paginates unattached photos with indexed anti-lookups rather than rebuilding all memberships', async () => {
    const first = await getUnattachedPhotos(env, null, 100);
    const second = await getUnattachedPhotos(env, first.nextCursor, 100);
    expect(first.photos).toHaveLength(100);
    expect(second.photos).toHaveLength(100);
    expect(new Set([...first.photos, ...second.photos].map((p) => p.id)).size).toBe(200);
    for (const photo of [...first.photos, ...second.photos]) {
      expect(db.prepare('SELECT 1 FROM photo_faces WHERE photo_id=? AND person_id IS NOT NULL').get(photo.id)).toBeUndefined();
      expect(db.prepare('SELECT 1 FROM photo_person_tags WHERE photo_id=?').get(photo.id)).toBeUndefined();
    }
    const queryPlan = plan(queries[0]);
    expect(queryPlan).toContain('idx_photos_active_capture');
    expect(queryPlan).toContain('idx_photo_faces_photo_person');
    expect(queryPlan).not.toContain('USE TEMP B-TREE');
  });

  it('uses small maintenance queues and does not process photos when the queue is empty', async () => {
    db.exec("UPDATE photos SET ai_processed_at='done'");
    env.AI = { run: vi.fn() } as unknown as Env['AI'];
    await runAiEnrichment(env);
    expect(env.AI?.run).not.toHaveBeenCalled();
    expect(plan(queries.at(-1)!)).toContain('idx_photos_ai_queue');
    expect(plan(queries.at(-1)!)).not.toContain('USE TEMP B-TREE');
    await runUploadNotifications(env);
    expect(plan(queries.at(-1)!)).toContain('idx_photos_notification_queue');
    await runStaleUploadCleanup(env);
    expect(plan(queries.at(-1)!)).toContain('idx_photos_stale_uploads');
  });
});
