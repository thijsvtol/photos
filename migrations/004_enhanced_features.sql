-- Migration 004: Enhanced Features
-- Adds support for: GPS coordinates, favorites, blur placeholders, featured photos, and tags

-- Add GPS coordinates to photos table
ALTER TABLE photos ADD COLUMN latitude REAL;
ALTER TABLE photos ADD COLUMN longitude REAL;

-- Add favorites count
ALTER TABLE photos ADD COLUMN favorites_count INTEGER DEFAULT 0 NOT NULL;

-- Add blur placeholder (base64 encoded tiny image)
ALTER TABLE photos ADD COLUMN blur_placeholder TEXT;

-- Add featured flag to photos
ALTER TABLE photos ADD COLUMN is_featured INTEGER DEFAULT 0 NOT NULL;

-- Create tags table
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create event_tags junction table (many-to-many)
CREATE TABLE IF NOT EXISTS event_tags (
  event_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (event_id, tag_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Insert default tags
INSERT INTO tags (name, slug) VALUES 
  ('Schaatsen', 'schaatsen'),
  ('Skeeleren', 'skeeleren'),
  ('Fietsen', 'fietsen'),
  ('Vrije tijd', 'vrije-tijd'),
  ('Natuur', 'natuur');

-- Create index for favorites sorting
CREATE INDEX idx_photos_favorites ON photos(favorites_count DESC);

-- Create index for featured photos
CREATE INDEX idx_photos_featured ON photos(is_featured, event_id);

-- Create index for GPS coordinates
CREATE INDEX idx_photos_gps ON photos(latitude, longitude) WHERE latitude IS NOT NULL;
