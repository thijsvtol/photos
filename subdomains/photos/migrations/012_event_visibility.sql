-- Migration 012: Event Visibility Control
-- Allow admins to control who can view each event

-- Add visibility column to events table
-- Options: 'public', 'private', 'collaborators_only'
ALTER TABLE events ADD COLUMN visibility TEXT DEFAULT 'public' CHECK(visibility IN ('public', 'private', 'collaborators_only'));

-- Update existing events to be public (default)
UPDATE events SET visibility = 'public' WHERE visibility IS NULL;

-- Create index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_events_visibility ON events(visibility);
