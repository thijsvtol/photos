package nl.thijsvtol.photos.sync;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Handles "Stop" on the folder-sync progress notification.
 *
 * This exists so the user can always terminate sync from where they see it
 * happening, which Google Play's foreground-service policy requires
 * ("Can be terminated or stopped by the user") — and which is simply correct
 * behaviour regardless: a background run can start at any time, including on
 * cellular right before the user boards a plane.
 *
 * Stopping cancels the run in flight and changes NO settings, so sync resumes
 * on its normal schedule. Partly-uploaded files keep their resume state in the
 * ledger, and the worker returns the in-flight file to the queue without
 * consuming a retry, so a later run continues rather than restarting them.
 *
 * There is intentionally no "disable sync entirely" action here — that lives in
 * the app's sync settings, where it's labelled and reversible in place.
 */
public class SyncActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !SyncNotifier.ACTION_STOP_SYNC.equals(intent.getAction())) return;

        Context app = context.getApplicationContext();
        SyncScheduler.stopCurrentRun(app);
        new SyncNotifier(app).clearProgress();
    }
}
