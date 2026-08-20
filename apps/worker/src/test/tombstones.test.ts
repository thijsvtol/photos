import { describe, it, expect } from 'vitest';
import {
  recordSoftDeleteTombstones,
  removeTombstone,
  markTombstonesPurged,
  getDeletionsForUser,
} from '../tombstones';

interface Row {
  id: number;
  photo_id: string;
  uploaded_by: string | null;
  deleted_by: string | null;
  deleted_at: string;
  purged_at: string | null;
}

/**
 * In-memory fake of the photo_tombstones table that understands exactly the queries tombstones.ts
 * issues, so upsert/delete/purge/feed semantics (compound cursor, tie-breaking, deleted_by filter,
 * purged-only) are really exercised rather than string-matched. A monotonic clock makes the
 * datetime('now') values deterministic; note markTombstonesPurged stamps ONE timestamp for a whole
 * batch, so several rows share a purged_at — the case the (purged_at, id) cursor must handle.
 */
function makeDb() {
  const rows: Row[] = [];
  let seq = 0;
  let clock = 0;
  const stamp = () => `2026-01-01T00:00:${String(clock++).padStart(3, '0')}Z`;

  function exec(query: string, args: unknown[]): any {
    if (query.includes('INSERT INTO photo_tombstones')) {
      const [photo_id, uploaded_by, deleted_by] = args as [string, string | null, string];
      const existing = rows.find((r) => r.photo_id === photo_id);
      const deleted_at = stamp();
      if (existing) {
        existing.uploaded_by = uploaded_by;
        existing.deleted_by = deleted_by;
        existing.deleted_at = deleted_at;
        existing.purged_at = null;
      } else {
        rows.push({ id: ++seq, photo_id, uploaded_by, deleted_by, deleted_at, purged_at: null });
      }
      return { success: true };
    }
    if (query.includes('DELETE FROM photo_tombstones')) {
      const [photo_id] = args as [string];
      const i = rows.findIndex((r) => r.photo_id === photo_id);
      if (i >= 0) rows.splice(i, 1);
      return { success: true };
    }
    if (query.includes('UPDATE photo_tombstones SET purged_at')) {
      const purged_at = stamp(); // one timestamp for the whole batch → intentional ties
      for (const id of args as string[]) {
        const r = rows.find((x) => x.photo_id === id);
        if (r && r.purged_at == null) r.purged_at = purged_at;
      }
      return { success: true };
    }
    const sorted = (email: string) =>
      rows
        .filter((r) => r.deleted_by === email && r.purged_at != null)
        .sort((a, b) => (a.purged_at === b.purged_at ? a.id - b.id : a.purged_at!.localeCompare(b.purged_at!)));
    if (query.includes('ORDER BY purged_at DESC')) {
      const [email] = args as [string];
      const m = sorted(email);
      const last = m[m.length - 1];
      return last ? { purgedAt: last.purged_at, id: last.id } : null;
    }
    if (query.includes('ORDER BY purged_at ASC')) {
      const [email, p1, p2, afterId, limit] = args as [string, string, string, number, number];
      const m = sorted(email)
        .filter((r) => r.purged_at! > p1 || (r.purged_at === p2 && r.id > afterId))
        .slice(0, limit);
      return { results: m.map((r) => ({ photoId: r.photo_id, purgedAt: r.purged_at, id: r.id })) };
    }
    return { success: true };
  }

  const db = {
    prepare(query: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() { return exec(query, args); },
            async first() { return exec(query, args); },
            async all() { return exec(query, args); },
          };
        },
      };
    },
    async batch(stmts: { run: () => Promise<unknown> }[]) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
  return { env: { DB: db } as any, rows };
}

