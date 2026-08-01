-- Tracks whether a video's codec has been checked/normalized for broad
-- playback compatibility (specifically Chromecast/Google Cast, which lacks
-- HEVC/H.265 hardware decode support on many devices — videos recorded in
-- HEVC by phones "High Efficiency" camera settings fail to cast with
-- DEMUXER_ERROR_NO_SUPPORTED_STREAMS, while H.264 videos work fine).
--
-- This is populated by a nightly GitHub Actions job (see
-- .github/workflows/video-transcode.yml + scripts/transcode-videos.sh) that
-- runs real (native, not WASM) ffmpeg/ffprobe on a GitHub-hosted runner —
-- deliberately NOT done client-side at upload time (would risk upload
-- reliability with a heavy WASM re-encode) and NOT done in the Cloudflare
-- Worker itself (Workers can't spawn native processes / aren't suited to
-- CPU-heavy transcoding).
--
-- NULL           = not yet checked (all existing + newly uploaded videos
--                   start here; the nightly job's query filters on this)
-- 'compatible'   = checked, already H.264 — no action taken
-- 'transcoded'   = was HEVC/incompatible, successfully re-encoded to H.264
--                  in-place (cache_version was bumped so clients/CDN see
--                  the new file)
-- 'failed'       = transcode was attempted but failed; not auto-retried
ALTER TABLE photos ADD COLUMN video_transcode_status TEXT;

-- Speeds up the nightly job's "find videos not yet checked" query.
CREATE INDEX IF NOT EXISTS idx_photos_video_transcode_status
  ON photos(file_type, video_transcode_status);
