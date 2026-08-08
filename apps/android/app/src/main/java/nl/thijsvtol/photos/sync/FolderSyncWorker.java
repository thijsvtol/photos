package nl.thijsvtol.photos.sync;

import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;

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

        if (!config.isEnabled()) return Result.success();

        List<SyncConfig.Folder> folders = config.getEnabledFolders();
        if (folders.isEmpty()) return Result.success();

        String token = config.getAuthToken();
        String baseUrl = config.getApiBaseUrl();
        if (token == null || baseUrl == null) {
            // Not signed in (or the app has never handed us a base URL yet).
            // Not an error worth retrying on a timer — the next configure()
            // call from JS will kick a fresh run.
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

        try {
            // Anything a previous (crashed/killed) run left mid-flight goes back
            // in the queue with its resume state, before we add new work.
            int recovered = ledger.recoverInterrupted();
            if (recovered > 0) {
                stats.note("recovered " + recovered + " interrupted file(s)");
            }

            notifier.showScanning(null);
            for (SyncConfig.Folder folder : folders) {
                if (isStopped()) return Result.success();
                scanFolder(folder, stats);
            }

            for (SyncConfig.Folder folder : folders) {
                if (isStopped() || outOfTime()) break;
                hashAndDedupe(folder, api, stats);
            }

            uploadReady(api, stats);

        } catch (PhotosApiClient.AuthExpiredException e) {
            notifier.showAuthExpired();
            config.setLastError("Session expired — sign in again");
            return finish(stats, Result.success());
        } catch (Exception e) {
            config.setLastError(e.getMessage() != null ? e.getMessage() : e.toString());
            return finish(stats, Result.retry());
        }

        return finish(stats, Result.success());
    }

    private Result finish(RunStats stats, Result result) {
        config.setRunning(false);
        config.setLastRunAt(System.currentTimeMillis());
        notifier.clearProgress();
        notifier.showRunSummary(
            stats.uploaded, stats.duplicates, stats.failed, stats.quarantined, stats.lastEventSlug
        );

        // Backlog left over (time/count cap hit)? Continue in another run rather
        // than letting this one overrun and be killed.
        boolean backlog = ledger.countByState(SyncLedger.STATE_PENDING, null) > 0
            || ledger.countByState(SyncLedger.STATE_HASHED, null) > 0;
        if (backlog && !isStopped()) {
            SyncScheduler.enqueueContinuation(getApplicationContext());
        }

        return result;
    }

    private boolean outOfTime() {
        return System.currentTimeMillis() >= deadline;
    }

    // ── 1. scan ──

    private void scanFolder(SyncConfig.Folder folder, RunStats stats) {
        List<SafScanner.SafFile> files = SafScanner.scan(
            resolver, folder.treeUri, true, 0L, MAX_SCAN_RESULTS
        );
        for (SafScanner.SafFile file : files) {
            // recordDiscovered() is a no-op for anything this event has already
            // seen — which is what makes re-adding or reassigning a folder free
            // instead of re-uploading everything in it.
            if (ledger.recordDiscovered(file, folder.eventSlug, folder.treeUri)) {
                stats.discovered++;
            }
        }
        stats.lastEventSlug = folder.eventSlug;
    }

    // ── 2. hash + duplicate check ──

    private void hashAndDedupe(SyncConfig.Folder folder, PhotosApiClient api, RunStats stats)
            throws PhotosApiClient.AuthExpiredException {
        List<SyncLedger.Entry> pending = ledger.pendingForHashing(folder.eventSlug, MAX_HASHES_PER_RUN);
        if (pending.isEmpty()) return;

        notifier.showScanning("Checking " + pending.size() + " new file(s)…");

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
        if (ready.isEmpty()) return;

        int total = ready.size();
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
            } catch (Exception | OutOfMemoryError e) {
                recordFailure(entry, api, e, stats);
            }
        }

        notifier.showUploadProgress(Math.min(stats.uploaded, total), total, null, null, -1, stats.lastEventSlug, true);
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
            if (isStopped()) throw new IOException("Sync stopped");

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
        String lastEventSlug = null;

        void note(String ignored) {
            // Reserved for future structured logging; kept so call sites read
            // as deliberate rather than swallowing information silently.
        }
    }
}
