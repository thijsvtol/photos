-- Foundation schema for a batch of "Google Photos parity" features, all designed to run within
-- Cloudflare's free tiers (see docs/features.md roadmap + repo memory for the cost rationale):
--   - Trash (soft delete) + Archive: simple nullable timestamp columns on `photos`.
--   - Duplicate detection: client-computed perceptual hash (dHash), stored per-photo.
--   - AI enrichment (caption/tags/embedding): populated by a batch-limited Worker cron calling
--     Workers AI directly (free allocation: 10,000 neurons/day) — NOT a paid pipeline.
--   - People (face grouping): face descriptors are computed CLIENT-SIDE at upload time
--     (face-api.js, same pattern as existing client-side EXIF/blur-placeholder processing,
--     since Workers AI has no face-embedding model), then greedily clustered by a Worker cron.
--   - Albums: cross-event collections independent of the existing event structure.
--   - Activity feed: lightweight audit-style log, read via polling (no Durable Objects/paid plan).

-- ---------------------------------------------------------------------------
-- Trash / Archive
-- ---------------------------------------------------------------------------
-- NULL = active. Non-null = soft-deleted at that timestamp; a nightly cron hard-deletes
-- (R2 + row) once older than the retention window (see scheduled.ts runTrashPurge).
ALTER TABLE photos ADD COLUMN deleted_at TEXT;
-- NULL = visible in normal views. Non-null = archived (hidden from timeline/gallery grid by
-- default, but not deleted); still counts in storage/analytics.
ALTER TABLE photos ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_photos_deleted_at ON photos(deleted_at);
CREATE INDEX IF NOT EXISTS idx_photos_archived_at ON photos(archived_at);

-- ---------------------------------------------------------------------------
-- Duplicate detection
-- ---------------------------------------------------------------------------
-- 64-bit difference hash (dHash), computed client-side on a 9x8 greyscale downscale of the
-- image at upload time (cheap, no ML) and stored as a 16-char hex string. Near-duplicates are
-- found by grouping photos whose Hamming distance is below a small threshold.
ALTER TABLE photos ADD COLUMN phash TEXT;
CREATE INDEX IF NOT EXISTS idx_photos_phash ON photos(phash);

-- ---------------------------------------------------------------------------
-- AI enrichment (caption / object tags / semantic search embedding)
-- ---------------------------------------------------------------------------
-- ai_caption: short natural-language description from a Workers AI vision model, also used as
--   the OCR/"what's in this photo" text for full-text search.
-- ai_tags: JSON array of detected object labels (Workers AI object detection/classification).
-- embedding: Float32Array (384-dim, @cf/baai/bge-small-en-v1.5) serialized as a BLOB, computed
--   from ai_caption; used for brute-force cosine-similarity semantic search in the Worker.
-- ai_processed_at: NULL = not yet enriched (nightly/hourly cron query target). Set once done
--   (or once permanently skipped, e.g. video) so the batch job never reprocesses it.
ALTER TABLE photos ADD COLUMN ai_caption TEXT;
ALTER TABLE photos ADD COLUMN ai_tags TEXT;
ALTER TABLE photos ADD COLUMN embedding BLOB;
ALTER TABLE photos ADD COLUMN ai_processed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_photos_ai_processed_at ON photos(ai_processed_at);

-- Full-text search over filename + AI caption/tags + location, backing the unified search bar.
-- Uses an external-content table so we don't duplicate storage; kept in sync via triggers.
CREATE VIRTUAL TABLE IF NOT EXISTS photos_fts USING fts5(
  original_filename,
  ai_caption,
  ai_tags,
  city,
  content='photos',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS photos_fts_ai AFTER INSERT ON photos BEGIN
  INSERT INTO photos_fts(rowid, original_filename, ai_caption, ai_tags, city)
  VALUES (new.rowid, new.original_filename, new.ai_caption, new.ai_tags, new.city);
END;

CREATE TRIGGER IF NOT EXISTS photos_fts_ad AFTER DELETE ON photos BEGIN
  INSERT INTO photos_fts(photos_fts, rowid, original_filename, ai_caption, ai_tags, city)
  VALUES ('delete', old.rowid, old.original_filename, old.ai_caption, old.ai_tags, old.city);
END;

CREATE TRIGGER IF NOT EXISTS photos_fts_au AFTER UPDATE ON photos BEGIN
  INSERT INTO photos_fts(photos_fts, rowid, original_filename, ai_caption, ai_tags, city)
  VALUES ('delete', old.rowid, old.original_filename, old.ai_caption, old.ai_tags, old.city);
  INSERT INTO photos_fts(rowid, original_filename, ai_caption, ai_tags, city)
  VALUES (new.rowid, new.original_filename, new.ai_caption, new.ai_tags, new.city);
END;

-- Backfill existing rows into the FTS index (triggers only cover future writes).
INSERT INTO photos_fts(rowid, original_filename, ai_caption, ai_tags, city)
  SELECT rowid, original_filename, ai_caption, ai_tags, city FROM photos;

-- ---------------------------------------------------------------------------
-- People (face grouping)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, -- NULL until an admin/user names the person
  cover_photo_id TEXT,
  -- Running-average 128-dim face descriptor (face-api.js), Float32Array BLOB, used as the
  -- cluster centroid for greedy nearest-centroid assignment of new faces.
  centroid_embedding BLOB NOT NULL,
  face_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS photo_faces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id TEXT NOT NULL,
  -- 128-dim face-api.js descriptor, Float32Array BLOB.
  embedding BLOB NOT NULL,
  bbox_x REAL NOT NULL,
  bbox_y REAL NOT NULL,
  bbox_width REAL NOT NULL,
  bbox_height REAL NOT NULL,
  person_id INTEGER, -- NULL until clustered by the nightly clustering pass
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES person_clusters(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_photo_faces_photo_id ON photo_faces(photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_faces_person_id ON photo_faces(person_id);

-- ---------------------------------------------------------------------------
-- Albums (cross-event collections)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  cover_photo_id TEXT,
  created_by TEXT NOT NULL, -- email
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS album_photos (
  album_id INTEGER NOT NULL,
  photo_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (album_id, photo_id),
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_album_photos_photo_id ON album_photos(photo_id);

-- ---------------------------------------------------------------------------
-- Activity feed (polling-based, no Durable Objects)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL, -- e.g. 'photo_upload', 'photo_favorite', 'event_create', 'album_create'
  target_type TEXT, -- e.g. 'photo', 'event', 'album'
  target_id TEXT,
  metadata TEXT, -- JSON blob for action-specific extra context (e.g. photo count)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_activity_log_event_id ON activity_log(event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
