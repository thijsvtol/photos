-- Per-video poster (cover) image tracking.
--
-- Videos have never had a still-image thumbnail: the gallery/timeline mounted a <video> at the
-- MP4 (the 1080p derivative or the original) just to paint one frame, using only a 16x16
-- blur_placeholder as the poster. Scrolling a wall of large videos meant hundreds of concurrent
-- MP4 range-requests — slow, connection-exhausting, blank tiles. We now generate a real poster
-- JPEG per video (stored at R2 key poster/<slug>/<id>.jpg) so grids render a fast <img> and only
-- load the MP4 on play.
--
-- NULL  = poster not generated yet (the nightly ffmpeg job's selection target).
-- 'done' / 'failed' = generated / permanently gave up.
--
-- Deliberately SEPARATE from video_transcode_status (migration 022): existing videos already have
-- a transcode status set, so gating the poster backfill on transcode state would skip the whole
-- existing library. A dedicated NULL-default column naturally re-selects every existing video for
-- poster generation without disturbing its transcode status.
ALTER TABLE photos ADD COLUMN video_poster_status TEXT;

CREATE INDEX IF NOT EXISTS idx_photos_video_poster_status ON photos(video_poster_status);