describe('tombstones', () => {
  it('records unpurged tombstones on soft-delete and does NOT expose them in the feed yet', async () => {
    const { env } = makeDb();
    await recordSoftDeleteTombstones(env, [
      { id: 'p1', uploadedBy: 'me@x.com' },
      { id: 'p2', uploadedBy: 'me@x.com' },
    ], 'me@x.com');

    const page = await getDeletionsForUser(env, 'me@x.com', null, 50, false);
    expect(page.deletions).toHaveLength(0); // not purged yet → purge-gated
    const head = await getDeletionsForUser(env, 'me@x.com', null, 50, true);
    expect(head.nextCursor).toBeNull();
  });

  it('exposes a photo in the feed only once purged, and only to the account that deleted it', async () => {
    const { env } = makeDb();
    await recordSoftDeleteTombstones(env, [{ id: 'p1', uploadedBy: 'owner@x.com' }], 'me@x.com');
    await recordSoftDeleteTombstones(env, [{ id: 'p2', uploadedBy: 'owner@x.com' }], 'other@x.com');

    await markTombstonesPurged(env, ['p1', 'p2']);

    const mine = await getDeletionsForUser(env, 'me@x.com', null, 50, false);
    expect(mine.deletions.map((d) => d.photoId)).toEqual(['p1']); // deleted_by filter

    const other = await getDeletionsForUser(env, 'other@x.com', null, 50, false);
    expect(other.deletions.map((d) => d.photoId)).toEqual(['p2']);
  });

  it('removes the tombstone on restore, so it never becomes eligible even if later purged', async () => {
    const { env } = makeDb();
    await recordSoftDeleteTombstones(env, [{ id: 'p1', uploadedBy: 'me@x.com' }], 'me@x.com');
    await removeTombstone(env, 'p1');
    await markTombstonesPurged(env, ['p1']); // no-op: row is gone

    const page = await getDeletionsForUser(env, 'me@x.com', null, 50, false);
    expect(page.deletions).toHaveLength(0);
  });

  it('re-deleting after a restore resets purged_at (a stale purge never resurfaces)', async () => {
    const { env } = makeDb();
    await recordSoftDeleteTombstones(env, [{ id: 'p1', uploadedBy: 'me@x.com' }], 'me@x.com');
    await markTombstonesPurged(env, ['p1']);          // purged once
    await removeTombstone(env, 'p1');                  // restored → tombstone gone
    await recordSoftDeleteTombstones(env, [{ id: 'p1', uploadedBy: 'me@x.com' }], 'me@x.com'); // re-deleted
    // Not purged again yet, so the feed must be empty despite the earlier purge.
    const page = await getDeletionsForUser(env, 'me@x.com', null, 50, false);
    expect(page.deletions).toHaveLength(0);
  });

  it('paginates with a stable compound cursor even when many rows share one purged_at', async () => {
    const { env } = makeDb();
    await recordSoftDeleteTombstones(env, [
      { id: 'p1', uploadedBy: 'me@x.com' },
      { id: 'p2', uploadedBy: 'me@x.com' },
      { id: 'p3', uploadedBy: 'me@x.com' },
    ], 'me@x.com');
    await markTombstonesPurged(env, ['p1', 'p2', 'p3']); // all share one purged_at → id tie-break

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: any = await getDeletionsForUser(env, 'me@x.com', cursor, 1, false);
      if (page.deletions.length === 0) break;
      seen.push(page.deletions[0].photoId);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(['p1', 'p2', 'p3']); // every row, in order, no dupes/skips
  });

  it('head cursor lets a fresh opt-in start from "now" (skips already-purged photos)', async () => {
    const { env } = makeDb();
    await recordSoftDeleteTombstones(env, [{ id: 'old', uploadedBy: 'me@x.com' }], 'me@x.com');
    await markTombstonesPurged(env, ['old']); // purged BEFORE opt-in

    const head = await getDeletionsForUser(env, 'me@x.com', null, 50, true);
    expect(head.deletions).toHaveLength(0);
    expect(head.nextCursor).not.toBeNull();

    // A later delete+purge AFTER opting in should be picked up from the head cursor.
    await recordSoftDeleteTombstones(env, [{ id: 'new', uploadedBy: 'me@x.com' }], 'me@x.com');
    await markTombstonesPurged(env, ['new']);

    const page = await getDeletionsForUser(env, 'me@x.com', head.nextCursor, 50, false);
    expect(page.deletions.map((d) => d.photoId)).toEqual(['new']); // 'old' is not re-deleted
  });
});
