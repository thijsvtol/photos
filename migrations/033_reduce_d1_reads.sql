-- Cover the actual filters and ordering used by discovery and maintenance.
-- Keep existing indexes: older deployments and other routes still use them.
CREATE INDEX IF NOT EXISTS idx_photos_active_event_preview
  ON photos(event_id, is_featured DESC, capture_time ASC, id, file_type, cache_version)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_photos_event_uploaded_at
  ON photos(event_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_active_event_city
  ON photos(event_id, city) WHERE deleted_at IS NULL AND city IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_photos_ai_queue
  ON photos(uploaded_at, id)
  WHERE ai_processed_at IS NULL AND upload_complete = 1 AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_photos_stale_uploads
  ON photos(uploaded_at) WHERE upload_complete = 0;
CREATE INDEX IF NOT EXISTS idx_photos_notification_queue
  ON photos(event_id, id, uploaded_by)
  WHERE notified_at IS NULL AND uploaded_by IS NOT NULL AND upload_complete = 1;
CREATE INDEX IF NOT EXISTS idx_photos_active_capture
  ON photos(capture_time DESC, id, event_id) WHERE deleted_at IS NULL AND upload_complete = 1;
CREATE INDEX IF NOT EXISTS idx_photo_faces_person_photo
  ON photo_faces(person_id, photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_faces_photo_person
  ON photo_faces(photo_id, person_id);
CREATE INDEX IF NOT EXISTS idx_photo_person_tags_person_photo
  ON photo_person_tags(person_id, photo_id);

-- D1's supported statistics maintenance helps the planner avoid
-- low-selectivity deleted_at indexes. Never run this per request.
PRAGMA optimize;
