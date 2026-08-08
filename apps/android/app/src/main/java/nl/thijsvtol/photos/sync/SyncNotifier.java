package nl.thijsvtol.photos.sync;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.work.ForegroundInfo;

import nl.thijsvtol.photos.MainActivity;
import nl.thijsvtol.photos.R;

/**
 * Every notification the native folder-sync engine shows.
 *
 * Kept separate from {@link FolderSyncWorker} so the worker's control flow
 * isn't interleaved with notification building, and so update throttling lives
 * in exactly one place.
 *
 * Uses the same "upload_progress" channel as ProgressNotificationPlugin (so the
 * user has one place to mute upload noise), but a FIXED, dedicated notification
 * id — the JS manual-upload path picks a random id per batch, so sharing an id
 * would have the two paths overwriting each other's progress whenever a manual
 * upload happened during a background sync.
 */
public class SyncNotifier {

    private static final String CHANNEL_ID = "upload_progress";
    private static final String CHANNEL_NAME = "Upload Progress";

    /** Ongoing progress notification (also the foreground-service notification). */
    public static final int PROGRESS_NOTIFICATION_ID = 999999100;
    /** Dismissible end-of-run summary. Distinct id so it doesn't replace a new run's progress. */
    public static final int SUMMARY_NOTIFICATION_ID = 999999101;

    /** Progress updates are coalesced to at most one per this interval. */
    private static final long UPDATE_THROTTLE_MS = 1000L;

    /** Stops the run in flight, leaving the schedule and all settings alone. */
    public static final String ACTION_STOP_SYNC = "nl.thijsvtol.photos.action.STOP_SYNC";

    private final Context context;
    private final NotificationManager manager;
    private long lastUpdateAt = 0L;

