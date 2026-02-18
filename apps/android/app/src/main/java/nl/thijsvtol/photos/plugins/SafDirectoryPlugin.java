package nl.thijsvtol.photos.plugins;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * Native Capacitor plugin that lists files in a directory selected via
 * Android's Storage Access Framework (SAF).
 *
 * Capacitor's Filesystem.readdir() uses java.io.File.listFiles() which
 * returns null on Android 11+ scoped storage. This plugin uses
 * DocumentsContract + ContentResolver to properly enumerate SAF tree URIs.
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
            Uri treeUri = Uri.parse(treeUriString);
            String docId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);

            ContentResolver resolver = getContext().getContentResolver();

            // Take persistable permission so the URI survives app restarts
            try {
                resolver.takePersistableUriPermission(treeUri,
                        android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException e) {
                // Non-fatal: permission may already be taken or not persistable
            }

            String[] projection = new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED
            };

            JSArray filesArray = new JSArray();

            Cursor cursor = resolver.query(childrenUri, projection, null, null, null);
            if (cursor != null) {
                try {
                    int idCol = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                    int nameCol = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                    int mimeCol = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE);
                    int sizeCol = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE);
                    int mtimeCol = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_LAST_MODIFIED);

                    while (cursor.moveToNext()) {
                        String childDocId = cursor.getString(idCol);
                        String name = cursor.getString(nameCol);
                        String mimeType = cursor.getString(mimeCol);
                        
                        // Handle null values safely
                        if (name == null || name.isEmpty()) {
                            continue;
                        }
                        
                        long size = cursor.isNull(sizeCol) ? 0 : cursor.getLong(sizeCol);
                        long mtime = cursor.isNull(mtimeCol) ? System.currentTimeMillis() : cursor.getLong(mtimeCol);

                        // Skip directories (mime type is vnd.android.document/directory)
                        if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)) {
                            continue;
                        }

                        // Build a content:// URI for this specific file
                        Uri fileUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocId);

                        JSObject fileObj = new JSObject();
                        fileObj.put("name", name);
                        fileObj.put("uri", fileUri.toString());
                        fileObj.put("mimeType", mimeType != null ? mimeType : "application/octet-stream");
                        fileObj.put("size", size);
                        fileObj.put("mtime", mtime);

                        filesArray.put(fileObj);
                    }
                } finally {
                    cursor.close();
                }
            }

            JSObject result = new JSObject();
            result.put("files", filesArray);
            call.resolve(result);

        } catch (Exception e) {
            call.reject("Failed to list directory: " + e.getMessage(), e);
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
