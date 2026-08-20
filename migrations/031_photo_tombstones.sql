-- Durable deletion tombstones, powering the Android folder-sync "delete the local file when I
-- permanently delete the photo online" feature (opt-in; see docs/local-delete-sync-design.md).
--
-- WHY A SEPARATE TABLE WITH NO FOREIGN KEY TO photos:
-- The whole point is that a device must still be able to learn a photo was deleted AFTER the
-- photos row is physically gone. Server delete is a soft delete (photos.deleted_at); the row —
-- and its R2 files — are only hard-removed by permanentlyDeletePhotos() once past the 30-day
-- trash window. A tombstone therefore has to OUTLIVE the photos row, so it deliberately has no
-- FK/ON DELETE CASCADE (a cascade would erase exactly the record we need at purge time).
--
-- LIFECYCLE:
--   soft-delete  -> upsert a row (purged_at = NULL), recording who deleted it (deleted_by) and
--                   the original uploader (uploaded_by)
--   restore      -> the row is DELETED, so a restored photo can never become "eligible"
--   hard purge   -> purged_at is stamped; ONLY purged rows are ever exposed by the deletions feed
--                   (GET /api/me/deletions), which is what makes local deletion purge-gated and
--                   free of any soft-delete/restore race.
-- The feed filters by deleted_by = caller ("only my own deletes"); uploaded_by is kept for a
-- possible future "any delete of my uploads" mode.
CREATE TABLE IF NOT EXISTS photo_tombstones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id TEXT NOT NULL UNIQUE,
  uploaded_by TEXT,
  deleted_by TEXT,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
  purged_at TEXT
);

-- Serves the deletions feed's exact filter/order: WHERE deleted_by = ? AND purged_at IS NOT NULL
-- ORDER BY purged_at, id (compound cursor).
CREATE INDEX IF NOT EXISTS idx_tombstones_feed ON photo_tombstones(deleted_by, purged_at, id);
