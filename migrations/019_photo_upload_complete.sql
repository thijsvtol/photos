-- Track whether a photo's media has finished uploading to R2.
-- The photo row is created when a multipart upload STARTS (see
-- apps/worker/src/routes/admin/uploads.ts), before the bytes exist in R2, so
-- galleries/detail must hide rows until the original upload completes to avoid
-- showing broken/blank images.
--
-- DEFAULT 1 so all pre-existing photos are treated as complete (visible).
-- New rows created at upload start explicitly set this to 0 and it is flipped
-- to 1 when the original multipart upload completes.
ALTER TABLE photos ADD COLUMN upload_complete INTEGER NOT NULL DEFAULT 1;

-- Efficiently skip in-progress uploads when listing an event's photos.
CREATE INDEX IF NOT EXISTS idx_photos_event_upload_complete
  ON photos(event_id, upload_complete);
