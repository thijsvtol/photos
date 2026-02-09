-- Migration 008: Event Collaborators
-- Adds support for collaborative photo uploads where admins can invite users to contribute photos to events

-- Create event_collaborators table (many-to-many between events and users)
CREATE TABLE IF NOT EXISTS event_collaborators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  invited_by TEXT NOT NULL, -- Admin user ID who sent the invite
  invited_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'declined'
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id),
  UNIQUE(event_id, user_id)
);

-- Create indexes for efficient queries
CREATE INDEX idx_event_collaborators_event ON event_collaborators(event_id);
CREATE INDEX idx_event_collaborators_user ON event_collaborators(user_id);
CREATE INDEX idx_event_collaborators_status ON event_collaborators(event_id, status);
