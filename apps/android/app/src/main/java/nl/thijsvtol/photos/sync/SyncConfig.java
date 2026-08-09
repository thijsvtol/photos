package nl.thijsvtol.photos.sync;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Configuration shared between the JS layer and the native sync engine.
 *
 * Written by FolderSyncPlugin.configure() (called from folderSync.ts and from
 * MobileAuthService whenever the auth token changes) and read by
 * {@link FolderSyncWorker}, which runs with no WebView alive and therefore
 * cannot ask JS for any of this.
 *
 * The auth token is read from the SAME SharedPreferences file
 * (@capacitor/preferences' "CapacitorStorage") that MobileAuthService already
 * writes to, rather than being duplicated into a second store — so the native
 * engine can never drift out of sync with the token the app is using. Mobile
 * tokens last 30 days (see apps/worker/src/routes/mobileAuth.ts); when one
 * expires the worker stops and notifies rather than hammering a dead token.
 */
public class SyncConfig {

    /** The prefs file @capacitor/preferences writes to. */
    private static final String CAPACITOR_PREFS = "CapacitorStorage";
    /** Key used by MobileAuthService.storeToken() — value is JSON {token, expiresAt}. */
    private static final String CAP_KEY_AUTH_TOKEN = "auth_token";

    /** Our own prefs file, for settings that have no JS-side equivalent. */
    private static final String SYNC_PREFS = "folder_sync";
    private static final String KEY_API_BASE_URL = "apiBaseUrl";
    private static final String KEY_FOLDERS = "folders";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_WIFI_ONLY = "wifiOnly";
    private static final String KEY_BATTERY_NOT_LOW = "batteryNotLow";
    private static final String KEY_INTERVAL_MINUTES = "intervalMinutes";
    private static final String KEY_LAST_RUN_AT = "lastRunAt";
    private static final String KEY_LAST_ERROR = "lastError";
    private static final String KEY_RUNNING = "running";
    /** Prefixed per tree URI — see getScanWatermark(). */
    private static final String KEY_SCAN_WATERMARK_PREFIX = "scanMtime:";

    public static final long DEFAULT_INTERVAL_MINUTES = 60L;
    /** WorkManager refuses periodic intervals below 15 minutes. */
    public static final long MIN_INTERVAL_MINUTES = 15L;

    private final SharedPreferences prefs;
    private final SharedPreferences capacitorPrefs;

    public SyncConfig(Context context) {
        Context app = context.getApplicationContext();
        this.prefs = app.getSharedPreferences(SYNC_PREFS, Context.MODE_PRIVATE);
        this.capacitorPrefs = app.getSharedPreferences(CAPACITOR_PREFS, Context.MODE_PRIVATE);
    }

    /** One configured folder → event mapping. */
    public static class Folder {
        public final String treeUri;
        public final String eventSlug;
        public final boolean enabled;

        public Folder(String treeUri, String eventSlug, boolean enabled) {
            this.treeUri = treeUri;
            this.eventSlug = eventSlug;
            this.enabled = enabled;
        }
    }

    // ── auth ──

    /**
     * The bearer token, or null when absent or expired. Mirrors the expiry
     * check in MobileAuthService.getToken() so the native engine never sends a
     * token the JS layer would already have discarded.
     */
    public String getAuthToken() {
        String raw = capacitorPrefs.getString(CAP_KEY_AUTH_TOKEN, null);
        if (raw == null || raw.isEmpty()) return null;
        try {
            JSONObject json = new JSONObject(raw);
            long expiresAt = json.optLong("expiresAt", 0L);
            if (expiresAt > 0 && expiresAt < System.currentTimeMillis()) return null;
            String token = json.optString("token", null);
            return (token == null || token.isEmpty()) ? null : token;
        } catch (JSONException e) {
            return null;
        }
    }

    // ── settings ──

    public String getApiBaseUrl() {
        return prefs.getString(KEY_API_BASE_URL, null);
    }

    public void setApiBaseUrl(String url) {
        prefs.edit().putString(KEY_API_BASE_URL, url).apply();
    }

    public boolean isEnabled() {
        return prefs.getBoolean(KEY_ENABLED, true);
    }

    public void setEnabled(boolean enabled) {
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    /** Default on: a full camera roll over cellular is an expensive surprise. */
    public boolean isWifiOnly() {
        return prefs.getBoolean(KEY_WIFI_ONLY, true);
    }

    public void setWifiOnly(boolean wifiOnly) {
        prefs.edit().putBoolean(KEY_WIFI_ONLY, wifiOnly).apply();
    }

    /** Default on: draining the battery on a big backlog is equally unwelcome. */
    public boolean isBatteryNotLow() {
        return prefs.getBoolean(KEY_BATTERY_NOT_LOW, true);
    }

    public void setBatteryNotLow(boolean batteryNotLow) {
        prefs.edit().putBoolean(KEY_BATTERY_NOT_LOW, batteryNotLow).apply();
    }

    public long getIntervalMinutes() {
        return Math.max(MIN_INTERVAL_MINUTES, prefs.getLong(KEY_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES));
    }

    public void setIntervalMinutes(long minutes) {
        prefs.edit().putLong(KEY_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, minutes)).apply();
    }

    // ── folders ──

    public List<Folder> getFolders() {
        List<Folder> out = new ArrayList<>();
        String raw = prefs.getString(KEY_FOLDERS, null);
        if (raw == null || raw.isEmpty()) return out;
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String treeUri = o.optString("treeUri", null);
                String eventSlug = o.optString("eventSlug", null);
                if (treeUri == null || treeUri.isEmpty() || eventSlug == null || eventSlug.isEmpty()) continue;
                out.add(new Folder(treeUri, eventSlug, o.optBoolean("enabled", true)));
            }
        } catch (JSONException e) {
            // A corrupt folder list must not wedge the worker — treat it as empty
            // and let the next configure() call from JS repair it.
        }
        return out;
    }

    public void setFolders(JSONArray folders) {
        prefs.edit().putString(KEY_FOLDERS, folders == null ? "[]" : folders.toString()).apply();
    }

    /** Only folders the user has left switched on. */
    public List<Folder> getEnabledFolders() {
        List<Folder> out = new ArrayList<>();
        for (Folder f : getFolders()) {
            if (f.enabled) out.add(f);
        }
        return out;
    }

    // ── per-folder scan watermark ──

    /**
     * Highest file mtime seen by a completed scan of this folder, used as
     * SafScanner's `sinceMtime` floor so a run with a backlog doesn't spend its
     * budget re-walking thousands of already-known files.
     *
     * Stored under its own key per tree URI rather than inside the `folders` JSON,
     * because that JSON is a contract shared with the JS bridge (see
     * FolderSyncPlugin.configure) and this is purely an internal optimisation.
     *
     * Returns 0 (scan everything) when unset. Callers must NOT treat this as a
     * correctness mechanism — see FolderSyncWorker.scanFolder for why a full scan
     * still happens whenever the queue is drained.
     */
    public long getScanWatermark(String treeUri) {
        return prefs.getLong(KEY_SCAN_WATERMARK_PREFIX + treeUri, 0L);
    }

    public void setScanWatermark(String treeUri, long mtime) {
        prefs.edit().putLong(KEY_SCAN_WATERMARK_PREFIX + treeUri, mtime).apply();
    }

    // ── run status (surfaced by FolderSyncPlugin.getStatus()) ──

    public long getLastRunAt() {
        return prefs.getLong(KEY_LAST_RUN_AT, 0L);
    }

    public void setLastRunAt(long at) {
        prefs.edit().putLong(KEY_LAST_RUN_AT, at).apply();
    }

    public String getLastError() {
        return prefs.getString(KEY_LAST_ERROR, null);
    }

    public void setLastError(String error) {
        if (error == null) {
            prefs.edit().remove(KEY_LAST_ERROR).apply();
        } else {
            prefs.edit().putString(KEY_LAST_ERROR, error).apply();
        }
    }

    public boolean isRunning() {
        return prefs.getBoolean(KEY_RUNNING, false);
    }

    public void setRunning(boolean running) {
        prefs.edit().putBoolean(KEY_RUNNING, running).apply();
    }
}
