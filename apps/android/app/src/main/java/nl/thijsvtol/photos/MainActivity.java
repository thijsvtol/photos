package nl.thijsvtol.photos;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.WebViewListener;
import nl.thijsvtol.photos.plugins.SafDirectoryPlugin;
import nl.thijsvtol.photos.plugins.ShareHandlerPlugin;
import nl.thijsvtol.photos.plugins.ProgressNotificationPlugin;
import nl.thijsvtol.photos.plugins.CastPlugin;
import nl.thijsvtol.photos.sync.FolderSyncPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The manifest sets this Activity's theme to AppTheme.NoActionBarLaunch
        // (parent: Theme.SplashScreen) purely so Android draws the splash
        // background instantly at cold start, before onCreate runs. That theme
        // is NOT an AppCompat theme, so it must be swapped back to the app's
        // real AppCompat-based theme here — BEFORE super.onCreate() — otherwise
        // ANY AppCompat-based native UI (e.g. androidx.mediarouter's
        // MediaRouteChooserDialog, used by CastPlugin.startDiscovery() for the
        // "Cast to" device picker) throws immediately with "You need to use a
        // Theme.AppCompat theme (or descendant) with this activity" and crashes
        // the app the instant the Cast button is tapped. This is the standard,
        // documented pattern for combining a splash-screen theme with a normal
        // AppCompat theme for the activity's actual runtime lifetime.
        setTheme(R.style.AppTheme);

        registerPlugin(SafDirectoryPlugin.class);
        registerPlugin(ShareHandlerPlugin.class);
        registerPlugin(ProgressNotificationPlugin.class);
        registerPlugin(CastPlugin.class);
        registerPlugin(FolderSyncPlugin.class);
        super.onCreate(savedInstanceState);
        
        registerRenderProcessRecovery();

        android.util.Log.d("MainActivity", "onCreate completed, handling intent immediately");

        // Handle initial share intent if app was launched via share
        handleIntent(getIntent());
    }

    /**
     * Survives a WebView renderer death instead of letting it kill the app.
     *
     * The WebView runs its renderer in a separate, sandboxed process. When that process dies —
     * almost always because Android reclaimed it under memory pressure — the platform asks the
     * app whether it handled the loss. Declining (the default) means Android kills the entire
     * app process, which is what produced this in logcat:
     *
     *   Render process (N) kill (OOM or update) wasn't handed by all associated webviews,
     *   killing application
     *   PROCESS ENDED for package nl.thijsvtol.photos
     *
     * The app simply vanished from the user's screen with no message. Returning true here
     * claims the event so the process survives, and reloading rebuilds the WebView's state
     * from scratch — a visible reload, but the app stays alive.
     *
     * This is a SAFETY NET, not the fix. The renderer was running out of memory because face
     * detection ran unbounded and on full-resolution images; that root cause is addressed in
     * apps/web/src/faceDetectionQueue.ts (one detection at a time) and faceDetection.ts (input
     * capped to DETECTION_MAX_DIMENSION). This stays because other paths can still spike memory
     * (video editing reads whole blobs into the renderer), and because "reload" beats "die".
     */
    private void registerRenderProcessRecovery() {
        // Same null-guard rationale as handleIntent(): the bridge is created by
        // super.onCreate(), but bail loudly rather than NPE if that ever changes.
        if (getBridge() == null) {
            android.util.Log.e("MainActivity", "registerRenderProcessRecovery: bridge is null, renderer crashes will kill the app");
            return;
        }

        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                // didCrash() false => the renderer was KILLED by the system (the OOM case we
                // expect); true => it crashed on its own. Logged so future reports say which.
                android.util.Log.e(
                    "MainActivity",
                    "WebView renderer process gone (didCrash=" + detail.didCrash() + "), reloading instead of dying"
                );

                if (webView != null) {
                    webView.reload();
                }
                return true; // handled — do not kill the app process
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        
        // Handle share intent when app is already running
        handleIntent(intent);
    }

    /**
     * Process incoming intents for share actions.
     * Delegates to ShareHandlerPlugin if this is a share intent.
     */
    private void handleIntent(Intent intent) {
        if (intent == null) {
            return;
        }

        String action = intent.getAction();
        String type = intent.getType();

        // Check if this is a share intent
        if ((Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) 
                && type != null 
                && (type.startsWith("image/") || type.startsWith("video/"))) {

            // Find ShareHandlerPlugin and delegate intent processing. Guard every
            // step — if the bridge isn't ready yet, or the plugin somehow wasn't
            // registered/instantiated, getPlugin()/getInstance() can return null,
            // and calling a method on that null silently crashes with an NPE
            // (swallowing the share with no visible error to the user).
            if (getBridge() == null) {
                android.util.Log.e("MainActivity", "handleIntent: bridge is null, cannot deliver share intent");
                return;
            }
            com.getcapacitor.PluginHandle pluginHandle = getBridge().getPlugin("ShareHandler");
            if (pluginHandle == null) {
                android.util.Log.e("MainActivity", "handleIntent: ShareHandler plugin handle not found");
                return;
            }
            Plugin sharePlugin = pluginHandle.getInstance();
            if (sharePlugin instanceof ShareHandlerPlugin) {
                ((ShareHandlerPlugin) sharePlugin).handleShareIntent(intent);
            } else {
                android.util.Log.e("MainActivity", "handleIntent: ShareHandler plugin instance missing or wrong type");
            }
        }
    }
}
