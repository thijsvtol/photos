#!/bin/bash
set -euo pipefail

# Nightly video-compatibility job.
#
# Google Cast (Chromecast) devices frequently lack HEVC/H.265 hardware
# decode support — videos recorded in HEVC ("High Efficiency") by phone
# cameras fail to cast with DEMUXER_ERROR_NO_SUPPORTED_STREAMS, while H.264
# videos work fine. This script finds videos that haven't been checked yet,
# and transcodes any HEVC/incompatible ones to H.264 IN PLACE in R2.
#
# Deliberately runs here (a GitHub Actions runner, via real native
# ffmpeg/ffprobe) rather than:
#  - client-side at upload time: a full WASM re-encode is slow/heavy and
#    risks upload reliability, which must stay rock solid.
#  - inside the Cloudflare Worker: Workers can't spawn native processes and
#    aren't suited to CPU-heavy transcoding.
#
# Requires on PATH: wrangler (authenticated via CLOUDFLARE_API_TOKEN +
# CLOUDFLARE_ACCOUNT_ID env vars), ffmpeg, ffprobe, jq.
#
# Usage: ./scripts/transcode-videos.sh [batch-size]

BATCH_SIZE="${1:-15}"
DB_NAME="photos-db"
R2_BUCKET="photos-storage"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "Fetching up to $BATCH_SIZE video(s) pending compatibility check..."

QUERY="SELECT p.id AS id, e.slug AS event_slug, p.source_event_slug AS source_event_slug, p.source_photo_id AS source_photo_id FROM photos p JOIN events e ON p.event_id = e.id WHERE p.file_type = 'video/mp4' AND p.video_transcode_status IS NULL LIMIT $BATCH_SIZE"

RESULT_JSON=$(wrangler d1 execute "$DB_NAME" --remote --json --command "$QUERY")
COUNT=$(echo "$RESULT_JSON" | jq '.[0].results | length')

if [ "$COUNT" -eq 0 ]; then
  echo "No videos pending a compatibility check."
  exit 0
fi

echo "Found $COUNT video(s) to check."

mark_status() {
  local id="$1"
  local status="$2"
  local bump_cache="$3" # "true" or "false"
  if [ "$bump_cache" = "true" ]; then
    wrangler d1 execute "$DB_NAME" --remote --command \
      "UPDATE photos SET video_transcode_status = '$status', cache_version = cache_version + 1 WHERE id = '$id'" >/dev/null
  else
    wrangler d1 execute "$DB_NAME" --remote --command \
      "UPDATE photos SET video_transcode_status = '$status' WHERE id = '$id'" >/dev/null
  fi
}

echo "$RESULT_JSON" | jq -c '.[0].results[]' | while IFS= read -r row; do
  ID=$(echo "$row" | jq -r '.id')
  EVENT_SLUG=$(echo "$row" | jq -r '.event_slug')
  SOURCE_EVENT_SLUG=$(echo "$row" | jq -r '.source_event_slug // empty')
  SOURCE_PHOTO_ID=$(echo "$row" | jq -r '.source_photo_id // empty')

  R2_SLUG="${SOURCE_EVENT_SLUG:-$EVENT_SLUG}"
  R2_PHOTO_ID="${SOURCE_PHOTO_ID:-$ID}"
  R2_KEY="original/$R2_SLUG/$R2_PHOTO_ID.mp4"

  echo "--- Photo $ID ($R2_KEY) ---"

  INPUT_FILE="$WORKDIR/$ID-input.mp4"
  OUTPUT_FILE="$WORKDIR/$ID-output.mp4"

  if ! wrangler r2 object get "$R2_BUCKET/$R2_KEY" --file "$INPUT_FILE" --remote >/dev/null 2>&1; then
    echo "  Could not download from R2 — marking failed."
    mark_status "$ID" "failed" "false"
    continue
  fi

  CODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$INPUT_FILE" 2>/dev/null || echo "")

  if [ -z "$CODEC" ]; then
    echo "  Could not determine video codec — marking failed."
    mark_status "$ID" "failed" "false"
    rm -f "$INPUT_FILE"
    continue
  fi

  if [ "$CODEC" = "h264" ]; then
    echo "  Codec is h264 — already compatible, no action needed."
    mark_status "$ID" "compatible" "false"
    rm -f "$INPUT_FILE"
    continue
  fi

  echo "  Codec is $CODEC — transcoding to H.264..."
  if ffmpeg -nostdin -y -loglevel error -i "$INPUT_FILE" \
      -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
      -c:a aac -b:a 160k \
      -movflags +faststart \
      "$OUTPUT_FILE"; then
    echo "  Transcode succeeded — uploading replacement..."
    if wrangler r2 object put "$R2_BUCKET/$R2_KEY" --file "$OUTPUT_FILE" --content-type "video/mp4" --remote >/dev/null; then
      mark_status "$ID" "transcoded" "true"
      echo "  Done — R2 file replaced, cache_version bumped."
    else
      echo "  Upload to R2 failed — marking failed."
      mark_status "$ID" "failed" "false"
    fi
  else
    echo "  ffmpeg transcode failed — marking failed."
    mark_status "$ID" "failed" "false"
  fi

  rm -f "$INPUT_FILE" "$OUTPUT_FILE"
done

echo "Batch complete."
