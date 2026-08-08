package nl.thijsvtol.photos.sync;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
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

    /**
     * Input flag telling {@link FolderSyncWorker} whether this run was asked
     * for by the user (tapping "Sync now", or adding a folder) or scheduled.
     *
     * ONLY a user-initiated run may promote itself to a foreground service.
     * Google Play's foreground-service policy requires FGS use to be initiated
     * by the user or genuinely user-perceptible, and holding a `dataSync`
     * foreground service on a timer is neither — it is exactly what got
     * version 49 rejected ("Functionality is not initiated by or perceptible
     * to the user"). Scheduled runs are deferrable work by definition, so they
     * run as an ordinary WorkManager job: no foreground service, no FGS
     * permission use, just a normal progress notification.
     */
    public static final String KEY_USER_INITIATED = "userInitiated";

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

        // Deliberately NOT expedited and carrying userInitiated = false, so
        // this never runs as a foreground service. Scheduled sync is
        // deferrable work: the OS may run it in a maintenance window, which is
        // both what the platform wants and what Play policy requires.
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            FolderSyncWorker.class, config.getIntervalMinutes(), TimeUnit.MINUTES
        )
            .setConstraints(constraintsFrom(config))
            .setInputData(inputData(false))
            .setBackoffCriteria(androidx.work.BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
            .addTag(UNIQUE_WORK_NAME)
            .build();

        wm.enqueueUniquePeriodicWork(UNIQUE_WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request);
    }

    private static Data inputData(boolean userInitiated) {
        return new Data.Builder().putBoolean(KEY_USER_INITIATED, userInitiated).build();
    }

    /**
     * Runs a scan the user explicitly asked for — tapping "Sync now", or
     * adding a folder. This is the ONLY path allowed to run as a foreground
     * service, because it's the only one the user actually initiated.
     *
     * KEEP, not REPLACE: if a run is already in flight, tapping again must let
     * it continue rather than cancelling and restarting it — restarting mid-way
     * through a large batch is exactly the kind of thrash that made the old
     * implementation never finish.
     */
    public static void runNow(Context context) {
        enqueueOneTime(context, true, ExistingWorkPolicy.KEEP);
    }

    /**
     * Runs a scan triggered by app launch/resume.
     *
     * Opening the app is a weaker signal than tapping a button, so this does
     * NOT take a foreground service — it just picks up new photos promptly
     * while the app is in use.
     */
    public static void runOnAppOpen(Context context) {
        enqueueOneTime(context, false, ExistingWorkPolicy.KEEP);
    }

    /**
     * Chains a follow-up run for a backlog that a single run couldn't finish.
     *
     * Each run is time-capped so the OS never kills it mid-batch; the remaining
     * work continues in the next run instead. APPEND so this queues behind the
     * current run rather than being dropped as a duplicate.
     *
     * Continuations are never user-initiated, even when the run that spawned
     * them was: the user's tap authorises the work they waited for, not an
     * open-ended chain of foreground services draining the rest of a
     * multi-thousand-photo backlog. The remaining files still upload, just as
     * deferrable work.
     */
    public static void enqueueContinuation(Context context) {
        enqueueOneTime(context, false, ExistingWorkPolicy.APPEND_OR_REPLACE);
    }

    private static void enqueueOneTime(Context context, boolean userInitiated, ExistingWorkPolicy policy) {
        Context app = context.getApplicationContext();
        SyncConfig config = new SyncConfig(app);
        if (!config.isEnabled() || config.getEnabledFolders().isEmpty()) return;

        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(FolderSyncWorker.class)
            .setConstraints(constraintsFrom(config))
            .setInputData(inputData(userInitiated))
            .setBackoffCriteria(androidx.work.BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .addTag(UNIQUE_WORK_NAME)
            .build();

        WorkManager.getInstance(app).enqueueUniqueWork(ONE_TIME_WORK_NAME, policy, request);
    }

    /** Stops the run currently in flight, leaving the schedule intact. */
    public static void stopCurrentRun(Context context) {
        WorkManager.getInstance(context.getApplicationContext()).cancelUniqueWork(ONE_TIME_WORK_NAME);
    }

    public static void cancelAll(Context context) {
        WorkManager wm = WorkManager.getInstance(context.getApplicationContext());
        wm.cancelUniqueWork(UNIQUE_WORK_NAME);
        wm.cancelUniqueWork(ONE_TIME_WORK_NAME);
    }
}
