-- Remove the Albums feature (cross-event collections, admin-only).
--
-- Albums shipped in 023 but never got a public or shared view, so a curated
-- collection was only ever visible to the admin who made it. Rather than
-- finish it (public view, rename UI, manual ordering, plus a fix for the
-- cover-photo update wiping the description), the feature is being removed.
--
-- album_photos goes first: it holds the FK into albums.
DROP TABLE IF EXISTS album_photos;
DROP TABLE IF EXISTS albums;

-- Drop the orphaned feed rows too, otherwise the activity page renders them
-- through its unknown-action fallback as "performed album_create".
DELETE FROM activity_log WHERE action = 'album_create';
