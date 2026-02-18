-- D1 Schema for Photos Subdomain
-- Events table: stores event information with password hashing
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    inferred_date TEXT, -- YYYY-MM-DD format
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Photos table: stores photo metadata
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY, -- ULID or UUID string
    event_id INTEGER NOT NULL,
    original_filename TEXT NOT NULL,
    capture_time TEXT NOT NULL, -- ISO 8601 format
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    width INTEGER,
    height INTEGER,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Index for efficient querying by event and time
CREATE INDEX IF NOT EXISTS idx_photos_event_time ON photos(event_id, capture_time);

-- Index for slug lookups
CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
