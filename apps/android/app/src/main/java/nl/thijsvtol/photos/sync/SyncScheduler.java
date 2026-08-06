package nl.thijsvtol.photos.sync;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

/**
 * Schedules the periodic folder scan.
 *
 * WorkManager (rather than the previous BackgroundTask.beforeExit approach) is
 * what makes sync actually run with the app closed: beforeExit is a one-shot
 * "give me a moment as I background" grant that was never re-registered, so it
 * fired at most once per launch and never at all once the app was swiped away.
 * WorkManager persists jobs across process death and re-registers them after a
 * reboot via its own boot receiver.
 *
 * Everything is enqueued under {@link #UNIQUE_WORK_NAME}. That uniqueness is
 * also the engine's re-entrancy guard: the old JS implementation could run two
 * scans concurrently (app-launch scan racing the background-sync init scan),
 * and because neither had written lastSyncTime yet, both queued the entire
 * folder — an immediate duplicate of every photo. Two runs of this worker
 * cannot overlap.
 */
public class SyncScheduler {

    public static final String UNIQUE_WORK_NAME = "folder-sync";
    /** Separate name for user-initiated runs so they aren't blocked by the periodic schedule. */
    public static final String ONE_TIME_WORK_NAME = "folder-sync-now";

    private SyncScheduler() {}

    private static Constraints constraintsFrom(SyncConfig config) {
        return new Constraints.Builder()
            // Wi-Fi-only is the default: syncing a full camera roll over
            // cellular is an expensive surprise. The user can switch it off.
            .setRequiredNetworkType(config.isWifiOnly() ? NetworkType.UNMETERED : NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(config.isBatteryNotLow())
            .build();
    }

    /**
     * (Re)schedules the periodic scan from current config, or cancels it when
     * sync is disabled / nothing is configured. Safe to call on every
     * configure() from JS — UPDATE replaces the existing schedule in place
     * rather than resetting its next-run clock unnecessarily.
     */
    public static void reschedule(Context context) {
        Context app = context.getApplicationContext();
        SyncConfig config = new SyncConfig(app);
        WorkManager wm = WorkManager.getInstance(app);

        if (!config.isEnabled() || config.getEnabledFolders().isEmpty()) {
            wm.cancelUniqueWork(UNIQUE_WORK_NAME);
            return;
        }

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            FolderSyncWorker.class, config.getIntervalMinutes(), TimeUnit.MINUTES
        )
            .setConstraints(constraintsFrom(config))
            .setBackoffCriteria(androidx.work.BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
            .addTag(UNIQUE_WORK_NAME)
            .build();

        wm.enqueueUniquePeriodicWork(UNIQUE_WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request);
    }

    /**
     * Runs a scan now (app launch/resume, or the user tapping "Sync now").
     *
     * KEEP, not REPLACE: if a run is already in flight, tapping again must let
     * it continue rather than cancelling and restarting it — restarting mid-way
     * through a large batch is exactly the kind of thrash that made the old
     * implementation never finish.
     */
    public static void runNow(Context context) {
        Context app = context.getApplicationContext();
        SyncConfig config = new SyncConfig(app);
        if (!config.isEnabled() || config.getEnabledFolders().isEmpty()) return;

        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(FolderSyncWorker.class)
            .setConstraints(constraintsFrom(config))
            .setBackoffCriteria(androidx.work.BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .addTag(UNIQUE_WORK_NAME)
            .build();

        WorkManager.getInstance(app)
            .enqueueUniqueWork(ONE_TIME_WORK_NAME, ExistingWorkPolicy.KEEP, request);
    }

    /**
     * Chains a follow-up run for a backlog that a single run couldn't finish.
     *
     * Each run is time-capped so the OS never kills it mid-batch (and so it
     * stays within Android 15's daily dataSync foreground-service budget); the
     * remaining work continues in the next run instead. APPEND so this queues
     * behind the current run rather than being dropped as a duplicate.
     */
    public static void enqueueContinuation(Context context) {
        Context app = context.getApplicationContext();
        SyncConfig config = new SyncConfig(app);
        if (!config.isEnabled()) return;

        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(FolderSyncWorker.class)
            .setConstraints(constraintsFrom(config))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .addTag(UNIQUE_WORK_NAME)
            .build();

        WorkManager.getInstance(app)
            .enqueueUniqueWork(ONE_TIME_WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request);
    }

    public static void cancelAll(Context context) {
        WorkManager wm = WorkManager.getInstance(context.getApplicationContext());
        wm.cancelUniqueWork(UNIQUE_WORK_NAME);
        wm.cancelUniqueWork(ONE_TIME_WORK_NAME);
    }
}
