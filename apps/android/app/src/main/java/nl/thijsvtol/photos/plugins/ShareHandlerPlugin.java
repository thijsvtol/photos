package nl.thijsvtol.photos.plugins;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Native Capacitor plugin that handles shared images/videos from other apps.
 * 
 * When users share media from gallery or other apps, this plugin:
 * - Receives ACTION_SEND or ACTION_SEND_MULTIPLE intents
 * - Extracts file URIs and metadata
 * - Copies files to app cache directory (content:// URIs may expire)
 * - Emits 'shareReceived' event to JavaScript layer
 */
@CapacitorPlugin(name = "ShareHandler")
public class ShareHandlerPlugin extends Plugin {
    
    private JSObject pendingShareData = null;

    /**
     * Debug logging method that can be called from JavaScript.
     * Outputs logs to Android's Log system visible in logcat.
     */
    @com.getcapacitor.PluginMethod()
    public void debugLog(com.getcapacitor.PluginCall call) {
        String message = call.getString("message", "");
        android.util.Log.d("ShareHandlerJS", message);
        call.resolve();
    }

    /**
     * Check if there's a pending share intent that was received before JS loaded.
     * JavaScript should call this on startup to retrieve any buffered share data.
     */
    @com.getcapacitor.PluginMethod()
    public void checkPendingShare(com.getcapacitor.PluginCall call) {
        android.util.Log.d("ShareHandlerPlugin", "checkPendingShare called from JS");
        if (pendingShareData != null) {
            android.util.Log.d("ShareHandlerPlugin", "Found buffered share data, returning to JS");
            call.resolve(pendingShareData);
            pendingShareData = null; // Clear after delivering
        } else {
            android.util.Log.d("ShareHandlerPlugin", "No buffered share data");
            JSObject result = new JSObject();
            result.put("hasPending", false);
            call.resolve(result);
        }
    }

    /**
     * Process an incoming share intent from another app.
     * Called by MainActivity when ACTION_SEND or ACTION_SEND_MULTIPLE is received.
     */
    public void handleShareIntent(Intent intent) {
        if (intent == null) {
            return;
        }

        String action = intent.getAction();
        String type = intent.getType();

        if (type == null) {
            return;
        }

        List<Uri> sharedUris = new ArrayList<>();

        // Handle single file share (ACTION_SEND)
        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) {
                sharedUris.add(uri);
            }
        }
        // Handle multiple files share (ACTION_SEND_MULTIPLE)
        else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ClipData clipData = intent.getClipData();
            if (clipData != null) {
                for (int i = 0; i < clipData.getItemCount(); i++) {
                    Uri uri = clipData.getItemAt(i).getUri();
                    if (uri != null) {
                        sharedUris.add(uri);
                    }
                }
            }
        }

        if (sharedUris.isEmpty()) {
            return;
        }

        // Process files on background thread to avoid blocking UI
        bridge.execute(() -> {
            try {
                JSArray filesArray = processSharedFiles(sharedUris);
                
                // Prepare result object
                JSObject result = new JSObject();
                result.put("files", filesArray);
                result.put("hasPending", true);
                
                // Try to emit event to JavaScript layer
                // If no listeners are registered yet, buffer the data
                if (hasListeners("shareReceived")) {
                    notifyListeners("shareReceived", result);
                } else {
                    // Buffer for later retrieval when JS is ready
                    android.util.Log.d("ShareHandlerPlugin", "No listeners yet, buffering share data");
                    pendingShareData = result;
                }
                
            } catch (Exception e) {
                JSObject error = new JSObject();
                error.put("error", "Failed to process shared files: " + e.getMessage());
                notifyListeners("shareError", error);
            }
        });
    }

    /**
     * Process list of shared URIs, copy files to cache, and extract metadata.
     */
    private JSArray processSharedFiles(List<Uri> uris) throws Exception {
        JSArray filesArray = new JSArray();
        ContentResolver resolver = getContext().getContentResolver();
        File cacheDir = new File(getContext().getCacheDir(), "shared");
        
        // Ensure cache directory exists
        if (!cacheDir.exists()) {
            cacheDir.mkdirs();
        }

        for (Uri uri : uris) {
            try {
                // Query file metadata
                String filename = null;
                String mimeType = resolver.getType(uri);
                long fileSize = 0;

                Cursor cursor = resolver.query(uri, null, null, null, null);
                if (cursor != null) {
                    try {
                        if (cursor.moveToFirst()) {
                            int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                            int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                            
                            if (nameIndex != -1) {
                                filename = cursor.getString(nameIndex);
                            }
                            if (sizeIndex != -1 && !cursor.isNull(sizeIndex)) {
                                fileSize = cursor.getLong(sizeIndex);
                            }
                        }
                    } finally {
                        cursor.close();
                    }
                }

                // Generate filename if not available
                if (filename == null || filename.isEmpty()) {
                    String extension = "";
                    if (mimeType != null) {
                        extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType);
                        if (extension != null && !extension.isEmpty()) {
                            extension = "." + extension;
                        }
                    }
                    filename = "shared_" + System.currentTimeMillis() + extension;
                }

                // Copy file to cache directory (content:// URIs may expire after intent completes)
                File cachedFile = new File(cacheDir, filename);
                
                // If file exists, append timestamp to avoid collision
                if (cachedFile.exists()) {
                    String nameWithoutExt = filename;
                    String ext = "";
                    int dotIndex = filename.lastIndexOf('.');
                    if (dotIndex > 0) {
                        nameWithoutExt = filename.substring(0, dotIndex);
                        ext = filename.substring(dotIndex);
                    }
                    cachedFile = new File(cacheDir, nameWithoutExt + "_" + System.currentTimeMillis() + ext);
                }

                // Copy file data
                InputStream inputStream = resolver.openInputStream(uri);
                if (inputStream == null) {
                    continue;
                }

                try {
                    FileOutputStream outputStream = new FileOutputStream(cachedFile);
                    try {
                        byte[] buffer = new byte[8192];
                        int bytesRead;
                        while ((bytesRead = inputStream.read(buffer)) != -1) {
                            outputStream.write(buffer, 0, bytesRead);
                        }
                        outputStream.flush();
                    } finally {
                        outputStream.close();
                    }
                } finally {
                    inputStream.close();
                }

                // Build file info object
                JSObject fileInfo = new JSObject();
                fileInfo.put("name", filename);
                fileInfo.put("path", cachedFile.getAbsolutePath());
                fileInfo.put("uri", "file://" + cachedFile.getAbsolutePath());
                fileInfo.put("mimeType", mimeType != null ? mimeType : "application/octet-stream");
                fileInfo.put("size", cachedFile.length());
                
                filesArray.put(fileInfo);
                
            } catch (Exception e) {
                // Log error but continue processing other files
                android.util.Log.e("ShareHandlerPlugin", "Error processing file: " + e.getMessage(), e);
            }
        }

        return filesArray;
    }

    /**
     * Clean up cached shared files to free disk space.
     * Can be called from JavaScript after uploads complete.
     */
    @com.getcapacitor.PluginMethod()
    public void clearSharedCache(com.getcapacitor.PluginCall call) {
        try {
            File cacheDir = new File(getContext().getCacheDir(), "shared");
            if (cacheDir.exists() && cacheDir.isDirectory()) {
                File[] files = cacheDir.listFiles();
                if (files != null) {
                    int deletedCount = 0;
                    for (File file : files) {
                        if (file.delete()) {
                            deletedCount++;
                        }
                    }
                    JSObject result = new JSObject();
                    result.put("deletedCount", deletedCount);
                    call.resolve(result);
                    return;
                }
            }
            
            JSObject result = new JSObject();
            result.put("deletedCount", 0);
            call.resolve(result);
            
        } catch (Exception e) {
            call.reject("Failed to clear cache: " + e.getMessage(), e);
        }
    }
}
