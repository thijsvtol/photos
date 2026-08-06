package nl.thijsvtol.photos.sync;

import android.content.ContentResolver;
import android.net.Uri;

import androidx.annotation.NonNull;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.BufferedSink;

/**
 * Native client for the photo upload API, mirroring apps/web/src/api.ts.
 *
 * The endpoints, headers and multipart semantics are identical to the web
 * path — same POST /uploads/start, PUT /uploads/:photoId/parts/:n,
 * POST /uploads/:photoId/complete — so photos uploaded by the background
 * engine are indistinguishable server-side from web-uploaded ones.
 *
 * The one thing this does differently, and the reason it exists, is
 * {@link ContentUriPartBody}: a part's bytes are streamed straight off the
 * content:// URI into the socket, so uploading a 4GB video costs one 10MB
 * buffer rather than 4GB of heap.
 */
public class PhotosApiClient {

    /** Chunk sizes match apps/web/src/services/uploadManager.ts. */
    public static final int CHUNK_SIZE = 5 * 1024 * 1024;
    public static final int VIDEO_CHUNK_SIZE = 10 * 1024 * 1024;
    /** R2 caps a multipart object at 10,000 parts; stay well clear for huge videos. */
    private static final int VIDEO_CHUNK_TARGET_MAX_PARTS = 2000;
    /** Well under a Cloudflare Worker's ~128MB memory limit (it buffers each part). */
    private static final int VIDEO_CHUNK_MAX_SIZE = 64 * 1024 * 1024;

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final MediaType OCTET_STREAM = MediaType.get("application/octet-stream");

    private final OkHttpClient http;
    private final ContentResolver resolver;
    private final String baseUrl;
    private final String authToken;

    /** Thrown when the API rejects our bearer token — the user must sign in again. */
    public static class AuthExpiredException extends IOException {
        public AuthExpiredException(String message) {
            super(message);
        }
    }

    /**
     * Thrown for responses that will never succeed on retry (bad request,
     * forbidden, expired upload session, payload too large). Mirrors
     * NON_RETRYABLE_STATUS_CODES in apps/web/src/services/uploadManager.ts, so
     * the worker doesn't burn the user's data plan retrying the inevitable.
     */
    public static class NonRetryableException extends IOException {
        public NonRetryableException(String message) {
            super(message);
        }
    }

