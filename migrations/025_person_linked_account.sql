-- Lets an admin link a face/person cluster (see 023_photos_organization_and_ai.sql's
-- person_clusters table) to an existing user account (users.email), powering a
-- "Photos of me" tab for that account holder (see routes/me.ts).
--
-- NULL = not linked to any account (the vast majority of clusters — most people in photos
-- never log into the app themselves, e.g. kids, guests who never made an account, etc).
--
-- A user account can be linked to at most one person cluster at a time — enforced with a
-- partial UNIQUE index (SQLite allows a WHERE clause on a UNIQUE index; NULLs are always
-- considered distinct from each other in SQLite regardless, but the WHERE clause additionally
-- keeps the index small since almost every row stays NULL).
ALTER TABLE person_clusters ADD COLUMN linked_user_email TEXT REFERENCES users(email) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_person_clusters_linked_user_email
  ON person_clusters(linked_user_email) WHERE linked_user_email IS NOT NULL;
