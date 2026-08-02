-- Tracks whether a photo has been checked for faces (client-side face-api.js detection —
-- see apps/web/src/faceDetection.ts + faceDetectionQueue.ts/faceBackfill.ts).
--
-- Distinct from simply checking `photo_faces` for rows with this photo_id: a photo can be
-- legitimately checked and have ZERO faces found (no people in the shot), and without this
-- marker such photos would be rescanned forever by the backfill job, which enumerates photos
-- not yet checked.
--
-- Set automatically by:
--  - POST /admin/events/:slug/uploads/:photoId/faces (new-upload path, any collaborator with
--    upload permission for that event)
--  - POST /admin/photos/:photoId/faces (backfill path, admin-only, used to gradually process
--    photos uploaded before the People feature existed)
--
-- NULL = not yet checked (this is what the backfill query filters on).
ALTER TABLE photos ADD COLUMN faces_processed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_photos_faces_processed_at ON photos(faces_processed_at);