    public PhotosApiClient(ContentResolver resolver, String baseUrl, String authToken) {
        this.resolver = resolver;
        this.baseUrl = stripTrailingSlash(baseUrl);
        this.authToken = authToken;
        this.http = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            // Generous per-request timeouts, matching CHUNK_UPLOAD_TIMEOUT_MS in
            // api.ts: long enough for a 10MB chunk on a slow connection, short
            // enough that a dead connection is detected in bounded time rather
            // than hanging the whole run.
            .writeTimeout(120, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build();
    }

    private static String stripTrailingSlash(String url) {
        if (url == null) return null;
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    public static int chunkSizeFor(String mimeType, long fileSize) {
        if (!SafScanner.isVideo(mimeType)) return CHUNK_SIZE;
        long sizeAtBaseChunking = (long) VIDEO_CHUNK_SIZE * VIDEO_CHUNK_TARGET_MAX_PARTS;
        if (fileSize <= sizeAtBaseChunking) return VIDEO_CHUNK_SIZE;
        long scaled = (fileSize + VIDEO_CHUNK_TARGET_MAX_PARTS - 1) / VIDEO_CHUNK_TARGET_MAX_PARTS;
        return (int) Math.min(scaled, VIDEO_CHUNK_MAX_SIZE);
    }

    private Request.Builder request(String path) {
        return new Request.Builder()
            .url(baseUrl + path)
            .header("Authorization", "Bearer " + authToken)
            // Mirrors getAdminHeaders() in api.ts — the worker's admin router
            // requires this on admin-scoped routes.
            .header("X-Admin-Access", "1");
    }

    private String uploadsPath(String eventSlug) {
        return "/admin/events/" + Uri.encode(eventSlug) + "/uploads";
    }

    /** Executes a request, mapping error statuses onto the exception types above. */
    private String execute(Request req) throws IOException {
        try (Response res = http.newCall(req).execute()) {
            ResponseBody body = res.body();
            String text = body != null ? body.string() : "";
            if (res.isSuccessful()) return text;

            int code = res.code();
            String message = "HTTP " + code + (text.isEmpty() ? "" : ": " + truncate(text));
            if (code == 401) throw new AuthExpiredException(message);
            if (code == 400 || code == 403 || code == 404 || code == 413 || code == 422) {
                throw new NonRetryableException(message);
            }
            throw new IOException(message);
        }
    }

    private static String truncate(String s) {
        return s.length() <= 300 ? s : s.substring(0, 300) + "…";
    }

    // ── duplicate pre-check ──

    /**
     * Asks the server which of these content hashes it already has a
     * fully-uploaded photo for in this event.
     *
     * This is what lets folder sync survive a reinstall or cleared app data:
     * the local ledger is the fast path, this is the authoritative fallback.
     * Best-effort by design — if the check fails we upload and let the
     * existing duplicate tooling sort it out, rather than blocking sync.
     */
    public List<String> checkHashes(String eventSlug, List<String> hashes) throws IOException {
        List<String> existing = new ArrayList<>();
        if (hashes.isEmpty()) return existing;

        JSONArray arr = new JSONArray();
        for (String h : hashes) arr.put(h);
        JSONObject payload = new JSONObject();
        try {
            payload.put("hashes", arr);
        } catch (Exception e) {
            return existing;
        }

        String response = execute(
            request(uploadsPath(eventSlug) + "/check-hashes")
                .post(RequestBody.create(payload.toString(), JSON))
                .build()
        );

        try {
            JSONArray found = new JSONObject(response).optJSONArray("existing");
            if (found != null) {
                for (int i = 0; i < found.length(); i++) existing.add(found.getString(i));
            }
        } catch (Exception e) {
            // Malformed response — treat as "nothing known", i.e. upload.
        }
        return existing;
    }

    // ── multipart upload ──

    /**
     * Starts a multipart upload and creates/refreshes the photo row.
     *
     * @param metadata EXIF fields from {@link MediaProbe#readMetadata}, merged
     *                 into the request body so natively-uploaded photos carry
     *                 the same metadata as web-uploaded ones.
     * @return the R2 upload id
     */
    public String startUpload(
        String eventSlug,
        String photoId,
        String filename,
        String fileType,
        String fileHash,
        String blurPlaceholder,
        JSONObject metadata,
        boolean isPreview
    ) throws IOException {
        JSONObject body = new JSONObject();
        try {
            if (metadata != null) {
                java.util.Iterator<String> keys = metadata.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    body.put(key, metadata.get(key));
                }
            }
            body.put("photoId", photoId);
            body.put("filename", filename);
            body.put("isPreview", isPreview);
            if (fileType != null) body.put("fileType", fileType);
            if (fileHash != null) body.put("fileHash", fileHash);
            if (blurPlaceholder != null) body.put("blurPlaceholder", blurPlaceholder);
        } catch (Exception e) {
            throw new IOException("Failed to build start-upload body", e);
        }

        String response = execute(
            request(uploadsPath(eventSlug) + "/start")
                .post(RequestBody.create(body.toString(), JSON))
                .build()
        );

        try {
            return new JSONObject(response).getString("uploadId");
        } catch (Exception e) {
            throw new IOException("start-upload response had no uploadId", e);
        }
    }

    /** Uploads one part streamed directly from a content:// URI. Returns its ETag. */
    public String uploadPart(
        String eventSlug,
        String photoId,
        String uploadId,
        int partNumber,
        String contentUri,
        long offset,
        long length,
        String fileType,
        boolean isPreview
    ) throws IOException {
        RequestBody body = new ContentUriPartBody(resolver, contentUri, offset, length);
        return uploadPartBody(eventSlug, photoId, uploadId, partNumber, body, fileType, isPreview);
    }

    /** Uploads one part from an in-memory buffer (used for the small preview JPEG). */
    public String uploadPart(
        String eventSlug,
        String photoId,
        String uploadId,
        int partNumber,
        byte[] bytes,
        int offset,
        int length,
        String fileType,
        boolean isPreview
    ) throws IOException {
        RequestBody body = RequestBody.create(bytes, OCTET_STREAM, offset, length);
        return uploadPartBody(eventSlug, photoId, uploadId, partNumber, body, fileType, isPreview);
    }

    private String uploadPartBody(
        String eventSlug,
        String photoId,
        String uploadId,
        int partNumber,
        RequestBody body,
        String fileType,
        boolean isPreview
    ) throws IOException {
        String path = uploadsPath(eventSlug) + "/" + Uri.encode(photoId) + "/parts/" + partNumber
            + (isPreview ? "?preview=true" : "");

        String response = execute(
            request(path)
                .put(body)
                .header("X-Upload-Id", uploadId)
                .header("X-File-Type", fileType != null ? fileType : "image/jpeg")
                .build()
        );

        try {
            return new JSONObject(response).getString("etag");
        } catch (Exception e) {
            throw new IOException("part response had no etag", e);
        }
    }

    /** @param parts must be ordered by part number — R2 rejects out-of-order parts. */
    public void completeUpload(
        String eventSlug,
        String photoId,
        String uploadId,
        List<Part> parts,
        boolean isPreview
    ) throws IOException {
        JSONArray arr = new JSONArray();
        try {
            for (Part p : parts) {
                JSONObject o = new JSONObject();
                o.put("partNumber", p.partNumber);
                o.put("etag", p.etag);
                arr.put(o);
            }
            JSONObject body = new JSONObject();
            body.put("uploadId", uploadId);
            body.put("parts", arr);

            String path = uploadsPath(eventSlug) + "/" + Uri.encode(photoId) + "/complete"
                + (isPreview ? "?preview=true" : "");

            execute(request(path).post(RequestBody.create(body.toString(), JSON)).build());
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException("Failed to build complete-upload body", e);
        }
    }

    /**
     * Best-effort abort of an orphaned multipart upload and its incomplete
     * photo row, so permanently-failed files don't leave half-uploaded data
     * lingering in R2.
     */
    public void cancelUpload(String eventSlug, String photoId, String uploadId, String fileType) {
        try {
            JSONObject body = new JSONObject();
            if (uploadId != null) body.put("uploadId", uploadId);
            if (fileType != null) body.put("fileType", fileType);
            execute(
                request(uploadsPath(eventSlug) + "/" + Uri.encode(photoId) + "/cancel")
                    .post(RequestBody.create(body.toString(), JSON))
                    .build()
            );
        } catch (Exception e) {
            // Cleanup is best-effort; never let it fail a run.
        }
    }

    /** One completed multipart part. */
    public static class Part {
        public final int partNumber;
        public final String etag;

        public Part(int partNumber, String etag) {
            this.partNumber = partNumber;
            this.etag = etag;
        }
    }

    /**
     * Streams a byte range of a content:// document as a request body.
     *
     * The whole point of the native engine: bytes go straight from the
     * MediaStore/SAF provider into the socket. Nothing buffers the file, so
     * memory use is flat regardless of file size or how many files are queued.
     *
     * {@code skip()} is used rather than random access because SAF providers
     * are not required to return a seekable stream; parts are uploaded in
     * ascending order so the skip cost stays proportional to the file, not
     * quadratic in practice for the common (resume-from-part-N) case.
     */
    private static class ContentUriPartBody extends RequestBody {
        private static final int BUFFER_SIZE = 64 * 1024;

        private final ContentResolver resolver;
        private final String uri;
        private final long offset;
        private final long length;

        ContentUriPartBody(ContentResolver resolver, String uri, long offset, long length) {
            this.resolver = resolver;
            this.uri = uri;
            this.offset = offset;
            this.length = length;
        }

        @Override
        public MediaType contentType() {
            return OCTET_STREAM;
        }

        @Override
        public long contentLength() {
            return length;
        }

        @Override
        public void writeTo(@NonNull BufferedSink sink) throws IOException {
            try (InputStream in = resolver.openInputStream(Uri.parse(uri))) {
                if (in == null) throw new IOException("Could not open " + uri);

                long toSkip = offset;
                while (toSkip > 0) {
                    long skipped = in.skip(toSkip);
                    if (skipped <= 0) {
                        // skip() can legitimately return 0; fall back to reading.
                        if (in.read() == -1) throw new IOException("Unexpected end of file while seeking");
                        toSkip--;
                    } else {
                        toSkip -= skipped;
                    }
                }

                byte[] buffer = new byte[BUFFER_SIZE];
                long remaining = length;
                while (remaining > 0) {
                    int read = in.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                    if (read == -1) break;
                    sink.write(buffer, 0, read);
                    remaining -= read;
                }
                if (remaining > 0) {
                    // The file shrank or was replaced mid-upload. Fail loudly
                    // rather than silently uploading a truncated part.
                    throw new IOException("File ended " + remaining + " bytes early — was it modified during upload?");
                }
            }
        }
    }
}
