-- Migration 005: Add city column to photos table
-- This allows filtering photos by location (city name)

ALTER TABLE photos ADD COLUMN city TEXT;

-- Create index for city filtering
CREATE INDEX IF NOT EXISTS idx_photos_city ON photos(city) WHERE city IS NOT NULL;
