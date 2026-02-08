-- Add file_type column to support videos
ALTER TABLE photos ADD COLUMN file_type TEXT NOT NULL DEFAULT 'image/jpeg';

-- Add index for file type queries
CREATE INDEX IF NOT EXISTS idx_photos_file_type ON photos(file_type);

