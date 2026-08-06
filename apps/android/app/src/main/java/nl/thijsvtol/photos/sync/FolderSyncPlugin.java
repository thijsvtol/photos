package nl.thijsvtol.photos.sync;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * JS bridge to the native folder-sync engine.
 *
 * The engine itself runs in a WorkManager job with no WebView alive, so this
 * plugin is purely for configuration, status, and the handful of handoffs that
 * genuinely need the web layer (face detection, which requires the WASM model
 * that only exists in the WebView).
 *
 * See apps/web/src/services/folderSync.ts for the TypeScript side.
 */
@CapacitorPlugin(name = "FolderSync")
public class FolderSyncPlugin extends Plugin {

    private static final int MAX_FACE_JOBS_PER_DRAIN = 50;
    private static final int MAX_FAILED_ENTRIES = 100;

    private SyncConfig config() {
        return new SyncConfig(getContext());
    }

    private SyncLedger ledger() {
        return new SyncLedger(getContext());
    }

    /**
     * Persists configuration and (re)schedules the periodic job.
     *
     * Called from folderSync.ts whenever folders change, and from
     * MobileAuthService whenever the auth token changes — the worker reads the
     * token straight out of Capacitor Preferences, but it needs the API base
     * URL, which only the web layer knows (it comes from the build-time
     * VITE_API_URL / runtime __CONFIG__).
     */
    @PluginMethod
    public void configure(PluginCall call) {
        SyncConfig config = config();

        String apiBaseUrl = call.getString("apiBaseUrl");
        if (apiBaseUrl != null && !apiBaseUrl.isEmpty()) {
            config.setApiBaseUrl(apiBaseUrl);
        }

        // JSArray extends JSONArray, so this is stored verbatim — no
        // round-trip through toList(), which throws on non-primitive entries.
        JSArray folders = call.getArray("folders");
        if (folders != null) {
            config.setFolders(folders);
        }

        if (call.hasOption("enabled")) {
            config.setEnabled(Boolean.TRUE.equals(call.getBoolean("enabled", true)));
        }
        if (call.hasOption("wifiOnly")) {
            config.setWifiOnly(Boolean.TRUE.equals(call.getBoolean("wifiOnly", true)));
        }
        if (call.hasOption("batteryNotLow")) {
            config.setBatteryNotLow(Boolean.TRUE.equals(call.getBoolean("batteryNotLow", true)));
        }
        if (call.hasOption("intervalMinutes")) {
            config.setIntervalMinutes(call.getInt("intervalMinutes", (int) SyncConfig.DEFAULT_INTERVAL_MINUTES));
        }

        SyncScheduler.reschedule(getContext());
        call.resolve();
    }

    /** Runs a scan now (app launch/resume, or the user tapping "Sync now"). */
    @PluginMethod
    public void syncNow(PluginCall call) {
        SyncScheduler.runNow(getContext());
        call.resolve();
    }

    /** Current settings plus live ledger counts, for the folder-sync UI. */
    @PluginMethod
    public void getStatus(PluginCall call) {
        SyncConfig config = config();
        SyncLedger ledger = ledger();
        String eventSlug = call.getString("eventSlug");

        JSObject result = new JSObject();
        result.put("enabled", config.isEnabled());
        result.put("wifiOnly", config.isWifiOnly());
        result.put("batteryNotLow", config.isBatteryNotLow());
        result.put("intervalMinutes", config.getIntervalMinutes());
        result.put("running", config.isRunning());
        result.put("lastRunAt", config.getLastRunAt());
        result.put("lastError", config.getLastError());
        result.put("hasAuthToken", config.getAuthToken() != null);

        int pending = ledger.countByState(SyncLedger.STATE_PENDING, eventSlug)
            + ledger.countByState(SyncLedger.STATE_HASHED, eventSlug)
            + ledger.countByState(SyncLedger.STATE_UPLOADING, eventSlug);
        result.put("pending", pending);
        result.put("uploaded", ledger.countByState(SyncLedger.STATE_UPLOADED, eventSlug));
        result.put("duplicates", ledger.countByState(SyncLedger.STATE_DUPLICATE, eventSlug));
        result.put("failed", ledger.countByState(SyncLedger.STATE_FAILED, eventSlug));

        // Files that exhausted their retries and need the user to decide.
        JSArray quarantined = new JSArray();
        for (SyncLedger.Entry entry : ledger.failedEntries(eventSlug, MAX_FAILED_ENTRIES)) {
            JSObject o = new JSObject();
            o.put("id", entry.id);
            o.put("name", entry.name);
            o.put("eventSlug", entry.eventSlug);
            o.put("error", entry.error);
            quarantined.put(o);
        }
        result.put("quarantined", quarantined);

        call.resolve(result);
    }

    /** Puts a quarantined file back in the queue (per-file "Retry" in the UI). */
    @PluginMethod
    public void retryFailed(PluginCall call) {
        Integer id = call.getInt("id");
        if (id == null) {
            call.reject("id is required");
            return;
        }
        ledger().resetRetries(id);
        SyncScheduler.runNow(getContext());
        call.resolve();
    }

    /**
     * Forgets sync history for a folder or event so everything in it is
     * re-uploaded. The escape hatch behind "Forget sync history" — the server
     * hash pre-check still suppresses anything that really is a duplicate.
     */
    @PluginMethod
    public void resetLedger(PluginCall call) {
        String treeUri = call.getString("treeUri");
        String eventSlug = call.getString("eventSlug");
        if (treeUri == null && eventSlug == null) {
            call.reject("treeUri or eventSlug is required");
            return;
        }
        int removed = ledger().forget(treeUri, eventSlug);
        JSObject result = new JSObject();
        result.put("removed", removed);
        call.resolve(result);
    }

    /**
     * Photos this engine uploaded that still need client-side face detection.
     *
     * Face embeddings are computed in the WebView (Workers AI has no
     * face-embedding model — see apps/web/src/faceDetection.ts), so natively
     * uploaded photos are parked in the ledger and drained by
     * faceDetectionQueue.ts the next time the app is open.
     */
    @PluginMethod
    public void takePendingFaceJobs(PluginCall call) {
        List<SyncLedger.Entry> jobs = ledger().pendingFaceJobs(MAX_FACE_JOBS_PER_DRAIN);

        JSArray arr = new JSArray();
        for (SyncLedger.Entry entry : jobs) {
            JSObject o = new JSObject();
            o.put("photoId", entry.photoId);
            o.put("eventSlug", entry.eventSlug);
            o.put("uri", entry.docUri);
            o.put("name", entry.name);
            arr.put(o);
        }

        JSObject result = new JSObject();
        result.put("jobs", arr);
        call.resolve(result);
    }

    @PluginMethod
    public void clearFaceJob(PluginCall call) {
        String photoId = call.getString("photoId");
        if (photoId == null) {
            call.reject("photoId is required");
            return;
        }
        ledger().clearFaceJob(photoId);
        call.resolve();
    }
}
