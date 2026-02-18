-- Migration 010: Collaboration History Log
-- Track all collaboration actions (invites, uploads, removals) using emails

CREATE TABLE IF NOT EXISTS collaboration_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  user_email TEXT NOT NULL, -- User who performed the action (email)
  action_type TEXT NOT NULL, -- 'invite', 'accept', 'decline', 'remove', 'upload'
  target_user_email TEXT, -- For invite/remove actions, the email being invited/removed
  metadata TEXT, -- JSON with additional details (photo_count, etc.)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_email) REFERENCES users(email),
  FOREIGN KEY (target_user_email) REFERENCES users(email)
);

-- Create index for efficient history queries
CREATE INDEX IF NOT EXISTS idx_collaboration_history_event ON collaboration_history(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collaboration_history_user ON collaboration_history(user_email);
