-- Add cache_version to photos to enable cache busting after edits
ALTER TABLE photos ADD COLUMN cache_version INTEGER NOT NULL DEFAULT 0;
