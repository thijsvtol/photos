-- Migration 015: Collaborator role granularity
-- Adds role-based permissions for event collaborators and invite links.

-- Existing collaborators become editors to preserve current management behavior.
ALTER TABLE event_collaborators
  ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'
  CHECK (role IN ('viewer', 'uploader', 'editor', 'admin'));

-- Invite links can grant a specific role to accepted users.
ALTER TABLE invite_links
  ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'
  CHECK (role IN ('viewer', 'uploader', 'editor', 'admin'));

CREATE INDEX IF NOT EXISTS idx_event_collaborators_event_role
  ON event_collaborators(event_id, role);
