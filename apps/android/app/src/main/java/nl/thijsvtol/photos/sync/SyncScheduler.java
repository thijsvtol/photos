package nl.thijsvtol.photos.sync;

import android.content.Context;
import android.util.Log;

import androidx.work.BackoffPolicy;
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

    /**
     * Backoff is LINEAR, never EXPONENTIAL.
     *
     * `run_attempt_count` climbs for reasons that are routine rather than
     * exceptional here — a transient DNS failure, or the OS force-stopping a
     * deferrable job that hit WorkManager's 10-minute limit (which counts as an
     * attempt no matter what Result the worker returned). Exponential backoff
     * turns a run of those into an outage: on 2026-08-08 a chain reached attempt
     * 10, i.e. 1min × 2⁹ = 512 minutes, clamped to WorkManager's 5-hour ceiling,
     * with three continuations stuck BLOCKED behind it. Sync was dead for the day.
     *
     * Linear keeps the same "back off when things are failing" property without
     * the cliff: attempt 10 waits 10 minutes, not 5 hours.
     *
     * NOTE: this only applies to WorkSpecs created from here on. An existing
     * unique work row keeps whatever policy it was built with until something
     * REPLACEs it — which is one reason runNow() always replaces. The one-time
     * chain ran on its original EXPONENTIAL policy for hours after this changed,
     * because every enqueue path used KEEP and so never rewrote the spec.
     */
    private static final BackoffPolicy BACKOFF_POLICY = BackoffPolicy.LINEAR;

    private SyncScheduler() {}

    /**
     * Deliberately carries NO network constraint. The Wi-Fi-only rule is enforced
     * inside the worker instead — see FolderSyncWorker.networkAllowsSync().
     *
     * A network constraint here is what made sync stall for hours at a time.
     * Android 14+ calls JobService.onNetworkChanged() whenever it re-evaluates the
     * network for a constrained job, WorkManager 2.10's SystemJobService does not
     * implement that callback, and the platform's fallback is to stop and
     * reschedule the job. On this device that fired ~15 times per logcat buffer,
     * chopping runs after 5-12 seconds each. Every stop increments
     * run_attempt_count, which grows the backoff (the periodic run reached attempt
     * 19 — three hours between attempts) and leaves continuations piling up
     * BLOCKED behind a head that will not run. Uploads crawled, then stopped.
     *
     * Removing the constraint removes the trigger entirely: no constraint means no
     * onNetworkChanged, no forced restarts, no attempt escalation.
     *
     * The cost is that WorkManager can no longer DEFER a run until Wi-Fi appears —
     * a run may now start on cellular, notice, and exit immediately. That costs a
     * few milliseconds of wake-up and nothing else, and the user-visible guarantee
     * is unchanged: nothing uploads over a metered connection.
     *
     * batteryNotLow stays: it has no equivalent callback problem, and deferring
     * until the battery recovers is genuinely what we want.
     */
    private static Constraints constraintsFrom(SyncConfig config) {
        return new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
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
            .setBackoffCriteria(BACKOFF_POLICY, 10, TimeUnit.MINUTES)
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
     * ALWAYS REPLACE. Never KEEP, and never conditionally.
     *
     * Three attempts at this, so the history matters:
     *
     * 1. Unconditional KEEP, to stop a second tap cancelling and restarting a run
     *    mid-batch. But KEEP preserves any *pending* work, and both
     *    ENQUEUED-waiting-on-backoff and BLOCKED count as pending — so once a
     *    chain backed off (2026-08-08: five hours, three continuations BLOCKED
     *    behind it) the button became a silent no-op precisely when it was needed.
     *
     * 2. KEEP only when a run is RUNNING, REPLACE otherwise. Also wrong: a process
     *    death mid-run leaves a STALE RUNNING row that WorkManager does not reset
     *    while the process lives, and cancelUniqueWork() won't shift it either.
     *    Observed repeatedly — the chain sat "RUNNING" at attempt 43 with nothing
     *    executing and no uploads for 19 minutes. Trusting that flag reproduced
     *    exactly the no-op of attempt 1.
     *
     * 3. This. REPLACE unconditionally, which also fixes a subtler bug: KEEP never
     *    rewrites the existing WorkSpec, so the one-time chain was still running
     *    the EXPONENTIAL backoff it was created with in an older build, long after
     *    BACKOFF_POLICY here changed to LINEAR. Only a replaced spec picks up
     *    current settings.
     *
     * The thrash this originally guarded against is no longer expensive: an
     * interrupted upload throws SyncStoppedException, which markInterrupted()
     * turns into "back in the queue, resume state kept, no retry burned". A
     * replaced run resumes from its last completed part within seconds. Losing
     * that is much cheaper than a button that does nothing.
     */
    public static void runNow(Context context) {
        Log.i(FolderSyncWorker.TAG, "runNow: replacing any existing chain");
        enqueueOneTime(context, true, ExistingWorkPolicy.REPLACE);
    }

    /**
     * Runs a scan triggered by app launch/resume.
     *
     * Opening the app is a weaker signal than tapping a button, so this does
     * NOT take a foreground service — it just picks up new photos promptly
     * while the app is in use.
     *
     * REPLACE, like runNow(), and for the same reason: KEEP leaves whatever is
     * already queued exactly as it is, including a chain that can no longer make
     * progress. That was observed directly — after the network constraint moved
     * out of the WorkRequest, the periodic run picked the new settings up (its
     * schedule is UPDATEd) while the one-time chain sat on the OLD constraint with
     * six BLOCKED continuations behind it, because no path ever rewrote that spec.
     *
     * Opening the app is the natural moment to discard that: it is the one point
     * where the user is present, a stale chain has no value, and a replaced spec
     * starts at attempt 0 with current settings. Interrupting a genuinely running
     * batch costs almost nothing now (see runNow()).
     */
    public static void runOnAppOpen(Context context) {
        Log.i(FolderSyncWorker.TAG, "runOnAppOpen: replacing any existing chain");
        enqueueOneTime(context, false, ExistingWorkPolicy.REPLACE);
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
            .setBackoffCriteria(BACKOFF_POLICY, 1, TimeUnit.MINUTES)
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
