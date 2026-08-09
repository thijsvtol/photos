#!/bin/bash
set -euo pipefail

# Nightly video-playability job.
#
# Builds a playable 1080p H.264 derivative at preview/<slug>/<id>.mp4 for any
# video the browser/WebView cannot handle as-is, and leaves the ORIGINAL
# untouched. media.ts already prefers that key and falls back to original/, so
# nothing else has to change for playback to use it; "download original" still
# serves the real file.
#
# Two things make a video unplayable here, and both are checked:
#  - CODEC: HEVC/H.265 ("High Efficiency" on phone cameras) is not decodable in
#    the Android WebView, and Chromecast reports DEMUXER_ERROR_NO_SUPPORTED_STREAMS.
#  - RESOLUTION: an 8K stream defeats the decoder regardless of codec. Measured
#    on production: 7 of 10 visible gallery tiles failed with
#    PIPELINE_ERROR_DECODE, and the file probed was 7680x4320 HEVC, 398MB.
#
# This script used to re-encode in place, overwriting the source. That ruled out
# ever capping resolution — doing so would have destroyed the user's 8K footage —
# so it produced 8K H.264 files that were just as unplayable as the HEVC ones.
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
# Longest side of the generated derivative. 1080p plays everywhere and is ample
# for a gallery tile or full-screen phone playback; the untouched original stays
# available for download.
MAX_PREVIEW_HEIGHT=1080
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
  SOURCE_KEY="original/$R2_SLUG/$R2_PHOTO_ID.mp4"
  # The playable derivative goes to its OWN key. media.ts already looks for
  # preview/<slug>/<id>.mp4 before falling back to original/, so writing here is
  # all that is needed for the gallery and photo detail to pick it up.
  #
  # This used to overwrite SOURCE_KEY in place. That was destructive on its own
  # terms — the re-encode is lossy — and it made capping resolution impossible
  # without permanently destroying the user's source footage.
  PREVIEW_KEY="preview/$R2_SLUG/$R2_PHOTO_ID.mp4"

  echo "--- Photo $ID ($SOURCE_KEY) ---"

  INPUT_FILE="$WORKDIR/$ID-input.mp4"
  OUTPUT_FILE="$WORKDIR/$ID-output.mp4"

  if ! wrangler r2 object get "$R2_BUCKET/$SOURCE_KEY" --file "$INPUT_FILE" --remote >/dev/null 2>&1; then
    echo "  Could not download from R2 — marking failed."
    mark_status "$ID" "failed" "false"
    continue
  fi

  # Normalize before comparing. `-of csv=p=0` can emit a trailing separator (and
  # more than one line when a file carries extra streams), so the raw value comes
  # back as e.g. "h264," rather than "h264". That never equalled "h264" below, so
  # already-compatible H.264 videos were re-encoded to H.264 on every run —
  # visible in the 2026-08-09 job log as "Codec is h264, — transcoding to
  # H.264..." alongside correct "Codec is h264 — already compatible" lines, and
  # as a run time of 1h21m (one file took 38 minutes) against the usual 30s-3m.
  # That waste also starved the batch: at 15 videos per nightly run, real work
  # queued behind pointless re-encodes.
  PROBE=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,height -of csv=p=0 "$INPUT_FILE" 2>/dev/null | head -n1 | tr -d '\r')
  CODEC=$(echo "$PROBE" | cut -d, -f1 | tr -d '[:space:]')
  HEIGHT=$(echo "$PROBE" | cut -d, -f2 | tr -d '[:space:]')
  [ -z "$HEIGHT" ] && HEIGHT=0

  if [ -z "$CODEC" ]; then
    echo "  Could not determine video codec — marking failed."
    mark_status "$ID" "failed" "false"
    rm -f "$INPUT_FILE"
    continue
  fi

  # RESOLUTION matters as much as codec, which the old rule missed entirely.
  # An 8K H.264 file was marked "compatible" and never looked at again, yet the
  # Android WebView cannot decode it any more than it can decode 8K HEVC — the
  # gallery reported PIPELINE_ERROR_DECODE on 7 of 10 visible tiles, and the one
  # probed locally was 7680x4320 HEVC, 398MB, 39s.
  if [ "$CODEC" = "h264" ] && [ "$HEIGHT" -le "$MAX_PREVIEW_HEIGHT" ] && [ "$HEIGHT" -gt 0 ]; then
    echo "  h264 at ${HEIGHT}p — plays as-is, no derivative needed."
    mark_status "$ID" "compatible" "false"
    rm -f "$INPUT_FILE"
    continue
  fi

  echo "  $CODEC at ${HEIGHT}p — building ${MAX_PREVIEW_HEIGHT}p H.264 derivative..."
  # scale='-2:min(H,ih)' keeps the aspect ratio, only ever downscales (never
  # upscales a small clip), and -2 keeps the width even, which H.264 requires.
  # `veryfast` rather than `medium`: decoding 8K source is slow enough on its own
  # and a GitHub runner is capped at 6 hours per job.
  # +faststart puts the moov atom first — without it a player must fetch the whole
  # file before it can show anything, which is half of what made these tiles hang.
  if ffmpeg -nostdin -y -loglevel error -i "$INPUT_FILE" \
      -vf "scale='-2:min($MAX_PREVIEW_HEIGHT,ih)'" \
      -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
      -c:a aac -b:a 128k \
      -movflags +faststart \
      "$OUTPUT_FILE"; then
    IN_MB=$(( $(wc -c < "$INPUT_FILE") / 1000000 ))
    OUT_MB=$(( $(wc -c < "$OUTPUT_FILE") / 1000000 ))
    echo "  Encoded ${IN_MB}MB -> ${OUT_MB}MB, uploading derivative..."
    if wrangler r2 object put "$R2_BUCKET/$PREVIEW_KEY" --file "$OUTPUT_FILE" --content-type "video/mp4" --remote >/dev/null; then
      mark_status "$ID" "preview" "true"
      echo "  Done — $PREVIEW_KEY written, original untouched, cache_version bumped."
    else
      echo "  Upload to R2 failed — marking failed."
      mark_status "$ID" "failed" "false"
    fi
  else
    echo "  ffmpeg encode failed — marking failed."
    mark_status "$ID" "failed" "false"
  fi

  rm -f "$INPUT_FILE" "$OUTPUT_FILE"
done

echo "Batch complete."
