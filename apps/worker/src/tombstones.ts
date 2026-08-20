import type { Env } from './types';

/**
 * Deletion-tombstone helpers (see migration 031_photo_tombstones.sql and
 * docs/local-delete-sync-design.md). Tombstones let an Android sync device learn a photo it
 * uploaded was PERMANENTLY deleted online, so it can (opt-in) remove the matching local original.
 *
 * They live in their own table with no FK to photos precisely so they survive the hard purge of
 * the photos row. This module centralises the four lifecycle writes + the feed query so the
 * exact SQL isn't duplicated across the delete/restore/purge call sites.
 */

// D1 caps bound parameters at 100 per statement.
const CHUNK = 90;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Records/refreshes a tombstone on SOFT delete (purged_at reset to NULL — a re-delete after a
 * restore must not look already-purged). Best-effort: tombstone failures must never break the
 * user-visible delete, so callers wrap this in try/catch and log.
 */
export async function recordSoftDeleteTombstones(
  env: Env,
  photos: { id: string; uploadedBy: string | null }[],
  deletedBy: string
): Promise<void> {
  if (photos.length === 0) return;
  const stmt = env.DB.prepare(
    `INSERT INTO photo_tombstones (photo_id, uploaded_by, deleted_by, deleted_at, purged_at)
     VALUES (?, ?, ?, datetime('now'), NULL)
     ON CONFLICT(photo_id) DO UPDATE SET
       uploaded_by = excluded.uploaded_by,
       deleted_by = excluded.deleted_by,
       deleted_at = excluded.deleted_at,
       purged_at = NULL`
  );
  // batch() runs the per-photo upserts in one round-trip; each has a fixed 3 bound params so
  // there's no per-statement parameter-limit concern.
  await env.DB.batch(photos.map((p) => stmt.bind(p.id, p.uploadedBy, deletedBy)));
}

/** Removes a tombstone on RESTORE, so a restored photo can never become "purged/eligible". */
export async function removeTombstone(env: Env, photoId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM photo_tombstones WHERE photo_id = ?').bind(photoId).run();
}

/**
 * Stamps purged_at on HARD delete — only purged tombstones are ever surfaced by the feed, which
 * is what makes local deletion purge-gated. Only touches rows that already exist (a photo
 * soft-deleted before this feature has no tombstone and is intentionally never propagated).
 */
export async function markTombstonesPurged(env: Env, photoIds: string[]): Promise<void> {
  if (photoIds.length === 0) return;
  for (const ids of chunk(photoIds, CHUNK)) {
    const placeholders = ids.map(() => '?').join(', ');
    await env.DB
      .prepare(
        `UPDATE photo_tombstones SET purged_at = datetime('now')
         WHERE purged_at IS NULL AND photo_id IN (${placeholders})`
      )
      .bind(...ids)
      .run();
  }
}

export interface DeletionsPage {
  deletions: { photoId: string; purgedAt: string }[];
  nextCursor: string | null;
}

/** Encodes/decodes the compound `(purged_at, id)` feed cursor as an opaque "purgedAt|id" string. */
function parseCursor(cursor: string | null): { purgedAt: string; id: number } {
  if (!cursor) return { purgedAt: '', id: 0 };
  const sep = cursor.lastIndexOf('|');
  if (sep < 0) return { purgedAt: '', id: 0 };
  const id = parseInt(cursor.slice(sep + 1), 10);
  return { purgedAt: cursor.slice(0, sep), id: Number.isFinite(id) ? id : 0 };
}

/**
 * The deletions feed for one account. Returns ONLY purged tombstones the caller themselves
 * deleted (`deleted_by = email`), ordered by a stable compound `(purged_at, id)` cursor so a
 * tombstone inserted early but purged later is never skipped.
 *
 * `head: true` returns no rows, just the current head cursor — used by the client the moment the
 * user opts in, so enabling never retroactively deletes files for photos purged in the past.
 */
export async function getDeletionsForUser(
  env: Env,
  email: string,
  cursor: string | null,
  limit: number,
  head: boolean
): Promise<DeletionsPage> {
  if (head) {
    const row = await env.DB
      .prepare(
        `SELECT purged_at AS purgedAt, id FROM photo_tombstones
         WHERE deleted_by = ? AND purged_at IS NOT NULL
         ORDER BY purged_at DESC, id DESC LIMIT 1`
      )
      .bind(email)
      .first<{ purgedAt: string; id: number }>();
    return { deletions: [], nextCursor: row ? `${row.purgedAt}|${row.id}` : null };
  }

  const { purgedAt, id } = parseCursor(cursor);
  const { results } = await env.DB
    .prepare(
      `SELECT photo_id AS photoId, purged_at AS purgedAt, id FROM photo_tombstones
       WHERE deleted_by = ? AND purged_at IS NOT NULL
         AND (purged_at > ? OR (purged_at = ? AND id > ?))
       ORDER BY purged_at ASC, id ASC LIMIT ?`
    )
    .bind(email, purgedAt, purgedAt, id, limit)
    .all<{ photoId: string; purgedAt: string; id: number }>();

  const rows = results || [];
  const last = rows[rows.length - 1];
  // Return a cursor whenever this page had ANY rows (not only when it was full): the feed doesn't
  // expose the internal `id`, so the client can't build the compound cursor itself and relies on
  // this to persist progress after every page. When rows is empty the client is caught up (null).
  return {
    deletions: rows.map((r) => ({ photoId: r.photoId, purgedAt: r.purgedAt })),
    nextCursor: last ? `${last.purgedAt}|${last.id}` : null,
  };
}
