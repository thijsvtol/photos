package nl.thijsvtol.photos.plugins;

import android.content.ContentResolver;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import nl.thijsvtol.photos.sync.MediaProbe;
import nl.thijsvtol.photos.sync.SafScanner;

import java.io.OutputStream;
import java.util.List;

/**
 * Native Capacitor plugin for working with directories selected via Android's
 * Storage Access Framework (SAF).
 *
 * Capacitor's Filesystem.readdir() uses java.io.File.listFiles() which
 * returns null on Android 11+ scoped storage, so the actual enumeration lives
 * in {@link SafScanner} (DocumentsContract + ContentResolver). This plugin is
 * the JS-facing wrapper around it; the background folder-sync engine uses the
 * same scanner directly, so there is exactly one implementation of the walk.
 */
@CapacitorPlugin(name = "SafDirectory")
public class SafDirectoryPlugin extends Plugin {

    @PluginMethod()
    public void listFiles(PluginCall call) {
        String treeUriString = call.getString("treeUri");
        if (treeUriString == null || treeUriString.isEmpty()) {
            call.reject("treeUri parameter is required");
            return;
        }

        // Validate that this is a content:// URI
        if (!treeUriString.startsWith("content://")) {
            call.reject("treeUri must be a content:// URI from Storage Access Framework");
            return;
        }

        try {
            boolean recursive = Boolean.TRUE.equals(call.getBoolean("recursive", false));
            long since = call.getLong("since", 0L);
            int limit = call.getInt("limit", 0);

            List<SafScanner.SafFile> files = SafScanner.scan(
                getContext().getContentResolver(), treeUriString, recursive, since, limit
            );

            JSArray filesArray = new JSArray();
            for (SafScanner.SafFile file : files) {
                JSObject fileObj = new JSObject();
                fileObj.put("name", file.name);
                fileObj.put("uri", file.uri);
                fileObj.put("docId", file.docId);
                fileObj.put("mimeType", file.mimeType);
                fileObj.put("size", file.size);
                fileObj.put("mtime", file.mtime);
                filesArray.put(fileObj);
            }

            JSObject result = new JSObject();
            result.put("files", filesArray);
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to list directory: " + e.getMessage(), e);
        }
    }

    /**
     * Returns a downscaled JPEG preview of a single SAF document as base64.
     *
     * Used by faceDetectionQueue.ts to run face detection on photos the native
     * background engine uploaded: those never pass through the JS upload
     * manager, so there is no File blob to detect against. Deliberately returns
     * the ~1920px preview rather than the original — it's ample for face
     * detection and, unlike reading the original through
     * Filesystem.readFile(), it can't OOM the WebView on a 108MP photo.
     */
    @PluginMethod()
    public void readPreview(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.isEmpty()) {
            call.reject("uri parameter is required");
            return;
        }
        if (!uri.startsWith("content://")) {
            call.reject("uri must be a content:// URI from Storage Access Framework");
            return;
        }

        try {
            byte[] jpeg = new MediaProbe(getContext().getContentResolver()).createPreview(uri);
            if (jpeg == null) {
                call.reject("Could not decode image");
                return;
            }
            JSObject result = new JSObject();
            result.put("data", Base64.encodeToString(jpeg, Base64.NO_WRAP));
            result.put("mimeType", "image/jpeg");
            call.resolve(result);
        } catch (Exception | OutOfMemoryError e) {
            call.reject("Failed to read preview: " + e.getMessage());
        }
    }

    @PluginMethod()
    public void writeFile(PluginCall call) {
        String treeUriString = call.getString("treeUri");
        String filename = call.getString("filename");
        String base64Data = call.getString("data");
        String mimeType = call.getString("mimeType", "application/octet-stream");

        if (treeUriString == null || treeUriString.isEmpty()) {
            call.reject("treeUri parameter is required");
            return;
        }
        if (filename == null || filename.isEmpty()) {
            call.reject("filename parameter is required");
            return;
        }
        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("data parameter is required");
            return;
        }

        // Validate that this is a content:// URI
        if (!treeUriString.startsWith("content://")) {
            call.reject("treeUri must be a content:// URI from Storage Access Framework");
            return;
        }

        try {
            Uri treeUri = Uri.parse(treeUriString);
            String docId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);

            ContentResolver resolver = getContext().getContentResolver();

            // Take persistable write permission
            try {
                resolver.takePersistableUriPermission(treeUri,
                        android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (SecurityException e) {
                // Non-fatal: permission may already be taken
            }

            // Create a new document in the tree
            Uri newFileUri = DocumentsContract.createDocument(resolver, parentUri, mimeType, filename);
            
            if (newFileUri == null) {
                call.reject("Failed to create document in directory");
                return;
            }

            // Decode base64 data
            byte[] fileData = Base64.decode(base64Data, Base64.DEFAULT);

            // Write data to the document
            OutputStream outputStream = resolver.openOutputStream(newFileUri);
            if (outputStream == null) {
                call.reject("Failed to open output stream for writing");
                return;
            }

            try {
                outputStream.write(fileData);
                outputStream.flush();
            } finally {
                outputStream.close();
            }

            JSObject result = new JSObject();
            result.put("uri", newFileUri.toString());
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to write file: " + e.getMessage(), e);
        }
    }
}
