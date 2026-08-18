import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { getUnnamedPeopleWithSuggestions, mergeConfidentUnnamedIntoTagged } from '../faceClustering';
import type { Env } from '../types';

/**
 * End-to-end tests for the unnamed-people cleanup, running the REAL SQL against an in-memory
 * SQLite (node:sqlite, built into Node — no extra dependency), the same approach as
 * copiesAreNotDuplicates.test.ts. The worker's other tests use hand-rolled query-string mocks
 * that can't execute the CTE/UNION aggregation here, so this is what actually verifies the
 * suggestion query, the centroid BLOB round-trip, and the merge behaviour end-to-end.
 */

/** Minimal D1-compatible adapter over node:sqlite: supports prepare().bind().all()/first()/run()
 *  and the { results } / value / { meta.changes } shapes the worker code relies on. Converts
 *  ArrayBuffer bind params to Uint8Array (D1 accepts ArrayBuffer; node:sqlite wants a view). */
function d1(db: DatabaseSync): Env['DB'] {
  const toParam = (v: unknown) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v);
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a.map(toParam);
          return stmt;
        },
        async all<T>() {
          return { results: db.prepare(sql).all(...(args as any[])) as T[] };
        },
        async first<T>() {
          const row = db.prepare(sql).get(...(args as any[]));
          return (row ?? null) as T | null;
        },
        async run() {
          const info = db.prepare(sql).run(...(args as any[]));
          return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
        },
      };
      return stmt;
    },
  } as unknown as Env['DB'];
}

const blob = (...xs: number[]) => new Uint8Array(Float32Array.from(xs).buffer);

