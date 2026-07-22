-- Track which photos have already triggered an upload notification.
-- Used by the hourly scheduled job that batches "new photos" emails to
-- event collaborators. NULL means the photo has not been notified yet.
ALTER TABLE photos ADD COLUMN notified_at TEXT;

-- Efficiently find un-notified collaborator uploads.
CREATE INDEX IF NOT EXISTS idx_photos_notified_at
  ON photos(notified_at);
