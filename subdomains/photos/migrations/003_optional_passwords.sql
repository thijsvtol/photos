-- Make password fields optional (nullable) for events
-- This allows creating events without password protection

-- SQLite doesn't support ALTER COLUMN, so we need to recreate the table
-- Save existing data
CREATE TABLE events_backup AS SELECT * FROM events;

-- Drop old table
DROP TABLE events;

-- Recreate table with nullable password fields
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_salt TEXT,
    password_hash TEXT,
    inferred_date TEXT, -- YYYY-MM-DD format
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Restore data
INSERT INTO events SELECT * FROM events_backup;

-- Drop backup
DROP TABLE events_backup;

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