function seed(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE events (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);
    CREATE TABLE photos (id TEXT PRIMARY KEY, event_id INTEGER, file_type TEXT, cache_version INTEGER);
    CREATE TABLE person_clusters (
      id INTEGER PRIMARY KEY,
      name TEXT,
      cover_photo_id TEXT,
      centroid_embedding BLOB NOT NULL,
      face_count INTEGER NOT NULL DEFAULT 0,
      linked_user_email TEXT,
      updated_at TEXT
    );
    CREATE TABLE photo_faces (id INTEGER PRIMARY KEY, photo_id TEXT, person_id INTEGER, embedding BLOB);
    CREATE TABLE photo_person_tags (photo_id TEXT, person_id INTEGER, PRIMARY KEY (photo_id, person_id));
    INSERT INTO events (id, slug, name) VALUES (1, 'ev1', 'Event 1');
    INSERT INTO photos (id, event_id, file_type, cache_version) VALUES
      ('p1', 1, 'image/jpeg', 1), ('p2', 1, 'image/jpeg', 1), ('p3', 1, 'image/jpeg', 1);
  `);
  return db;
}

const addNamed = (db: DatabaseSync, id: number, name: string, centroid: Uint8Array, faceCount = 0) =>
  db.prepare('INSERT INTO person_clusters (id, name, centroid_embedding, face_count) VALUES (?,?,?,?)')
    .run(id, name, centroid, faceCount);
const addUnnamed = (db: DatabaseSync, id: number, centroid: Uint8Array, faceCount: number, cover: string) =>
  db.prepare('INSERT INTO person_clusters (id, name, cover_photo_id, centroid_embedding, face_count) VALUES (?,NULL,?,?,?)')
    .run(id, cover, centroid, faceCount);
const addFace = (db: DatabaseSync, id: number, photoId: string, personId: number | null) =>
  db.prepare('INSERT INTO photo_faces (id, photo_id, person_id, embedding) VALUES (?,?,?,?)')
    .run(id, photoId, personId, blob(0));
const addTag = (db: DatabaseSync, photoId: string, personId: number) =>
  db.prepare('INSERT INTO photo_person_tags (photo_id, person_id) VALUES (?,?)').run(photoId, personId);

describe('getUnnamedPeopleWithSuggestions (real SQL)', () => {
  it('suggests + flags confident when an unnamed cluster\'s photos are all tagged to one named person', async () => {
    const db = seed();
    addNamed(db, 5, 'Anna', blob(1, 0));            // named, tagged on every photo
    addUnnamed(db, 10, blob(1, 0), 3, 'p1');        // same centroid → cosine 1
    addFace(db, 1, 'p1', 10);
    addFace(db, 2, 'p2', 10);
    addFace(db, 3, 'p3', 10);
    addTag(db, 'p1', 5);
    addTag(db, 'p2', 5);
    addTag(db, 'p3', 5);

    const people = await getUnnamedPeopleWithSuggestions({ DB: d1(db) } as Env);

    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ id: 10, photo_count: 3, confident: true });
    expect(people[0].suggestion).toMatchObject({ personId: 5, name: 'Anna', sharedPhotos: 3, totalPhotos: 3 });
    expect(people[0].suggestion!.centroidSimilarity).toBeCloseTo(1);
    expect(people[0].cover_event_slug).toBe('ev1');
  });

  it('does NOT flag confident when the tagged named person is a different face (centroid guard)', async () => {
    const db = seed();
    addNamed(db, 7, 'Chris', blob(0, 1));           // orthogonal centroid → cosine 0
    addUnnamed(db, 11, blob(1, 0), 3, 'p1');
    addFace(db, 1, 'p1', 11);
    addFace(db, 2, 'p2', 11);
    addFace(db, 3, 'p3', 11);
    addTag(db, 'p1', 7);
    addTag(db, 'p2', 7);
    addTag(db, 'p3', 7);

    const people = await getUnnamedPeopleWithSuggestions({ DB: d1(db) } as Env);
    expect(people[0].suggestion).toMatchObject({ personId: 7, name: 'Chris' });
    expect(people[0].confident).toBe(false);
  });
});

describe('mergeConfidentUnnamedIntoTagged (real SQL)', () => {
  it('merges the confident cluster into its named person and leaves ambiguous ones alone', async () => {
    const db = seed();
    // Confident: unnamed 10 → Anna(5).
    addNamed(db, 5, 'Anna', blob(1, 0), 0);
    addUnnamed(db, 10, blob(1, 0), 3, 'p1');
    for (const [fid, pid] of [[1, 'p1'], [2, 'p2'], [3, 'p3']] as const) addFace(db, fid, pid, 10);
    for (const p of ['p1', 'p2', 'p3']) addTag(db, p, 5);

    // Not confident: unnamed 11 whose (only) face-photo is tagged to a DIFFERENT face (Chris).
    addNamed(db, 7, 'Chris', blob(0, 1), 0);
    db.prepare('INSERT INTO photos (id, event_id, file_type, cache_version) VALUES (?,?,?,?)').run('q1', 1, 'image/jpeg', 1);
    addUnnamed(db, 11, blob(1, 0), 1, 'q1');
    addFace(db, 9, 'q1', 11);
    addTag(db, 'q1', 7);

    const res = await mergeConfidentUnnamedIntoTagged({ DB: d1(db) } as Env);
    expect(res).toMatchObject({ merged: 1, remaining: 0 });

    // Unnamed 10 is gone; Anna absorbed its 3 faces and kept her name.
    const anna = db.prepare('SELECT name, face_count FROM person_clusters WHERE id = 5').get() as any;
    expect(anna.name).toBe('Anna');
    expect(anna.face_count).toBe(3);
    const clusterIds = (db.prepare('SELECT id FROM person_clusters ORDER BY id').all() as any[]).map((r) => r.id);
    expect(clusterIds).not.toContain(10);
    // The ambiguous cluster 11 survives for manual review.
    expect(clusterIds).toContain(11);
    const facesOnAnna = (db.prepare('SELECT COUNT(*) c FROM photo_faces WHERE person_id = 5').get() as any).c;
    expect(facesOnAnna).toBe(3);
  });
});
