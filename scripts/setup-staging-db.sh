#!/usr/bin/env bash
set -euo pipefail

cd /Users/pnl0nr50/Documents/github/thijsvtol/photos

DB_NAME="photos-db-staging-v2"
ENV_NAME="staging"
R2_BUCKET="photos-storage-staging"

PRIVATE_SLUG="starten"
COLLAB_SLUG="thijs-x-dennis"
PRIVATE_PHOTO_ID="01STAGEPRIVATE00000000000001"
COLLAB_PHOTO_ID="01STAGECOLLAB00000000000001"

ADMIN_EMAIL="vantol.thijs@gmail.com"
COLLAB_EMAIL="collaborator@staging.test"

run_sql() {
  local sql="$1"
  echo "y" | wrangler d1 execute "$DB_NAME" --env "$ENV_NAME" --remote --command "$sql" >/dev/null
}

echo "[staging-setup] Ensuring required tables exist..."
run_sql "
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  last_login TEXT DEFAULT (datetime('now'))
);
"

run_sql "
CREATE TABLE IF NOT EXISTS event_collaborators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  user_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE,
  UNIQUE(event_id, user_email)
);
"

run_sql "CREATE INDEX IF NOT EXISTS idx_event_collaborators_event ON event_collaborators(event_id);"
run_sql "CREATE INDEX IF NOT EXISTS idx_event_collaborators_user ON event_collaborators(user_email);"

echo "[staging-setup] Upserting test users..."
run_sql "INSERT OR IGNORE INTO users (email, name) VALUES ('$ADMIN_EMAIL', 'Thijs van Tol');"
run_sql "INSERT OR IGNORE INTO users (email, name) VALUES ('$COLLAB_EMAIL', 'Staging Collaborator');"

echo "[staging-setup] Upserting test events..."
run_sql "
INSERT INTO events (slug, name, password_salt, password_hash, inferred_date, visibility)
VALUES ('$PRIVATE_SLUG', 'Starten Private Event', '', '', '2026-03-30', 'private')
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  password_salt = excluded.password_salt,
  password_hash = excluded.password_hash,
  inferred_date = excluded.inferred_date,
  visibility = excluded.visibility;
"

run_sql "
INSERT INTO events (slug, name, password_salt, password_hash, inferred_date, visibility)
VALUES ('$COLLAB_SLUG', 'Thijs x Dennis Collaboration', '', '', '2026-03-28', 'collaborators_only')
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  password_salt = excluded.password_salt,
  password_hash = excluded.password_hash,
  inferred_date = excluded.inferred_date,
  visibility = excluded.visibility;
"

echo "[staging-setup] Upserting test photos..."
run_sql "
INSERT INTO photos (id, event_id, original_filename, capture_time, width, height, file_type)
SELECT '$PRIVATE_PHOTO_ID', e.id, 'private-photo.jpg', '2026-03-30T10:00:00Z', 1920, 1080, 'image/jpeg'
FROM events e
WHERE e.slug = '$PRIVATE_SLUG'
ON CONFLICT(id) DO UPDATE SET
  event_id = excluded.event_id,
  original_filename = excluded.original_filename,
  capture_time = excluded.capture_time,
  width = excluded.width,
  height = excluded.height,
  file_type = excluded.file_type;
"

run_sql "
INSERT INTO photos (id, event_id, original_filename, capture_time, width, height, file_type)
SELECT '$COLLAB_PHOTO_ID', e.id, 'collab-photo.jpg', '2026-03-28T14:30:00Z', 1920, 1080, 'image/jpeg'
FROM events e
WHERE e.slug = '$COLLAB_SLUG'
ON CONFLICT(id) DO UPDATE SET
  event_id = excluded.event_id,
  original_filename = excluded.original_filename,
  capture_time = excluded.capture_time,
  width = excluded.width,
  height = excluded.height,
  file_type = excluded.file_type;
"

echo "[staging-setup] Upserting collaborator membership..."
run_sql "
INSERT INTO event_collaborators (event_id, user_email, role)
SELECT e.id, '$COLLAB_EMAIL', 'viewer'
FROM events e
WHERE e.slug = '$COLLAB_SLUG'
ON CONFLICT(event_id, user_email) DO UPDATE SET role = excluded.role;
"

tmp_file="$(mktemp /tmp/staging-photo-XXXXXX.jpg)"
printf 'staging-photo-bytes' > "$tmp_file"

echo "[staging-setup] Uploading deterministic R2 test objects..."
wrangler r2 object put "$R2_BUCKET/preview/$PRIVATE_SLUG/$PRIVATE_PHOTO_ID.jpg" --file "$tmp_file" --remote >/dev/null
wrangler r2 object put "$R2_BUCKET/original/$PRIVATE_SLUG/$PRIVATE_PHOTO_ID.jpg" --file "$tmp_file" --remote >/dev/null
wrangler r2 object put "$R2_BUCKET/preview/$COLLAB_SLUG/$COLLAB_PHOTO_ID.jpg" --file "$tmp_file" --remote >/dev/null
wrangler r2 object put "$R2_BUCKET/original/$COLLAB_SLUG/$COLLAB_PHOTO_ID.jpg" --file "$tmp_file" --remote >/dev/null

rm -f "$tmp_file"

echo "[staging-setup] Done. Staging DB + R2 seed completed successfully."
