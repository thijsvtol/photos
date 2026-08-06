package nl.thijsvtol.photos.sync;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Handles the "Pause sync" action on the folder-sync progress notification.
 *
 * Turning sync off from the notification matters because a background run can
 * start at any time — including on cellular right before the user boards a
 * plane. Without this the only way to stop an in-flight batch is to force-stop
 * the app.
 *
 * Pausing flips the persisted enabled flag (so the periodic job stops
 * re-enqueuing itself) and cancels any in-flight work. The user re-enables it
 * from the folder sync settings in the app.
 */
public class SyncActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !SyncNotifier.ACTION_PAUSE_SYNC.equals(intent.getAction())) return;

        Context app = context.getApplicationContext();
        new SyncConfig(app).setEnabled(false);
        SyncScheduler.cancelAll(app);

        SyncNotifier notifier = new SyncNotifier(app);
        notifier.clearProgress();
    }
}
