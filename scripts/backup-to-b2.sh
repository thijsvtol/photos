#!/usr/bin/env bash
#
# Off-site backup to Backblaze B2.
#
# WHY THIS EXISTS
# The primary copy of everything lives in Cloudflare: photos/videos in the R2
# bucket (PHOTOS_BUCKET) and all metadata (people, face clusters, poster status,
# etc.) in the D1 database. That is one provider and one account. This script is
# the second leg of a 3-2-1 backup: an independent copy at a different provider,
# so we survive an account lockout, a billing dispute, or a bug in our own code
# that mass-deletes objects — none of which a second Cloudflare bucket protects
# against.
#
# WHAT IT DOES (two independent halves; either can fail without the other)
#   1. Blobs: rclone sync R2 -> B2/<prefix>/blobs, with changed/deleted files
#      moved to B2/<prefix>/_archive/<date>/ instead of being hard-deleted. So a
#      bad delete in R2 never destroys the only backup of a file. (blobs/,
#      _archive/ and db-backups/ are siblings so the mirror never re-syncs its
#      own archive or dumps.)
#   2. Database: `wrangler d1 export` produces a full logical SQL dump (schema +
#      data). We gzip it and upload it as a dated blob under B2/<prefix>/db-backups/.
#      Restoring the R2 blobs without this metadata would give you anonymous
#      files, so the dump is the more important half.
#
# _archive/ is pruned to ARCHIVE_RETENTION_DAYS (short — it is the main cost
# driver), db-backups/ to DB_RETENTION_DAYS (long — the dumps are tiny).
#
# RUN IT
#   Locally or in CI. All configuration comes from environment variables (below),
#   so no secrets are ever written to disk. In CI see .github/workflows/backup-b2.yml.
#
# RESTORE
#   Blobs:  rclone copy B2:<bucket>/<prefix>/blobs R2:<bucket>
#   DB:     gunzip photos-db-YYYY-MM-DD.sql.gz
#           wrangler d1 execute photos-db --remote --file=photos-db-YYYY-MM-DD.sql
#   (Restore into a fresh/empty database and verify before repointing production.)

set -euo pipefail

# --- Configuration (environment) --------------------------------------------
# Cloudflare (already used by other workflows in this repo):
#   CLOUDFLARE_ACCOUNT_ID   Cloudflare account id (also forms the R2 S3 endpoint)
#   CLOUDFLARE_API_TOKEN    token with D1 read access (used by `wrangler d1 export`)
#
# R2 S3 API credentials (create in Cloudflare dashboard: R2 -> Manage API Tokens,
# an "Object Read" token is enough for a backup source):
#   R2_ACCESS_KEY_ID
#   R2_SECRET_ACCESS_KEY
#
# Backblaze B2 credentials (create an Application Key scoped to the backup bucket):
#   B2_KEY_ID
#   B2_APPLICATION_KEY
#
# Buckets / layout (optional overrides shown with their defaults):
R2_BUCKET="${R2_BUCKET:-photos-storage}"
B2_BUCKET="${B2_BUCKET:?Set B2_BUCKET to your Backblaze bucket name}"
B2_PREFIX="${B2_PREFIX:-photos}"           # top-level folder inside the B2 bucket
D1_DATABASE="${D1_DATABASE:-photos-db}"    # D1 database name to export
# Retention is split: archived blob versions are the main cost driver (the
# nightly transcode rewrites videos in place, leaving an old copy in _archive),
# so keep them short. DB dumps are tiny (gzipped SQL) and precious, so keep them
# long. RETENTION_DAYS, if set, is the fallback default for both.
RETENTION_DAYS="${RETENTION_DAYS:-90}"
ARCHIVE_RETENTION_DAYS="${ARCHIVE_RETENTION_DAYS:-30}"   # deleted/overwritten blob versions
DB_RETENTION_DAYS="${DB_RETENTION_DAYS:-$RETENTION_DAYS}" # gzipped D1 dumps

# What to run: "all" (default), "blobs", or "db". Lets CI or a human run one half.
MODE="${1:-${BACKUP_MODE:-all}}"

# --- Preconditions ----------------------------------------------------------
require() {
  local missing=0 v
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then
      echo "::error::Missing required environment variable: $v" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 1
}

