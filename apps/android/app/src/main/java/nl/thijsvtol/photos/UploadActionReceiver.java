package nl.thijsvtol.photos;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * Handles "Cancel uploads" on the manual/share upload progress notification.
 *
 * The uploads themselves run in the WebView (see
 * apps/web/src/services/backgroundSync.ts), which may not even be alive when
 * this fires, so the cancel is recorded as a flag rather than delivered
 * directly. The JS upload loop checks it between files and between chunk
 * batches via ProgressNotification.consumeCancelRequest() and stops cleanly,
 * leaving each item's multipart resume state intact so a later retry continues
 * instead of restarting.
 *
 * Stopping the foreground service here as well means the notification goes away
 * immediately, rather than lingering until the JS side notices — the user asked
 * for it to stop, so it must visibly stop.
 */
public class UploadActionReceiver extends BroadcastReceiver {

    public static final String ACTION_CANCEL_UPLOADS = "nl.thijsvtol.photos.action.CANCEL_UPLOADS";

    private static final String PREFS = "upload_control";
    private static final String KEY_CANCEL_REQUESTED = "cancelRequested";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_CANCEL_UPLOADS.equals(intent.getAction())) return;

        Context app = context.getApplicationContext();
        setCancelRequested(app, true);
        app.stopService(new Intent(app, UploadForegroundService.class));
    }

    public static void setCancelRequested(Context context, boolean requested) {
        prefs(context).edit().putBoolean(KEY_CANCEL_REQUESTED, requested).apply();
    }

    /** Reads and clears the flag, so one tap cancels one batch. */
    public static boolean consumeCancelRequest(Context context) {
        SharedPreferences prefs = prefs(context);
        boolean requested = prefs.getBoolean(KEY_CANCEL_REQUESTED, false);
        if (requested) prefs.edit().putBoolean(KEY_CANCEL_REQUESTED, false).apply();
        return requested;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
