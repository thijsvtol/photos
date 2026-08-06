package nl.thijsvtol.photos.sync;

import android.content.ContentResolver;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;
import android.util.Base64;

import androidx.exifinterface.media.ExifInterface;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * Reads what the uploader needs to know about a file — content hash, preview
 * JPEG, EXIF metadata — without ever holding the whole file in memory.
 *
 * This is the core of the "can't handle big upload batches" fix. The previous
 * JS path called Filesystem.readFile(), which pushed the entire file across the
 * Capacitor bridge as one base64 string, then atob()'d it into a second full
 * copy, then built a Blob — roughly 3x the file size resident per photo, for
 * every photo in the folder, before a single byte was uploaded. Here nothing
 * larger than a 64KB buffer (hashing) or a downscaled bitmap (preview) is ever
 * resident, so peak memory is independent of both file size and batch size.
 */
public class MediaProbe {

    /** Matches MAX_HASHABLE_SIZE in apps/web/src/imageUtils.ts. */
    private static final long MAX_HASHABLE_SIZE = 100L * 1024 * 1024;

    private static final int HASH_BUFFER_SIZE = 64 * 1024;

    /** Matches createPreview() in apps/web/src/imageUtils.ts (1920px, q85). */
    private static final int PREVIEW_MAX_DIMENSION = 1920;
    private static final int PREVIEW_QUALITY = 85;

    /** Matches the 16x16 blur placeholder produced by uploadManager.extractExifData(). */
    private static final int BLUR_PLACEHOLDER_SIZE = 16;
    private static final int BLUR_PLACEHOLDER_QUALITY = 30;

    private final ContentResolver resolver;

    public MediaProbe(ContentResolver resolver) {
        this.resolver = resolver;
    }

    // ── hashing ──

