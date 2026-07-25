-- Track whether a photo's preview (small watermarked JPEG) has finished
-- uploading to R2. The preview is uploaded client-side as a progressive
-- enhancement *after* the original upload completes (see uploadManager.ts);
-- if it fails permanently (e.g. retries exhausted), the photo would
-- otherwise stay visible showing only the heavy full-size original via the
-- fallback in media.ts. Instead, hide such photos from galleries/timeline
-- until a preview actually exists in R2, matching how upload_complete
-- already hides in-progress originals.
--
-- Videos never get a separate preview file (media.ts always falls back to
-- the original .mp4 for them), so they are always treated as complete.
--
-- DEFAULT 1 so all pre-existing photos are treated as complete (visible) --
-- this preserves prior behavior for rows created before this column
-- existed. New image rows created at upload start explicitly set this to 0
-- and it is flipped to 1 when the preview multipart upload completes.
ALTER TABLE photos ADD COLUMN preview_complete INTEGER NOT NULL DEFAULT 1;

-- Efficiently skip photos with a pending/failed preview when listing an
-- event's photos.
CREATE INDEX IF NOT EXISTS idx_photos_event_preview_complete
  ON photos(event_id, preview_complete);
