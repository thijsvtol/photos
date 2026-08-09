package nl.thijsvtol.photos.sync;

import android.content.ContentResolver;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * The background folder-sync engine: scan → hash → dedupe → upload.
 *
 * Runs with no WebView alive, which is the entire point — the previous
 * JS pipeline died the moment the app was swiped away, so "sync hourly in the
 * background" never actually happened.
 *
 * Memory is flat regardless of batch size: files are processed one at a time,
 * hashed with a streaming digest, previewed via a subsampled decode, and
 * uploaded by streaming byte ranges straight off the content:// URI. Nothing
 * ever holds a whole file.
 *
 * Crash resilience is layered, because "don't crash" alone is not a plan:
 *  - every state transition is committed to the ledger BEFORE the work it
 *    describes, and multipart resume state is saved as each part lands;
 *  - {@link SyncLedger#recoverInterrupted()} sweeps rows abandoned by a dead
 *    process back into the queue with their resume state intact;
 *  - that sweep increments the retry counter, so a file that reproducibly
 *    kills the process is quarantined instead of poisoning every future run;
 *  - each run is time-capped and chains a continuation, so a huge backlog
 *    drains across runs rather than one run being killed for overrunning.
 */
public class FolderSyncWorker extends Worker {

    /**
     * Single tag for the whole sync engine, so `adb logcat -s FolderSync` shows a
     * complete picture of a run.
     *
     * This package logged NOTHING until 2026-08-08, which is why a sync that had
     * stalled for hours could only be diagnosed by pulling the ledger and
     * WorkManager's own SQLite databases off the device. Logging is at run/phase
     * boundaries only — per-file logging would flood logcat on a 4000-file scan.
     */
    static final String TAG = "FolderSync";

    /**
     * Wall-clock budget per run. Comfortably inside WorkManager's 10-minute
     * execution window, and keeps each run well within Android 15's daily
     * dataSync foreground-service budget.
     */
    private static final long MAX_RUN_MILLIS = 9 * 60 * 1000L;

    /** Files uploaded per run before deferring the rest to a continuation. */
    private static final int MAX_UPLOADS_PER_RUN = 200;
    /** Files hashed per run — hashing is I/O-bound and cheap, but not free. */
    private static final int MAX_HASHES_PER_RUN = 400;
    /** Must not exceed MAX_HASHES_PER_CHECK in apps/worker/src/routes/admin/uploads.ts. */
    private static final int HASH_CHECK_BATCH = 500;
    /** Cap on files recorded from a single folder scan, so one enormous directory can't stall a run. */
    private static final int MAX_SCAN_RESULTS = 5000;

    /** Reserve the tail of a photo's progress for the preview upload, as the web path does. */
    private static final int ORIGINAL_PROGRESS_MAX = 80;

    private final SyncConfig config;
    private final SyncLedger ledger;
    private final SyncNotifier notifier;
    private final ContentResolver resolver;
    private final MediaProbe probe;

    private long deadline;

    public FolderSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
        Context app = context.getApplicationContext();
        this.config = new SyncConfig(app);
        this.ledger = new SyncLedger(app);
        this.notifier = new SyncNotifier(app);
        this.resolver = app.getContentResolver();
        this.probe = new MediaProbe(resolver);
    }

    @NonNull
    @Override
    public ForegroundInfo getForegroundInfo() {
        return notifier.initialForegroundInfo();
    }

    @NonNull
    @Override
    public Result doWork() {
        this.deadline = System.currentTimeMillis() + MAX_RUN_MILLIS;

        // These three paths return without reaching finish(), so they clear the
        // progress notification themselves. finish() now KEEPS it alive between
        // runs while a backlog drains (see there), which means "we are not going
        // to sync at all" has to take the notification down explicitly —
        // otherwise disabling sync, removing the last folder, or a token expiry
        // would strand a progress bar on screen indefinitely.
        if (!config.isEnabled()) {
            notifier.clearProgress();
            return Result.success();
        }

        List<SyncConfig.Folder> folders = config.getEnabledFolders();
        if (folders.isEmpty()) {
            notifier.clearProgress();
            return Result.success();
        }

        // The Wi-Fi-only rule lives here, not in the WorkRequest's constraints —
        // see SyncScheduler.constraintsFrom() for why a network constraint made
        // the OS chop every run to pieces. Returning success (not retry) is
        // deliberate: being on cellular is a normal state, not a failure, and a
        // retry would grow the very backoff this whole change exists to avoid.
        if (!networkAllowsSync()) {
            Log.i(TAG, "skipping run: wifiOnly is on and the active network is metered/absent");
            notifier.clearProgress();
            return Result.success();
        }

        String token = config.getAuthToken();
        String baseUrl = config.getApiBaseUrl();
        if (token == null || baseUrl == null) {
            // Not signed in (or the app has never handed us a base URL yet).
            // Not an error worth retrying on a timer — the next configure()
            // call from JS will kick a fresh run.
            notifier.clearProgress();
            if (token == null) notifier.showAuthExpired();
            return Result.success();
        }

        // Only a run the user explicitly asked for may hold a foreground
        // service. A scheduled run is deferrable work and takes none — see
        // SyncScheduler.KEY_USER_INITIATED for why (Play policy: FGS must be
        // user-initiated or user-perceptible; a timer is neither). Either way
        // the user sees an ordinary progress notification, so the sync is
        // always visible and always stoppable.
        boolean userInitiated = getInputData().getBoolean(SyncScheduler.KEY_USER_INITIATED, false);
        notifier.setForeground(userInitiated);
        if (userInitiated) {
            try {
                setForegroundAsync(notifier.initialForegroundInfo());
            } catch (Exception e) {
                // Foreground promotion can be refused (e.g. background-start
                // restrictions). Continue anyway — we just lose the "don't
                // throttle me" hint; the work itself is unaffected.
                notifier.setForeground(false);
            }
        }

        config.setRunning(true);
        config.setLastError(null);

        PhotosApiClient api = new PhotosApiClient(resolver, baseUrl, token);
        RunStats stats = new RunStats();

        // Sampled once, before any scanning adds to it — see scanFolder(incremental).
        int startPending = ledger.countByState(SyncLedger.STATE_PENDING, null);
        int startHashed = ledger.countByState(SyncLedger.STATE_HASHED, null);
        boolean incrementalScan = startPending > 0 || startHashed > 0;

        Log.i(TAG, "run start: userInitiated=" + userInitiated
            + " folders=" + folders.size()
            + " backlog(pending=" + startPending + " hashed=" + startHashed + ")"
            + " scan=" + (incrementalScan ? "incremental" : "full"));

        try {
            // Anything a previous (crashed/killed) run left mid-flight goes back
            // in the queue with its resume state, before we add new work.
            int recovered = ledger.recoverInterrupted();
            if (recovered > 0) {
                stats.note("recovered " + recovered + " interrupted file(s)");
                Log.i(TAG, "recovered " + recovered + " interrupted file(s)");
            }

            notifier.showScanning(null);
            for (SyncConfig.Folder folder : folders) {
                // Via finish(), not a bare return: finish() is what enqueues the
                // continuation, leaves the progress notification in the right
                // state and logs the outcome. Returning straight out of the scan
                // loop skipped all three, so a run interrupted here (which is
                // common — the OS stops these jobs constantly) went silent and
                // scheduled no follow-up at all.
                if (isStopped()) return finish(stats, Result.success());
                scanFolder(folder, stats, incrementalScan);
            }
            Log.i(TAG, "scan done: discovered=" + stats.discovered);

            for (SyncConfig.Folder folder : folders) {
                if (isStopped() || outOfTime()) break;
                hashAndDedupe(folder, api, stats);
            }

            uploadReady(api, stats);

        } catch (PhotosApiClient.AuthExpiredException e) {
            Log.w(TAG, "auth expired mid-run");
            notifier.showAuthExpired();
            config.setLastError("Session expired — sign in again");
            return finish(stats, Result.success());
        } catch (Exception e) {
            // Deliberately SUCCESS, not retry.
            //
            // Result.retry() feeds WorkManager's run_attempt_count, and with the
            // backoff that implies, a handful of transient failures pushed the next
            // attempt hours out — on 2026-08-08 a run reached attempt 10, which
            // clamps to WorkManager's 5-hour maximum, with three continuations
            // stuck BLOCKED behind it. Sync looked dead for the rest of the day.
            //
            // There is nothing to gain from a run-level retry: every file's state,
            // resume position and retry count already live in the ledger, so the
            // next run re-offers exactly the work this one didn't finish. The
            // continuation enqueued by finish() is the non-escalating way to try
            // again, and the hourly periodic run is the backstop beneath that.
            Log.w(TAG, "run failed (continuing via continuation, not WorkManager retry)", e);
            config.setLastError(e.getMessage() != null ? e.getMessage() : e.toString());
            return finish(stats, Result.success());
        }

        return finish(stats, Result.success());
    }

    private Result finish(RunStats stats, Result result) {
        config.setRunning(false);
        config.setLastRunAt(System.currentTimeMillis());

        // Backlog left over (time/count cap hit)? Continue in another run rather
        // than letting this one overrun and be killed.
        int pending = ledger.countByState(SyncLedger.STATE_PENDING, null);
        int hashed = ledger.countByState(SyncLedger.STATE_HASHED, null);
        boolean backlog = pending > 0 || hashed > 0;
        boolean continuing = backlog && !isStopped();

        // Keyed on BACKLOG, not on `continuing`.
        //
        // Cancelling the progress notification between runs is what flooded
        // paired smartwatches: a cancel followed by a fresh post is a NEW
        // notification to a watch, not an update, so setLocalOnly() and
        // setOnlyAlertOnce() don't suppress it — those only govern re-alerting on
        // an existing notification.
        //
        // This first used `continuing` (backlog && !isStopped()), which fixed
        // nothing: runs currently end every 5-12 seconds because Android 14+
        // calls JobService.onNetworkChanged() on each network re-evaluation and
        // WorkManager's SystemJobService doesn't implement it, so the platform
        // stops and reschedules any job with a network constraint. isStopped() is
        // therefore true on almost every run that still has work left — exactly
        // the case the notification must survive.
        //
        // Backlog is the honest signal: files are still queued, the upload is
        // still going, so the progress bar stays. It comes down only when the
        // queue is empty (or sync stops entirely — see the early returns in
        // doWork(), which clear it themselves).
        if (!backlog) {
            notifier.clearProgress();
        }

        notifier.showRunSummary(
            stats.uploaded, stats.duplicates, stats.failed, stats.quarantined,
            stats.stopped || isStopped(), stats.lastEventSlug
        );

        Log.i(TAG, "run end: uploaded=" + stats.uploaded
            + " duplicates=" + stats.duplicates
            + " failed=" + stats.failed
            + " quarantined=" + stats.quarantined
            + " reason=" + (isStopped() || stats.stopped ? "stopped" : outOfTime() ? "outOfTime" : "finished")
            + " backlog(pending=" + pending + " hashed=" + hashed + ")"
            + " continuation=" + continuing
            + " progressNotification=" + (backlog ? "kept" : "cleared"));

        if (continuing) {
            SyncScheduler.enqueueContinuation(getApplicationContext());
        }

        return result;
    }

    /**
     * Whether the current network satisfies the user's Wi-Fi-only setting.
     *
     * Mirrors what NetworkType.UNMETERED used to express as a WorkManager
     * constraint, but evaluated once here rather than being watched by the
     * platform — the watching is what caused the restart storm.
     *
     * NOT_METERED rather than "is it Wi-Fi": a metered hotspot must not count as
     * Wi-Fi, and an explicitly unmetered cellular plan legitimately does count.
     * That matches the old constraint's semantics exactly.
     *
     * Fails OPEN when connectivity can't be read: a run that tries and fails on a
     * network error is recoverable per-file, whereas skipping forever because a
     * capability lookup returned null is not.
     */
    private boolean networkAllowsSync() {
        if (!config.isWifiOnly()) return true;

        ConnectivityManager cm =
            (ConnectivityManager) getApplicationContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return true;

        Network active = cm.getActiveNetwork();
        if (active == null) return false; // no network at all: nothing to upload over

        NetworkCapabilities caps = cm.getNetworkCapabilities(active);
        if (caps == null) return true;

        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
            && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private boolean outOfTime() {
        return System.currentTimeMillis() >= deadline;
    }

    // ── 1. scan ──

    /**
     * @param incremental use each folder's mtime watermark instead of walking it
     *                    in full. Decided ONCE per run by the caller, not per
     *                    folder — scanning folder A queues work, which would flip
     *                    a per-folder check and silently make folder B incremental
     *                    on a run that started with an empty queue.
     */
    private void scanFolder(SyncConfig.Folder folder, RunStats stats, boolean incremental) {
        // Incremental only while there is a backlog. That is the case where the
        // scan is pure overhead — we already know we have work queued, and every
        // second spent re-walking ~4000 known files is a second not spent
        // uploading them, out of the same MAX_RUN_MILLIS budget.
        //
        // When the queue is drained, scan EVERYTHING. The watermark is an mtime
        // floor, and a file copied into the folder keeps its original (older)
        // mtime, so it would sit below the floor and be missed indefinitely by an
        // incremental scan. Tying the optimisation to "backlog exists" bounds that
        // risk: anything skipped is picked up on the next run after the queue
        // empties. SafScanner's own contract says the same thing — the filter is
        // "an optimisation only — the ledger, not this filter, decides what is
        // actually new" — and idx_identity is what actually prevents re-uploads.
        long since = incremental ? config.getScanWatermark(folder.treeUri) : 0L;

        List<SafScanner.SafFile> files = SafScanner.scan(
            resolver, folder.treeUri, true, since, MAX_SCAN_RESULTS
        );

        long maxMtime = since;
        int newHere = 0;
        for (SafScanner.SafFile file : files) {
            // recordDiscovered() is a no-op for anything this event has already
            // seen — which is what makes re-adding or reassigning a folder free
            // instead of re-uploading everything in it.
            if (ledger.recordDiscovered(file, folder.eventSlug, folder.treeUri)) {
                stats.discovered++;
                newHere++;
            }
            if (file.mtime > maxMtime) maxMtime = file.mtime;
        }

        // Only advance the watermark when the scan saw the whole folder. A scan
        // truncated by MAX_SCAN_RESULTS stopped early, so files beyond the cap
        // were never looked at — moving the floor past them would skip them for good.
        boolean truncated = files.size() >= MAX_SCAN_RESULTS;
        if (!truncated && maxMtime > since) {
            config.setScanWatermark(folder.treeUri, maxMtime);
        }

        Log.i(TAG, "scanned " + folder.eventSlug + ": walked=" + files.size()
            + " new=" + newHere
            + (incremental ? " since=" + since : " (full scan)")
            + (truncated ? " TRUNCATED at " + MAX_SCAN_RESULTS + ", watermark held" : ""));

        stats.lastEventSlug = folder.eventSlug;
    }

    // ── 2. hash + duplicate check ──

    private void hashAndDedupe(SyncConfig.Folder folder, PhotosApiClient api, RunStats stats)
            throws PhotosApiClient.AuthExpiredException {
        List<SyncLedger.Entry> pending = ledger.pendingForHashing(folder.eventSlug, MAX_HASHES_PER_RUN);
        if (pending.isEmpty()) return;

        notifier.showScanning("Checking " + pending.size() + " new file(s)…");
        Log.i(TAG, "hashing " + pending.size() + " file(s) for " + folder.eventSlug);

        List<SyncLedger.Entry> needsServerCheck = new ArrayList<>();

        for (SyncLedger.Entry entry : pending) {
            if (isStopped() || outOfTime()) return;

            String hash = probe.sha256(entry.docUri, entry.size);

            if (hash == null) {
                // Too large to hash (or unreadable): no content-level dedupe is
                // possible, so fall through to uploading. The cheap identity in
                // the ledger still prevents re-uploading this same file later.
                ledger.markHashed(entry.id, null);
                continue;
            }

            if (ledger.hasUploadedHash(folder.eventSlug, hash, entry.id)) {
                ledger.markDuplicate(entry.id, hash);
                stats.duplicates++;
                continue;
            }

            ledger.markHashed(entry.id, hash);
            entry.fileHash = hash;
            needsServerCheck.add(entry);
        }

        // Ask the server about whatever the local ledger didn't already know —
        // this is what makes sync survive a reinstall, cleared app data, or the
        // same folder being synced from a second device.
        serverDedupe(folder.eventSlug, needsServerCheck, api, stats);
    }

    private void serverDedupe(
        String eventSlug, List<SyncLedger.Entry> entries, PhotosApiClient api, RunStats stats
    ) throws PhotosApiClient.AuthExpiredException {
        if (entries.isEmpty()) return;

        for (int start = 0; start < entries.size(); start += HASH_CHECK_BATCH) {
            List<SyncLedger.Entry> batch = entries.subList(
                start, Math.min(start + HASH_CHECK_BATCH, entries.size())
            );
            List<String> hashes = SyncLedger.hashesOf(batch);
            if (hashes.isEmpty()) continue;

            Set<String> existing;
            try {
                existing = new HashSet<>(api.checkHashes(eventSlug, hashes));
            } catch (PhotosApiClient.AuthExpiredException e) {
                throw e;
            } catch (IOException e) {
                // Best-effort: if the pre-check is unavailable, upload and let
                // the existing duplicate tooling handle it. Never block sync on it.
                stats.note("hash pre-check unavailable: " + e.getMessage());
                return;
            }

            for (SyncLedger.Entry entry : batch) {
                if (entry.fileHash != null && existing.contains(entry.fileHash.toLowerCase(Locale.US))) {
                    ledger.markDuplicate(entry.id, entry.fileHash);
                    stats.duplicates++;
                }
            }
        }
    }

    // ── 3. upload ──

    private void uploadReady(PhotosApiClient api, RunStats stats)
            throws PhotosApiClient.AuthExpiredException {
        List<SyncLedger.Entry> ready = ledger.readyToUpload(MAX_UPLOADS_PER_RUN);
        if (ready.isEmpty()) {
            Log.i(TAG, "nothing ready to upload");
            return;
        }

        int total = ready.size();
        Log.i(TAG, "uploading up to " + total + " file(s), "
            + ((deadline - System.currentTimeMillis()) / 1000) + "s of budget left");
        for (int i = 0; i < total; i++) {
            if (isStopped() || outOfTime()) break;

            SyncLedger.Entry entry = ready.get(i);
            stats.lastEventSlug = entry.eventSlug;
            final int index = i;

            notifier.showUploadProgress(index, total, null, entry.name, 0, entry.eventSlug, true);

            try {
                uploadOne(entry, api, (percent) ->
                    notifier.showUploadProgress(index, total, null, entry.name, percent, entry.eventSlug, false)
                );
                stats.uploaded++;
            } catch (PhotosApiClient.AuthExpiredException e) {
                // Nothing else in this run can succeed either.
                throw e;
            } catch (SyncStoppedException e) {
                // Not a failure: the run was stopped out from under us. Put the
                // file back in the queue with its resume state and WITHOUT
                // burning a retry, then leave quietly.
                //
                // This used to fall into the generic catch below, so every
                // interrupted run reported "1 photo failed" — the in-flight
                // file — and consumed one of its five attempts. Scheduled runs
                // are deferrable jobs now, so the OS stops them routinely and
                // that notification fired constantly.
                ledger.markInterrupted(entry.id);
                stats.stopped = true;
                break;
            } catch (Exception | OutOfMemoryError e) {
                recordFailure(entry, api, e, stats);
            }
        }

        if (!stats.stopped) {
            notifier.showUploadProgress(
                Math.min(stats.uploaded, total), total, null, null, -1, stats.lastEventSlug, true
            );
        }
    }

    /**
     * Thrown when WorkManager stops the run mid-file — the OS reclaimed a
     * deferrable job, a constraint (Wi-Fi, battery) was lost, or the user
     * tapped Stop. Distinct from a real failure so it neither consumes a retry
     * attempt nor reports an error to the user.
     */
    private static class SyncStoppedException extends IOException {
        SyncStoppedException() {
            super("Sync stopped");
        }
    }

    /** Progress sink for a single file's chunk uploads. */
    private interface ProgressSink {
        void onPercent(int percent);
    }

    private void uploadOne(SyncLedger.Entry entry, PhotosApiClient api, ProgressSink progress)
            throws IOException {
        boolean isVideo = SafScanner.isVideo(entry.mime);
        String photoId = entry.photoId != null ? entry.photoId : newPhotoId();

        ledger.markUploading(entry.id, photoId);

        // Metadata + preview first: both are best-effort, and doing them before
        // /start means the photo row is created with its EXIF already attached
        // (capture time drives the timeline, dimensions drive the grid).
        JSONObject metadata = probe.readMetadata(entry.docUri, entry.mime, entry.mtime);
        String blurPlaceholder = isVideo ? null : probe.createBlurPlaceholder(entry.docUri);
        byte[] previewJpeg = isVideo ? null : probe.createPreview(entry.docUri);

        int chunkSize = PhotosApiClient.chunkSizeFor(entry.mime, entry.size);
        int totalParts = (int) Math.max(1, (entry.size + chunkSize - 1) / chunkSize);
        int originalProgressMax = isVideo ? 100 : ORIGINAL_PROGRESS_MAX;

        // Resume: reuse the existing multipart upload and send only the parts
        // that never landed, instead of restarting a part-uploaded 4GB video.
        List<PhotosApiClient.Part> parts = parseParts(entry.partsJson);
        String uploadId = entry.uploadId;
        boolean resuming = uploadId != null && !parts.isEmpty() && parts.size() < totalParts;

        if (!resuming) {
            parts.clear();
            uploadId = api.startUpload(
                entry.eventSlug, photoId, entry.name, entry.mime,
                entry.fileHash, blurPlaceholder, metadata, false
            );
            ledger.saveResumeState(entry.id, uploadId, "[]");
        }

        try {
            uploadParts(api, entry, photoId, uploadId, parts, totalParts, chunkSize, originalProgressMax, progress);
        } catch (PhotosApiClient.AuthExpiredException e) {
            throw e;
        } catch (IOException e) {
            if (!resuming) throw e;
            // The resumed multipart upload expired or was aborted server-side.
            // Start fresh once rather than retrying a dead session forever.
            parts.clear();
            uploadId = api.startUpload(
                entry.eventSlug, photoId, entry.name, entry.mime,
                entry.fileHash, blurPlaceholder, metadata, false
            );
            ledger.saveResumeState(entry.id, uploadId, "[]");
            uploadParts(api, entry, photoId, uploadId, parts, totalParts, chunkSize, originalProgressMax, progress);
        }

        parts.sort((a, b) -> Integer.compare(a.partNumber, b.partNumber));
        api.completeUpload(entry.eventSlug, photoId, uploadId, parts, false);

        // Videos never get a separate preview file (the media endpoint serves
        // the .mp4), so they're done here.
        if (!isVideo && previewJpeg != null) {
            progress.onPercent(90);
            uploadPreview(api, entry.eventSlug, photoId, previewJpeg);
        }

        progress.onPercent(100);
        // Images uploaded here bypass the JS upload manager entirely, so
        // faceDetectionQueue.ts never sees them — park them for it to drain.
        ledger.markUploaded(entry.id, !isVideo);
    }

    private void uploadParts(
        PhotosApiClient api,
        SyncLedger.Entry entry,
        String photoId,
        String uploadId,
        List<PhotosApiClient.Part> parts,
        int totalParts,
        int chunkSize,
        int originalProgressMax,
        ProgressSink progress
    ) throws IOException {
        Set<Integer> done = new HashSet<>();
        for (PhotosApiClient.Part p : parts) done.add(p.partNumber);

        for (int partNumber = 1; partNumber <= totalParts; partNumber++) {
            if (done.contains(partNumber)) continue;
            // The clock is checked HERE, not just between files, because a single
            // large file can outlast the whole budget on its own — the remaining
            // backlog includes 100MB-1GB+ videos. Without this, such a file runs
            // past MAX_RUN_MILLIS until WorkManager force-stops the worker at its
            // 10-minute hard limit, which is both an abrupt kill and an increment
            // of run_attempt_count (i.e. more backoff).
            //
            // Stopping at a part boundary instead is clean: SyncStoppedException is
            // caught by uploadReady(), which calls markInterrupted() — resume state
            // is kept and no retry is burned, so the next run picks this file up
            // from its last completed part.
            if (isStopped() || outOfTime()) throw new SyncStoppedException();

            long offset = (long) (partNumber - 1) * chunkSize;
            long length = Math.min(chunkSize, entry.size - offset);
            if (length <= 0) break;

            String etag = api.uploadPart(
                entry.eventSlug, photoId, uploadId, partNumber,
                entry.docUri, offset, length, entry.mime, false
            );
            parts.add(new PhotosApiClient.Part(partNumber, etag));

            // Persist resume state as each part lands — this is what lets a
            // process death mid-file continue instead of restarting.
            ledger.saveResumeState(entry.id, uploadId, serializeParts(parts));

            progress.onPercent((int) ((long) parts.size() * originalProgressMax / totalParts));
        }
    }

    private void uploadPreview(PhotosApiClient api, String eventSlug, String photoId, byte[] jpeg)
            throws IOException {
        String uploadId = api.startUpload(
            eventSlug, photoId, photoId + "_preview.jpg", null, null, null, null, true
        );

        List<PhotosApiClient.Part> parts = new ArrayList<>();
        int chunk = PhotosApiClient.CHUNK_SIZE;
        int totalParts = Math.max(1, (jpeg.length + chunk - 1) / chunk);
        for (int partNumber = 1; partNumber <= totalParts; partNumber++) {
            int offset = (partNumber - 1) * chunk;
            int length = Math.min(chunk, jpeg.length - offset);
            String etag = api.uploadPart(
                eventSlug, photoId, uploadId, partNumber, jpeg, offset, length, "image/jpeg", true
            );
            parts.add(new PhotosApiClient.Part(partNumber, etag));
        }

        api.completeUpload(eventSlug, photoId, uploadId, parts, true);
    }

    private void recordFailure(
        SyncLedger.Entry entry, PhotosApiClient api, Throwable error, RunStats stats
    ) {
        String message = error.getMessage() != null ? error.getMessage() : error.toString();
        boolean permanent = error instanceof PhotosApiClient.NonRetryableException;

        SyncLedger.Entry current = ledger.byId(entry.id);
        int retries = current != null ? current.retries : entry.retries;
        boolean givingUp = permanent || retries + 1 >= SyncLedger.MAX_RETRIES;

        if (givingUp) {
            // Don't leave the half-uploaded parts (and the incomplete photo row)
            // lingering in R2 forever.
            String uploadId = current != null ? current.uploadId : entry.uploadId;
            String photoId = current != null ? current.photoId : entry.photoId;
            if (uploadId != null && photoId != null) {
                api.cancelUpload(entry.eventSlug, photoId, uploadId, entry.mime);
            }
            stats.quarantined++;
        } else {
            stats.failed++;
        }

        // Keep resume state unless we're giving up, so the retry continues from
        // the last completed part.
        ledger.markFailed(entry.id, message, !givingUp);

        if (permanent) {
            // Burn the remaining attempts so a request that can never succeed
            // isn't retried on a timer for the next several runs.
            for (int i = retries + 1; i < SyncLedger.MAX_RETRIES; i++) {
                ledger.markFailed(entry.id, message, false);
            }
        }
    }

    // ── helpers ──

    private static String newPhotoId() {
        // ULIDs are generated by the JS layer; a UUID is equally unique and
        // the API treats photoId as an opaque string.
        return UUID.randomUUID().toString();
    }

    private static List<PhotosApiClient.Part> parseParts(String json) {
        List<PhotosApiClient.Part> parts = new ArrayList<>();
        if (json == null || json.isEmpty()) return parts;
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                parts.add(new PhotosApiClient.Part(o.getInt("partNumber"), o.getString("etag")));
            }
        } catch (Exception e) {
            // Corrupt resume state — start the file over rather than uploading
            // a multipart object with mismatched parts.
            parts.clear();
        }
        return parts;
    }

    private static String serializeParts(List<PhotosApiClient.Part> parts) {
        JSONArray arr = new JSONArray();
        try {
            for (PhotosApiClient.Part p : parts) {
                JSONObject o = new JSONObject();
                o.put("partNumber", p.partNumber);
                o.put("etag", p.etag);
                arr.put(o);
            }
        } catch (Exception e) {
            return "[]";
        }
        return arr.toString();
    }

    /** Counters for the end-of-run summary notification. */
    private static class RunStats {
        int discovered = 0;
        int uploaded = 0;
        int duplicates = 0;
        /** Failed but still retryable. */
        int failed = 0;
        /** Failed past MAX_RETRIES — needs the user to intervene. */
        int quarantined = 0;
        /** The run was stopped rather than finishing. Suppresses the summary. */
        boolean stopped = false;
        String lastEventSlug = null;

        void note(String ignored) {
            // Reserved for future structured logging; kept so call sites read
            // as deliberate rather than swallowing information silently.
        }
    }
}