    /**
     * Streaming SHA-256 of a file's contents, lowercase hex — byte-identical to
     * computeFileHash() in apps/web/src/imageUtils.ts, so photos uploaded by
     * this engine group correctly with web-uploaded ones in
     * GET /admin/photos/duplicates and syncPeopleAcrossDuplicates().
     *
     * Returns null (never throws) above the size cap or on any read failure —
     * a missing hash costs duplicate detection for that one photo, it must
     * never fail the upload.
     */
    public String sha256(String uriString, long size) {
        if (size > MAX_HASHABLE_SIZE) return null;
        try (InputStream in = resolver.openInputStream(Uri.parse(uriString))) {
            if (in == null) return null;
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[HASH_BUFFER_SIZE];
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
            StringBuilder sb = new StringBuilder(64);
            for (byte b : digest.digest()) {
                sb.append(String.format(Locale.US, "%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    // ── preview ──

    /**
     * A downscaled JPEG preview, or null if the image can't be decoded.
     *
     * Decodes with inSampleSize so the full-resolution bitmap is never
     * allocated — a 108MP phone photo would otherwise need ~430MB as an
     * ARGB_8888 bitmap and take the process down. On OutOfMemoryError the
     * decode is retried once at double the subsampling; if that also fails the
     * caller uploads the original without a preview (the media endpoint falls
     * back to serving the original), which is strictly better than failing the
     * photo.
     */
    public byte[] createPreview(String uriString) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream in = resolver.openInputStream(Uri.parse(uriString))) {
                if (in == null) return null;
                BitmapFactory.decodeStream(in, null, bounds);
            }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;

            int sampleSize = computeInSampleSize(bounds.outWidth, bounds.outHeight, PREVIEW_MAX_DIMENSION);

            byte[] jpeg = decodeAndCompress(uriString, sampleSize);
            if (jpeg == null) {
                // Retry once at half the resolution before giving up.
                jpeg = decodeAndCompress(uriString, sampleSize * 2);
            }
            return jpeg;
        } catch (Exception | OutOfMemoryError e) {
            return null;
        }
    }

    private byte[] decodeAndCompress(String uriString, int sampleSize) {
        Bitmap decoded = null;
        Bitmap scaled = null;
        try {
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = Math.max(1, sampleSize);
            try (InputStream in = resolver.openInputStream(Uri.parse(uriString))) {
                if (in == null) return null;
                decoded = BitmapFactory.decodeStream(in, null, opts);
            }
            if (decoded == null) return null;

            scaled = scaleToMaxDimension(decoded, PREVIEW_MAX_DIMENSION);
            Bitmap oriented = applyExifRotation(uriString, scaled);
            if (oriented != scaled && scaled != decoded) scaled.recycle();
            scaled = oriented;

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, PREVIEW_QUALITY, out);
            return out.toByteArray();
        } catch (Exception | OutOfMemoryError e) {
            return null;
        } finally {
            // Bitmaps are the single largest allocation in this whole engine;
            // release them eagerly rather than waiting for the GC to notice.
            if (scaled != null && scaled != decoded) scaled.recycle();
            if (decoded != null) decoded.recycle();
        }
    }

    private static int computeInSampleSize(int width, int height, int maxDimension) {
        int sampleSize = 1;
        int longEdge = Math.max(width, height);
        while (longEdge / sampleSize > maxDimension * 2) {
            sampleSize *= 2;
        }
        return sampleSize;
    }

    private static Bitmap scaleToMaxDimension(Bitmap src, int maxDimension) {
        int w = src.getWidth();
        int h = src.getHeight();
        int longEdge = Math.max(w, h);
        if (longEdge <= maxDimension) return src;
        float ratio = (float) maxDimension / longEdge;
        return Bitmap.createScaledBitmap(src, Math.round(w * ratio), Math.round(h * ratio), true);
    }

    /**
     * Bakes the EXIF orientation into the pixels. The browser's canvas path did
     * this implicitly; BitmapFactory does not, so without it previews of
     * portrait photos come out sideways in the gallery.
     */
    private Bitmap applyExifRotation(String uriString, Bitmap bitmap) {
        try (InputStream in = resolver.openInputStream(Uri.parse(uriString))) {
            if (in == null) return bitmap;
            int orientation = new ExifInterface(in)
                .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            Matrix matrix = new Matrix();
            switch (orientation) {
                case ExifInterface.ORIENTATION_ROTATE_90: matrix.postRotate(90); break;
                case ExifInterface.ORIENTATION_ROTATE_180: matrix.postRotate(180); break;
                case ExifInterface.ORIENTATION_ROTATE_270: matrix.postRotate(270); break;
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.postScale(-1, 1); break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.postScale(1, -1); break;
                default: return bitmap;
            }
            return Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
        } catch (Exception | OutOfMemoryError e) {
            return bitmap;
        }
    }

    /**
     * The 16x16 base64 data URL used as a blur placeholder while the real image
     * loads, matching what uploadManager.extractExifData() produces on web.
     */
    public String createBlurPlaceholder(String uriString) {
        Bitmap thumb = null;
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream in = resolver.openInputStream(Uri.parse(uriString))) {
                if (in == null) return null;
                BitmapFactory.decodeStream(in, null, bounds);
            }
            if (bounds.outWidth <= 0) return null;

            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = computeInSampleSize(bounds.outWidth, bounds.outHeight, BLUR_PLACEHOLDER_SIZE);
            Bitmap decoded;
            try (InputStream in = resolver.openInputStream(Uri.parse(uriString))) {
                if (in == null) return null;
                decoded = BitmapFactory.decodeStream(in, null, opts);
            }
            if (decoded == null) return null;

            thumb = Bitmap.createScaledBitmap(decoded, BLUR_PLACEHOLDER_SIZE, BLUR_PLACEHOLDER_SIZE, true);
            if (thumb != decoded) decoded.recycle();

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            thumb.compress(Bitmap.CompressFormat.JPEG, BLUR_PLACEHOLDER_QUALITY, out);
            return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception | OutOfMemoryError e) {
            return null;
        } finally {
            if (thumb != null) thumb.recycle();
        }
    }

    // ── metadata ──

    /**
     * EXIF metadata in the shape POST /uploads/start expects, mirroring the
     * fields extractExifData() sends from the web path so natively-uploaded
     * photos aren't second-class in the gallery (capture time drives the
     * timeline, width/height drive the justified grid).
     */
    public JSONObject readMetadata(String uriString, String mimeType, long fallbackMtime) {
        JSONObject meta = new JSONObject();
        try {
            if (SafScanner.isVideo(mimeType)) {
                // Videos carry no EXIF; capture time falls back to the file's
                // mtime, and dimensions/poster are filled in by the web layer
                // when the photo is next opened.
                meta.put("captureTime", isoFrom(fallbackMtime));
                return meta;
            }

            try (InputStream in = resolver.openInputStream(Uri.parse(uriString))) {
                if (in == null) {
                    meta.put("captureTime", isoFrom(fallbackMtime));
                    return meta;
                }
                ExifInterface exif = new ExifInterface(in);

                String captureTime = parseExifDate(exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL));
                meta.put("captureTime", captureTime != null ? captureTime : isoFrom(fallbackMtime));

                putIfPositive(meta, "width", exif.getAttributeInt(ExifInterface.TAG_IMAGE_WIDTH, 0));
                putIfPositive(meta, "height", exif.getAttributeInt(ExifInterface.TAG_IMAGE_LENGTH, 0));
                putIfPositive(meta, "iso", exif.getAttributeInt(ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY, 0));

                putIfPresent(meta, "aperture", exif.getAttribute(ExifInterface.TAG_F_NUMBER));
                putIfPresent(meta, "shutterSpeed", exif.getAttribute(ExifInterface.TAG_EXPOSURE_TIME));
                putIfPresent(meta, "focalLength", exif.getAttribute(ExifInterface.TAG_FOCAL_LENGTH));
                putIfPresent(meta, "cameraMake", exif.getAttribute(ExifInterface.TAG_MAKE));
                putIfPresent(meta, "cameraModel", exif.getAttribute(ExifInterface.TAG_MODEL));
                putIfPresent(meta, "lensModel", exif.getAttribute(ExifInterface.TAG_LENS_MODEL));

                double[] latLong = exif.getLatLong();
                if (latLong != null && latLong.length == 2) {
                    meta.put("latitude", latLong[0]);
                    meta.put("longitude", latLong[1]);
                }
            }

            // Dimensions are frequently absent from EXIF; fall back to the
            // decoder, which only reads the header when inJustDecodeBounds is set.
            if (!meta.has("width") || !meta.has("height")) {
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                try (InputStream in = resolver.openInputStream(Uri.parse(uriString))) {
                    if (in != null) BitmapFactory.decodeStream(in, null, bounds);
                }
                putIfPositive(meta, "width", bounds.outWidth);
                putIfPositive(meta, "height", bounds.outHeight);
            }
        } catch (Exception e) {
            // Metadata is best-effort; an upload with no EXIF is fine.
        }
        return meta;
    }

    private static void putIfPositive(JSONObject o, String key, int value) throws Exception {
        if (value > 0) o.put(key, value);
    }

    private static void putIfPresent(JSONObject o, String key, String value) throws Exception {
        if (value != null && !value.isEmpty()) o.put(key, value);
    }

    /** EXIF dates are "yyyy:MM:dd HH:mm:ss"; the API wants ISO-8601. */
    private static String parseExifDate(String exifDate) {
        if (exifDate == null || exifDate.length() < 19) return null;
        try {
            String date = exifDate.substring(0, 10).replace(':', '-');
            String time = exifDate.substring(11, 19);
            return date + "T" + time + "Z";
        } catch (Exception e) {
            return null;
        }
    }

    private static String isoFrom(long epochMillis) {
        return new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .format(new java.util.Date(epochMillis));
    }
}
