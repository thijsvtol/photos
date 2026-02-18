-- Add description and archived columns to events
ALTER TABLE events ADD COLUMN description TEXT;
ALTER TABLE events ADD COLUMN is_archived BOOLEAN DEFAULT 0;