command -v rclone >/dev/null 2>&1 || { echo "::error::rclone is not installed (see https://rclone.org/install/)" >&2; exit 1; }

# A UTC datestamp for this run. Passed in by CI via BACKUP_STAMP so a re-run
# reuses the same folder; falls back to today's date locally.
STAMP="${BACKUP_STAMP:-$(date -u +%Y-%m-%d)}"

# --- rclone remotes from env (no config file, no secrets on disk) -----------
# `R2:` reads the source bucket over R2's S3-compatible API.
# `B2:` is the native Backblaze b2 backend (keeps prior versions server-side as
# a second safety net; b2_hard_delete=false means our syncs never truly erase).
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ENV_AUTH=false
export RCLONE_CONFIG_B2_TYPE=b2
export RCLONE_CONFIG_B2_HARD_DELETE=false

backup_blobs() {
  require CLOUDFLARE_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY B2_KEY_ID B2_APPLICATION_KEY
  export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
  export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
  export RCLONE_CONFIG_R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
  export RCLONE_CONFIG_B2_ACCOUNT="$B2_KEY_ID"
  export RCLONE_CONFIG_B2_KEY="$B2_APPLICATION_KEY"

  local dest="B2:${B2_BUCKET}/${B2_PREFIX}/blobs"
  local archive="B2:${B2_BUCKET}/${B2_PREFIX}/_archive/${STAMP}"

  echo ">> Mirroring R2:${R2_BUCKET} -> ${dest}"
  echo "   (changed/removed files are archived under ${archive}, never hard-deleted)"
  rclone sync "R2:${R2_BUCKET}" "$dest" \
    --backup-dir "$archive" \
    --fast-list \
    --transfers 16 \
    --checkers 32 \
    --b2-hard-delete=false \
    --stats 30s \
    --stats-one-line

  echo ">> Pruning archived versions older than ${ARCHIVE_RETENTION_DAYS} days"
  rclone delete "B2:${B2_BUCKET}/${B2_PREFIX}/_archive" --min-age "${ARCHIVE_RETENTION_DAYS}d" --rmdirs || true
}

backup_db() {
  require CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN B2_KEY_ID B2_APPLICATION_KEY
  command -v wrangler >/dev/null 2>&1 || command -v npx >/dev/null 2>&1 || {
    echo "::error::Need wrangler (npm i -g wrangler) or npx to export D1" >&2; exit 1; }
  export RCLONE_CONFIG_B2_ACCOUNT="$B2_KEY_ID"
  export RCLONE_CONFIG_B2_KEY="$B2_APPLICATION_KEY"

  local wr="wrangler"
  command -v wrangler >/dev/null 2>&1 || wr="npx --yes wrangler"

  local workdir dump gz
  workdir="$(mktemp -d)"
  trap 'rm -rf "$workdir"' RETURN
  dump="${workdir}/${D1_DATABASE}-${STAMP}.sql"
  gz="${dump}.gz"

  echo ">> Exporting D1 database '${D1_DATABASE}' (remote)"
  $wr d1 export "$D1_DATABASE" --remote --output "$dump"

  # Guard against a silently-empty export becoming a "successful" backup.
  if [ ! -s "$dump" ]; then
    echo "::error::D1 export produced an empty file — refusing to upload" >&2
    exit 1
  fi
  echo "   dump size: $(wc -c < "$dump") bytes"

  gzip -9 "$dump"

  local dest="B2:${B2_BUCKET}/${B2_PREFIX}/db-backups/"
  echo ">> Uploading $(basename "$gz") -> ${dest}"
  rclone copyto "$gz" "${dest}$(basename "$gz")"

  echo ">> Pruning DB dumps older than ${DB_RETENTION_DAYS} days"
  rclone delete "B2:${B2_BUCKET}/${B2_PREFIX}/db-backups" --min-age "${DB_RETENTION_DAYS}d" --rmdirs || true
}

case "$MODE" in
  all)   backup_blobs; backup_db ;;
  blobs) backup_blobs ;;
  db)    backup_db ;;
  *)     echo "::error::Unknown mode '$MODE' (use: all | blobs | db)" >&2; exit 1 ;;
esac

echo ">> Backup complete (${MODE}) for ${STAMP}"