    public SyncNotifier(Context context) {
        this.context = context.getApplicationContext();
        this.manager = (NotificationManager) this.context.getSystemService(Context.NOTIFICATION_SERVICE);
        ensureChannel();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows progress of photo uploads");
            manager.createNotificationChannel(channel);
        }
    }

    private PendingIntent contentIntent(String eventSlug) {
        Intent intent = new Intent(context, MainActivity.class);
        if (eventSlug != null) {
            // Same extras contract as ProgressNotificationPlugin, which
            // main.tsx's localNotificationActionPerformed listener handles.
            intent.putExtra("eventSlug", eventSlug);
            intent.putExtra("action", "view_event");
        }
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            context, PROGRESS_NOTIFICATION_ID, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private PendingIntent actionIntent(String action, int requestCode) {
        Intent intent = new Intent(context, SyncActionReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    /**
     * Base progress notification.
     *
     * "Stop" is the only action, and it ends the current run without changing
     * any setting. That satisfies the Play requirement that the user can
     * terminate the work, and it's the action a user actually wants from a
     * progress notification.
     *
     * There is deliberately NO "Turn off" action here. It was one tap away
     * from silently disabling background sync entirely, which is far more
     * destructive than a progress notification's buttons should be — a user
     * reaching for "make this stop" would disable the feature and then have to
     * discover the toggle buried in event settings to get it back. Permanently
     * disabling sync belongs in the app's sync settings, where it is labelled
     * and reversible in place.
     *
     * setOngoing(true) only while this run holds a foreground service — an
     * ordinary background run's notification must stay dismissible, since a
     * non-dismissible notification for work the user didn't start is the exact
     * pattern the policy is written against.
     *
     * setLocalOnly(true) keeps progress off paired wearables. A progress bar
     * refreshed once a second is bridged to a watch as a stream of separate
     * notifications, which buzzes the user's wrist continuously for the whole
     * upload. setOnlyAlertOnce() does not prevent this — it only suppresses
     * re-alerting on the phone.
     */
    private NotificationCompat.Builder progressBuilder(String title, String text, boolean ongoing) {
        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(ongoing)
            .setOnlyAlertOnce(true)
            .setLocalOnly(true)
            .setSilent(true)
            .setContentIntent(contentIntent(null))
            .addAction(0, "Stop", actionIntent(ACTION_STOP_SYNC, 1));
    }

    /**
     * The initial foreground notification. WorkManager requires this before the
     * job may run as a long-running foreground service, which is what stops
     * Android from throttling network access or killing the process partway
     * through a large batch.
     */
    public ForegroundInfo initialForegroundInfo() {
        NotificationCompat.Builder builder =
            progressBuilder("Uploading photos to your library", "Checking folders for new photos…", true)
                .setProgress(0, 0, true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return new ForegroundInfo(
                PROGRESS_NOTIFICATION_ID, builder.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            );
        }
        return new ForegroundInfo(PROGRESS_NOTIFICATION_ID, builder.build());
    }

    /**
     * Whether the current run holds a foreground service. Controls only
     * whether the progress notification is ongoing (non-dismissible) — the
     * notification itself is shown either way, so a scheduled run is just as
     * visible to the user as one they started.
     */
    private boolean foreground = false;

    public void setForeground(boolean foreground) {
        this.foreground = foreground;
    }

    /**
     * Indeterminate "scanning" state, shown before the total count is known.
     *
     * Suppressed on scheduled runs: those happen every hour and usually find
     * nothing, so posting and then immediately clearing a notification each
     * time would be pure noise. Once a scheduled run has actual files to
     * upload it does show progress, via showUploadProgress().
     */
    public void showScanning(String detail) {
        if (!foreground) return;
        notifyProgress(
            progressBuilder(
                "Uploading photos to your library",
                detail != null ? detail : "Checking folders for new photos…",
                true
            ).setProgress(0, 0, true),
            true
        );
    }

    /**
     * Determinate upload progress.
     *
     * @param filePercent per-file percentage, shown in the expanded view so a
     *                    single large video doesn't look stuck at "3 of 40".
     * @param force       bypass throttling (used for the first and last update)
     */
    public void showUploadProgress(
        int done, int total, String folderLabel, String filename, int filePercent,
        String eventSlug, boolean force
    ) {
        String title = "Uploading photos to your library";
        String text = "Photo " + (done + 1) + " of " + total
            + (folderLabel != null ? " • " + folderLabel : "");
        NotificationCompat.Builder builder = progressBuilder(title, text, foreground)
            .setProgress(Math.max(total, 1), done, false)
            .setContentIntent(contentIntent(eventSlug));

        if (filename != null) {
            builder.setStyle(new NotificationCompat.BigTextStyle()
                .setBigContentTitle(title)
                .bigText(filename + (filePercent >= 0 ? " (" + filePercent + "%)" : "")));
        }

        notifyProgress(builder, force);
    }

    private void notifyProgress(NotificationCompat.Builder builder, boolean force) {
        long now = System.currentTimeMillis();
        // Without this the old JS path issued a notification update on every
        // uploaded chunk — thousands of them across a large batch.
        if (!force && now - lastUpdateAt < UPDATE_THROTTLE_MS) return;
        lastUpdateAt = now;
        if (manager != null) manager.notify(PROGRESS_NOTIFICATION_ID, builder.build());
    }

    public void clearProgress() {
        if (manager != null) manager.cancel(PROGRESS_NOTIFICATION_ID);
    }

    // ── terminal notifications ──

    private void showSummary(String title, String body, String eventSlug) {
        if (manager == null) return;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(false)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(contentIntent(eventSlug));
        manager.notify(SUMMARY_NOTIFICATION_ID, builder.build());
    }

    /**
     * End-of-run result.
     *
     * Deliberately quiet. A background sync runs every hour, so anything shown
     * here is shown repeatedly — it must be worth interrupting the user for.
     * Only two things are:
     *
     *  - photos actually got uploaded, and
     *  - a file was given up on and needs the user to decide.
     *
     * Everything else stays silent: a run that found nothing, a run that was
     * stopped, and transient failures that will simply be retried. Reporting
     * those is how "✗ Folder sync failed — 1 photo failed" ended up firing on
     * essentially every run.
     */
    public void showRunSummary(
        int uploaded, int duplicates, int failed, int quarantined, boolean stopped, String eventSlug
    ) {
        if (stopped && quarantined == 0) return;
        if (uploaded == 0 && quarantined == 0) return;

        String title;
        StringBuilder body = new StringBuilder();

        if (quarantined == 0) {
            title = "✓ Photos uploaded";
            body.append(uploaded).append(uploaded == 1 ? " photo uploaded" : " photos uploaded");
            if (duplicates > 0) {
                body.append(" · ").append(duplicates).append(" already synced");
            }
        } else {
            title = uploaded > 0 ? "Some photos couldn't be uploaded" : "Photos couldn't be uploaded";
            if (uploaded > 0) {
                body.append(uploaded).append(" uploaded. ");
            }
            body.append(quarantined)
                .append(quarantined == 1 ? " file was skipped after repeated failures" : " files were skipped after repeated failures")
                .append(" — open the app to see why and retry.");
        }

        showSummary(title, body.toString(), eventSlug);
    }

    /**
     * The mobile token lasts 30 days and has no refresh flow, so when it
     * expires the only fix is the user reopening the app. Say so, rather than
     * silently failing every hour.
     */
    public void showAuthExpired() {
        showSummary(
            "Sign in to continue syncing",
            "Your session expired, so folder sync is paused. Open the app to sign in again.",
            null
        );
    }
}
