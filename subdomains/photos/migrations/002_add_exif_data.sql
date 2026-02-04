-- Add EXIF metadata columns to photos table
ALTER TABLE photos ADD COLUMN iso INTEGER;
ALTER TABLE photos ADD COLUMN aperture TEXT; -- e.g. "f/2.8"
ALTER TABLE photos ADD COLUMN shutter_speed TEXT; -- e.g. "1/250"
ALTER TABLE photos ADD COLUMN focal_length TEXT; -- e.g. "50mm"
ALTER TABLE photos ADD COLUMN camera_make TEXT; -- e.g. "Canon"
ALTER TABLE photos ADD COLUMN camera_model TEXT; -- e.g. "EOS R5"
ALTER TABLE photos ADD COLUMN lens_model TEXT; -- e.g. "RF 24-70mm F2.8 L IS USM"
