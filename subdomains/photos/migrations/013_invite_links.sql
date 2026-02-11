-- Create invite_links table for shareable collaboration invites
CREATE TABLE IF NOT EXISTS invite_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  event_id INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(email) ON DELETE CASCADE
);

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_invite_links_token ON invite_links(token);

-- Index for listing links by event
CREATE INDEX IF NOT EXISTS idx_invite_links_event ON invite_links(event_id);
