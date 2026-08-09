/**
 * The photo columns a gallery/list response actually needs — mirrors the client's
 * `Photo` interface in apps/web/src/types.ts.
 *
 * This exists because the listing routes used `SELECT p.*`, which shipped every
 * column of every row. The photos table carries an `embedding` BLOB (a
 * Float32Array for AI search) plus `ai_caption`, `ai_tags` and `ai_processed_at` —
 * none of which the client declares or reads; `ai_caption` only exists on
 * `SearchResultPhoto`, which is built by the search route, not these. On an event
 * with a few thousand photos that turned one listing into a huge JSON payload for
 * the WebView to download, parse and hold in memory, which is what made big
 * galleries slow to open.
 *
 * Kept despite looking internal: `file_hash` and `phash` drive the gallery's
 * duplicate grouping (see EventGallery.tsx), and `blur_placeholder` is the
 * blur-up placeholder — a 16x16 JPEG data URI, small by design.
 *
 * Deliberately absent, on top of the AI columns: `upload_complete`,
 * `preview_complete`, `faces_processed_at`, `notified_at`,
 * `video_transcode_status`, `source_photo_id` and `source_event_slug`. All are
 * server-side bookkeeping the client never reads — several are used in the WHERE
 * clauses of these same queries, which needs no SELECT.
 *
 * Add a column here when the client starts needing one. Do NOT reach back for
 * `p.*`.
 */
export const GALLERY_PHOTO_COLUMNS = [
  'p.id', 'p.event_id', 'p.original_filename', 'p.file_type', 'p.capture_time',
  'p.uploaded_at', 'p.uploaded_by', 'p.width', 'p.height',
  'p.iso', 'p.aperture', 'p.shutter_speed', 'p.focal_length',
  'p.camera_make', 'p.camera_model', 'p.lens_model',
  'p.latitude', 'p.longitude', 'p.city',
  'p.favorites_count', 'p.blur_placeholder', 'p.is_featured', 'p.cache_version',
  'p.file_hash', 'p.phash', 'p.archived_at',
].join(', ');
