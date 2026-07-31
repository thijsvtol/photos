-- Content hash of each photo's ORIGINAL file, used to detect duplicate
-- uploads within the same event (e.g. a user accidentally selecting the same
-- photo twice, or syncing the same folder twice). Computed client-side via
-- the browser's built-in SubtleCrypto (SHA-256) before upload — the worker
-- just stores whatever the client sends, it never has to read/hash the file
-- itself. NULL for photos uploaded before this column existed; those are
-- simply excluded from duplicate detection (no retroactive backfill).
ALTER TABLE photos ADD COLUMN file_hash TEXT;

-- Speeds up the "does this event already have a photo with this hash"
-- lookup used for both duplicate-detection (grouping by hash client-side)
-- and any future server-side duplicate checks.
CREATE INDEX IF NOT EXISTS idx_photos_event_file_hash
  ON photos(event_id, file_hash);
