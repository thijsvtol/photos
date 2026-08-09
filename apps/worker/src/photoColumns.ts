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
 * duplicate grouping (see EventGallery.tsx).
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
const BASE_PHOTO_COLUMNS = [
  'p.id', 'p.event_id', 'p.original_filename', 'p.file_type', 'p.capture_time',
  'p.uploaded_at', 'p.uploaded_by', 'p.width', 'p.height',
  'p.iso', 'p.aperture', 'p.shutter_speed', 'p.focal_length',
  'p.camera_make', 'p.camera_model', 'p.lens_model',
  'p.latitude', 'p.longitude', 'p.city',
  'p.favorites_count', 'p.is_featured', 'p.cache_version',
  'p.file_hash', 'p.phash', 'p.archived_at',
];

/**
 * For the full-event gallery listing: everything above, WITHOUT
 * `blur_placeholder`.
 *
 * That one column was 81% of the response — 5.31MB of an 8.08MB body for a
 * 4102-photo event, averaging 1470 bytes per row. It is a 16x16 JPEG, so the
 * size is not the dimensions: a baseline JPEG's fixed header/quantization/Huffman
 * tables cost ~700 bytes no matter how few pixels follow, and base64 adds a
 * further third.
 *
 * The wire cost was never the problem — Cloudflare compresses the body to ~630KB.
 * The cost is what the WebView does next: decompress and JSON.parse 8MB, then
 * hold 4102 objects each carrying a ~1.5KB string. That is what made opening a
 * big event slow.
 *
 * The trade is real and deliberate: gallery tiles no longer blur up from a
 * placeholder, they fade in from an empty background. Photo detail still gets one
 * (different endpoint, one row), and so do the small featured/most-favorited
 * lists below, where a handful of rows costs nothing.
 */
export const GALLERY_PHOTO_COLUMNS = BASE_PHOTO_COLUMNS.join(', ');

/** For SHORT lists (featured, most-favorited — LIMIT ~20), where the blur-up is
 *  worth its bytes because there are so few rows. */
export const PHOTO_COLUMNS_WITH_BLUR = [...BASE_PHOTO_COLUMNS, 'p.blur_placeholder'].join(', ');
