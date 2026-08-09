import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

/**
 * Copying a photo to a second album must not make it look like a duplicate, and
 * must not make it appear twice in the timeline — while GENUINE double uploads
 * must keep doing both.
 *
 * That second half is the point of these tests. It is easy to "fix" the copy
 * complaint with a filter that also swallows real duplicates, which would hide a
 * problem the user needs to see instead of surfacing it.
 *
 * Runs the real SQL against an in-memory SQLite (node:sqlite, built into Node —
 * no extra dependency) rather than asserting on query strings, so the clauses are
 * checked for behaviour, not shape.
 */

const SINGLE_COPY_CLAUSE = `(p.source_photo_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM photos s WHERE s.id = p.source_photo_id AND s.deleted_at IS NULL
))`;

function seed() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE photos (
      id TEXT PRIMARY KEY,
      event_id INTEGER,
      capture_time TEXT,
      file_hash TEXT,
      source_photo_id TEXT,
      deleted_at TEXT
    );
  `);
  const insert = db.prepare('INSERT INTO photos (id, event_id, capture_time, file_hash, source_photo_id, deleted_at) VALUES (?,?,?,?,?,?)');
  const add = (id: string, eventId: number, hash: string | null, source: string | null, deleted: string | null = null) =>
    insert.run(id, eventId, '2026-05-01 10:00:00', hash, source, deleted);

  // An original and a deliberate copy of it in another album.
  add('orig', 1, 'hashA', null);
  add('copy-of-orig', 2, null, 'orig');

  // The same file uploaded twice, independently — a REAL duplicate.
  add('dupe-1', 1, 'hashB', null);
  add('dupe-2', 1, 'hashB', null);

  // A copy whose original has since been trashed.
  add('gone', 3, 'hashC', null, '2026-06-01 10:00:00');
  add('copy-of-gone', 4, null, 'gone');

  return db;
}

const ids = (db: DatabaseSync, sql: string): string[] =>
  (db.prepare(sql).all() as { id: string }[]).map((r) => r.id).sort();

describe('timeline shows one row per photo', () => {
  it('hides a copy while its original is still there', async () => {
    const db = seed();
    const rows = ids(db, `SELECT p.id FROM photos p WHERE p.deleted_at IS NULL AND ${SINGLE_COPY_CLAUSE}`);
    expect(rows).toContain('orig');
    expect(rows).not.toContain('copy-of-orig');
  });

  it('still shows a copy once its original is gone, so no hole appears', async () => {
    const db = seed();
    const rows = ids(db, `SELECT p.id FROM photos p WHERE p.deleted_at IS NULL AND ${SINGLE_COPY_CLAUSE}`);
    expect(rows).toContain('copy-of-gone');
  });

  it('leaves genuine double uploads visible twice', async () => {
    const db = seed();
    const rows = ids(db, `SELECT p.id FROM photos p WHERE p.deleted_at IS NULL AND ${SINGLE_COPY_CLAUSE}`);
    expect(rows).toContain('dupe-1');
    expect(rows).toContain('dupe-2');
  });
});

describe('duplicates listing', () => {
  // Mirrors GET /admin/photos/duplicates.
  const DUPLICATES_SQL = `
    SELECT p.id FROM photos p
    WHERE p.deleted_at IS NULL
      AND p.file_hash IS NOT NULL
      AND p.source_photo_id IS NULL
      AND p.file_hash IN (
        SELECT file_hash FROM photos
        WHERE deleted_at IS NULL AND file_hash IS NOT NULL AND source_photo_id IS NULL
        GROUP BY file_hash HAVING COUNT(*) > 1
      )
  `;

  it('reports genuine double uploads', async () => {
    const db = seed();
    expect(ids(db, DUPLICATES_SQL)).toEqual(['dupe-1', 'dupe-2']);
  });

  it('never reports a copy or the photo it was copied from', async () => {
    const db = seed();
    const rows = ids(db, DUPLICATES_SQL);
    expect(rows).not.toContain('copy-of-orig');
    expect(rows).not.toContain('orig');
  });

  it('stays clean even if a copy somehow carries its source\'s hash', async () => {
    // Migration 028 cleared these, but the query must not depend on that having
    // worked — the "keep an album" action deletes everything in a group but one.
    const db = seed();
    db.exec("UPDATE photos SET file_hash = 'hashA' WHERE id = 'copy-of-orig'");
    const rows = ids(db, DUPLICATES_SQL);
    expect(rows).not.toContain('copy-of-orig');
    expect(rows).not.toContain('orig');
  });
});

describe('file-hash backfill', () => {
  it('never offers a copy for hashing', async () => {
    const db = seed();
    const rows = ids(db, `
      SELECT p.id FROM photos p
      WHERE p.deleted_at IS NULL AND p.file_hash IS NULL AND p.source_photo_id IS NULL
    `);
    expect(rows).not.toContain('copy-of-orig');
    expect(rows).not.toContain('copy-of-gone');
  });
});
