-- Migration 009: Add uploaded_by column to photos table
-- Track who uploaded each photo (admin or collaborator) by email

-- Add uploaded_by column to photos table (stores user email)
ALTER TABLE photos ADD COLUMN uploaded_by TEXT;

-- Add index for uploaded_by
CREATE INDEX IF NOT EXISTS idx_photos_uploaded_by ON photos(uploaded_by);

-- Note: uploaded_by references users.email (not enforced as FK in SQLite ALTER TABLE)
-- For existing photos without uploaded_by, remains NULL
-- New uploads will require uploaded_by to be set
