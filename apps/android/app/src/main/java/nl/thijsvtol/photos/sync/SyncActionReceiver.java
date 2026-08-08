package nl.thijsvtol.photos.sync;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Handles the actions on the folder-sync progress notification.
 *
 * These exist so the user can always terminate sync from where they see it
 * happening, which Google Play's foreground-service policy requires
 * ("Can be terminated or stopped by the user") — and which is simply correct
 * behaviour regardless: a background run can start at any time, including on
 * cellular right before the user boards a plane.
 *
 * Two levels, because "stop this now" and "stop doing this at all" are
 * different intentions:
 *
 * - {@link SyncNotifier#ACTION_STOP_SYNC} cancels the run in flight and leaves
 *   the schedule alone. Partly-uploaded files keep their resume state in the
 *   ledger, so a later run continues rather than restarting them.
 * - {@link SyncNotifier#ACTION_PAUSE_SYNC} additionally disables background
 *   sync until the user switches it back on in the app's sync settings.
 */
public class SyncActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        Context app = context.getApplicationContext();
        String action = intent.getAction();

        if (SyncNotifier.ACTION_STOP_SYNC.equals(action)) {
            SyncScheduler.stopCurrentRun(app);
        } else if (SyncNotifier.ACTION_PAUSE_SYNC.equals(action)) {
            new SyncConfig(app).setEnabled(false);
            SyncScheduler.cancelAll(app);
        } else {
            return;
        }

        new SyncNotifier(app).clearProgress();
    }
}
