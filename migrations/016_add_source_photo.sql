-- Migration 016: Add source photo tracking for copied photos
-- When a photo is copied to another event, only a DB record is created
-- (no R2 duplication). These columns point to where the actual files live.

ALTER TABLE photos ADD COLUMN source_photo_id TEXT;
ALTER TABLE photos ADD COLUMN source_event_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_photos_source_photo_id
  ON photos(source_photo_id)
  WHERE source_photo_id IS NOT NULL;
