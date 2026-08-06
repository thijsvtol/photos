package nl.thijsvtol.photos.sync;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Enumerates media files under a Storage Access Framework tree URI.
 *
 * Capacitor's Filesystem.readdir() uses java.io.File.listFiles(), which returns
 * null under Android 11+ scoped storage, so this walks DocumentsContract
 * directly. Extracted from SafDirectoryPlugin (which now delegates here) so the
 * background {@link FolderSyncWorker} and the JS bridge share one
 * implementation, and generalised with:
 *
 * - recursion into subdirectories (camera roll folders routinely nest), with a
 *   depth cap and visited-set so a symlinked/self-referential provider can't
 *   spin forever;
 * - an mtime floor, so a periodic scan can cheaply skip the bulk of a large
 *   folder it has already walked;
 * - a hard result cap, so one scan of a 50,000-file directory can't exhaust
 *   memory before the worker gets a chance to process anything.
 */
public class SafScanner {

    /** Same media types the JS layer accepted (see folderSync.ts isMediaFile). */
    private static final Set<String> MEDIA_EXTENSIONS = new HashSet<>(Arrays.asList(
        "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "mp4", "mov", "avi", "mkv"
    ));

    private static final int MAX_DEPTH = 8;

    /** A single media file discovered by a scan. */
    public static class SafFile {
        public final String name;
        public final String uri;
        public final String docId;
        public final String mimeType;
        public final long size;
        public final long mtime;

        SafFile(String name, String uri, String docId, String mimeType, long size, long mtime) {
            this.name = name;
            this.uri = uri;
            this.docId = docId;
            this.mimeType = mimeType;
            this.size = size;
            this.mtime = mtime;
        }
    }

    /**
     * Takes the persistable read permission for a tree so the URI keeps working
     * across app restarts and, critically, inside a WorkManager job that runs
     * long after the picker Activity is gone.
     */
    public static void takePersistablePermission(ContentResolver resolver, Uri treeUri) {
        try {
            resolver.takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            // Non-fatal: already taken, or the provider doesn't offer persistable grants.
        }
    }

    /**
     * Walks {@code treeUriString} and returns the media files in it.
     *
     * @param recursive descend into subdirectories
     * @param sinceMtime only return files modified strictly after this epoch-ms
     *                   value; pass 0 for everything. This is an optimisation
     *                   only — the ledger, not this filter, decides what is
     *                   actually new.
     * @param limit      stop after this many files (<= 0 for unlimited)
     */
    public static List<SafFile> scan(
        ContentResolver resolver,
        String treeUriString,
        boolean recursive,
        long sinceMtime,
        int limit
    ) {
        List<SafFile> results = new ArrayList<>();
        if (treeUriString == null || !treeUriString.startsWith("content://")) return results;

        Uri treeUri = Uri.parse(treeUriString);
        takePersistablePermission(resolver, treeUri);

        String rootDocId;
        try {
            rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
        } catch (Exception e) {
            return results;
        }

        String[] projection = new String[]{
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED
        };

        Deque<String[]> queue = new ArrayDeque<>();  // {docId, depth}
        queue.add(new String[]{rootDocId, "0"});
        Set<String> visited = new HashSet<>();

        while (!queue.isEmpty()) {
            if (limit > 0 && results.size() >= limit) break;

            String[] node = queue.poll();
            String docId = node[0];
            int depth = Integer.parseInt(node[1]);
            if (!visited.add(docId)) continue;

            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
            try (Cursor cursor = resolver.query(childrenUri, projection, null, null, null)) {
                if (cursor == null) continue;

                int idCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                int nameCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                int mimeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
                int sizeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
                int mtimeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
                if (idCol < 0 || nameCol < 0) continue;

                while (cursor.moveToNext()) {
                    if (limit > 0 && results.size() >= limit) break;

                    String childDocId = cursor.getString(idCol);
                    String name = cursor.getString(nameCol);
                    if (childDocId == null || name == null || name.isEmpty()) continue;

                    String mimeType = mimeCol >= 0 ? cursor.getString(mimeCol) : null;

                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)) {
                        if (recursive && depth < MAX_DEPTH) {
                            queue.add(new String[]{childDocId, String.valueOf(depth + 1)});
                        }
                        continue;
                    }

                    if (!isMediaFile(name)) continue;

                    long size = sizeCol >= 0 && !cursor.isNull(sizeCol) ? cursor.getLong(sizeCol) : 0L;
                    long mtime = mtimeCol >= 0 && !cursor.isNull(mtimeCol)
                        ? cursor.getLong(mtimeCol)
                        : System.currentTimeMillis();

                    // Zero-byte entries are usually a file still being written by
                    // the camera app; skip and pick it up on the next scan.
                    if (size <= 0) continue;
                    if (sinceMtime > 0 && mtime <= sinceMtime) continue;

                    Uri fileUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocId);
                    results.add(new SafFile(
                        name,
                        fileUri.toString(),
                        childDocId,
                        mimeType != null ? mimeType : guessMimeType(name),
                        size,
                        mtime
                    ));
                }
            } catch (Exception e) {
                // A single unreadable subdirectory must not abort the whole scan.
            }
        }

        return results;
    }

    public static boolean isMediaFile(String filename) {
        return MEDIA_EXTENSIONS.contains(extensionOf(filename));
    }

    private static String extensionOf(String filename) {
        if (filename == null) return "";
        int dot = filename.lastIndexOf('.');
        if (dot < 0 || dot == filename.length() - 1) return "";
        return filename.substring(dot + 1).toLowerCase(Locale.US);
    }

    /** Mirrors getMimeType() in apps/web/src/services/folderSync.ts. */
    public static String guessMimeType(String filename) {
        switch (extensionOf(filename)) {
            case "jpg":
            case "jpeg": return "image/jpeg";
            case "png": return "image/png";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "heic": return "image/heic";
            case "heif": return "image/heif";
            case "mp4": return "video/mp4";
            case "mov": return "video/quicktime";
            case "avi": return "video/x-msvideo";
            case "mkv": return "video/x-matroska";
            default: return "application/octet-stream";
        }
    }

    public static boolean isVideo(String mimeType) {
        return mimeType != null && mimeType.startsWith("video/");
    }
}
