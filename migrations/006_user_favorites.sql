-- Migration 006: User Favorites with Cloudflare Access
-- Adds support for user-based favorites (replacing localStorage)

-- Create users table to store Cloudflare Access user info
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, -- Cloudflare Access user ID (sub from JWT)
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create user_favorites table (many-to-many between users and photos)
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  event_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, photo_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Create indexes for efficient queries
CREATE INDEX idx_user_favorites_user ON user_favorites(user_id, created_at DESC);
CREATE INDEX idx_user_favorites_photo ON user_favorites(photo_id);
CREATE INDEX idx_users_email ON users(email);

-- Note: favorites_count column in photos table will now track user_favorites count
-- The existing column will be updated via triggers or application logic
