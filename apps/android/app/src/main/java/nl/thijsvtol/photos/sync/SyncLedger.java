package nl.thijsvtol.photos.sync;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

/**
 * Durable record of every file folder sync has ever seen, and the queue the
 * upload loop works from.
 *
 * This single table replaces two things the old JS implementation got wrong:
 *
 * 1. DEDUPLICATION. The previous implementation's only signal was
 *    "mtime > config.lastSyncTime", and adding a folder reset lastSyncTime to
 *    undefined — so re-adding a folder, or reassigning one to a different
 *    event and back, re-uploaded every photo in it. Here a file is identified
 *    by BOTH a cheap identity ({@code event_slug + doc_id + size + mtime}) and
 *    its content hash ({@code event_slug + file_hash}), neither of which is
 *    affected by re-picking the folder. lastSyncTime survives only as a scan
 *    optimisation, never as a correctness gate.
 *
 * 2. QUEUE DURABILITY. The previous implementation read every new file fully
 *    into memory and persisted it as a Blob in IndexedDB before uploading
 *    anything, which is what made large batches OOM. Here only metadata is
 *    stored; bytes are streamed straight off the content:// URI at upload
 *    time. {@code upload_id}/{@code parts_json} are committed as each part
 *    lands, so a process death mid-file resumes from the last completed part
 *    rather than restarting from byte 0.
 */
public class SyncLedger extends SQLiteOpenHelper {

    private static final String DB_NAME = "sync_ledger.db";
    private static final int DB_VERSION = 1;
    public static final String TABLE = "synced_files";

    // ── state values ──
    /** Discovered by a scan, not yet hashed. */
    public static final String STATE_PENDING = "pending";
    /** Hashed and confirmed not to be a duplicate — ready to upload. */
    public static final String STATE_HASHED = "hashed";
    /** An upload is in flight (or was, before the process died). */
    public static final String STATE_UPLOADING = "uploading";
    /** Successfully uploaded. */
    public static final String STATE_UPLOADED = "uploaded";
    /** Content already present locally or server-side; deliberately skipped. */
    public static final String STATE_DUPLICATE = "duplicate";
    /** Gave up after {@link #MAX_RETRIES} attempts. Quarantined, retryable by the user. */
    public static final String STATE_FAILED = "failed";

    /**
     * Whole-file attempt limit, matching MAX_RETRIES in
     * apps/web/src/services/uploadManager.ts. Also bounds crash-loops: a file
     * that kills the process is recovered by
     * {@link #recoverInterrupted()} with retries incremented, so after this
     * many process deaths it is quarantined instead of taking down every
     * subsequent run.
     */
    public static final int MAX_RETRIES = 5;

    private static final long RETRY_BACKOFF_BASE_MS = 2000L;

    public SyncLedger(Context context) {
        super(context.getApplicationContext(), DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(
            "CREATE TABLE " + TABLE + " ("
                + "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                + "event_slug TEXT NOT NULL,"
                + "tree_uri TEXT NOT NULL,"
                + "doc_uri TEXT NOT NULL,"
                + "doc_id TEXT NOT NULL,"
                + "name TEXT,"
                + "mime TEXT,"
                + "size INTEGER NOT NULL,"
                + "mtime INTEGER NOT NULL,"
                + "file_hash TEXT,"
                + "photo_id TEXT,"
                + "state TEXT NOT NULL,"
                + "upload_id TEXT,"
                + "parts_json TEXT,"
                + "preview_done INTEGER NOT NULL DEFAULT 0,"
                + "faces_pending INTEGER NOT NULL DEFAULT 0,"
                + "retries INTEGER NOT NULL DEFAULT 0,"
                + "last_attempt INTEGER,"
                + "error TEXT,"
                + "created_at INTEGER NOT NULL,"
                + "updated_at INTEGER NOT NULL)"
        );
        // Cheap identity: survives re-picking the same folder (the tree URI can
        // change, the document id cannot).
        db.execSQL("CREATE UNIQUE INDEX idx_identity ON " + TABLE + "(event_slug, doc_id, size, mtime)");
        // Content identity: survives the file being copied/moved/renamed.
        db.execSQL("CREATE INDEX idx_hash ON " + TABLE + "(event_slug, file_hash)");
        db.execSQL("CREATE INDEX idx_state ON " + TABLE + "(state)");
        db.execSQL("CREATE INDEX idx_faces ON " + TABLE + "(faces_pending)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // v1 is the first shipped schema; nothing to migrate yet. Future
        // versions must migrate rather than drop — losing this table means
        // re-uploading (or, with the server hash pre-check, at least re-hashing)
        // every file the user has ever synced.
    }

    /** A row of the ledger, as consumed by the sync worker. */
    public static class Entry {
        public long id;
        public String eventSlug;
        public String treeUri;
        public String docUri;
        public String docId;
        public String name;
        public String mime;
        public long size;
        public long mtime;
        public String fileHash;
        public String photoId;
        public String state;
        public String uploadId;
        public String partsJson;
        public boolean previewDone;
        public int retries;
        public String error;
    }

    private static Entry readEntry(Cursor c) {
        Entry e = new Entry();
        e.id = c.getLong(c.getColumnIndexOrThrow("id"));
        e.eventSlug = c.getString(c.getColumnIndexOrThrow("event_slug"));
        e.treeUri = c.getString(c.getColumnIndexOrThrow("tree_uri"));
        e.docUri = c.getString(c.getColumnIndexOrThrow("doc_uri"));
        e.docId = c.getString(c.getColumnIndexOrThrow("doc_id"));
        e.name = c.getString(c.getColumnIndexOrThrow("name"));
        e.mime = c.getString(c.getColumnIndexOrThrow("mime"));
        e.size = c.getLong(c.getColumnIndexOrThrow("size"));
        e.mtime = c.getLong(c.getColumnIndexOrThrow("mtime"));
        e.fileHash = c.getString(c.getColumnIndexOrThrow("file_hash"));
        e.photoId = c.getString(c.getColumnIndexOrThrow("photo_id"));
        e.state = c.getString(c.getColumnIndexOrThrow("state"));
        e.uploadId = c.getString(c.getColumnIndexOrThrow("upload_id"));
        e.partsJson = c.getString(c.getColumnIndexOrThrow("parts_json"));
        e.previewDone = c.getInt(c.getColumnIndexOrThrow("preview_done")) == 1;
        e.retries = c.getInt(c.getColumnIndexOrThrow("retries"));
        e.error = c.getString(c.getColumnIndexOrThrow("error"));
        return e;
    }

    // ── discovery ──

    /**
     * Records a freshly-scanned file as {@link #STATE_PENDING}, unless this
     * event already has a row for it. Returns true if a new row was inserted
     * (i.e. this file is genuinely new work).
     *
     * Deliberately does NOT touch an existing row: a file already marked
     * uploaded/duplicate/failed must keep that verdict, which is exactly what
     * stops a re-added folder from re-uploading.
     */
    public boolean recordDiscovered(SafScanner.SafFile file, String eventSlug, String treeUri) {
        SQLiteDatabase db = getWritableDatabase();
        if (hasIdentity(eventSlug, file.docId, file.size, file.mtime)) return false;

        long now = System.currentTimeMillis();
        ContentValues v = new ContentValues();
        v.put("event_slug", eventSlug);
        v.put("tree_uri", treeUri);
        v.put("doc_uri", file.uri);
        v.put("doc_id", file.docId);
        v.put("name", file.name);
        v.put("mime", file.mimeType);
        v.put("size", file.size);
        v.put("mtime", file.mtime);
        v.put("state", STATE_PENDING);
        v.put("created_at", now);
        v.put("updated_at", now);
        // CONFLICT_IGNORE rather than a throw: two overlapping scans of the
        // same folder must not crash the worker, they must simply agree.
        long rowId = db.insertWithOnConflict(TABLE, null, v, SQLiteDatabase.CONFLICT_IGNORE);
        return rowId != -1;
    }

    public boolean hasIdentity(String eventSlug, String docId, long size, long mtime) {
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT 1 FROM " + TABLE + " WHERE event_slug = ? AND doc_id = ? AND size = ? AND mtime = ? LIMIT 1",
                new String[]{eventSlug, docId, String.valueOf(size), String.valueOf(mtime)})) {
            return c.moveToFirst();
        }
    }

    /**
     * Whether this event already has a non-failed row for this content hash —
     * i.e. the same photo reached the event under a different filename, folder
     * or document id. Failed rows are excluded so a quarantined file can still
     * be retried.
     */
    public boolean hasUploadedHash(String eventSlug, String fileHash, long excludeId) {
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT 1 FROM " + TABLE
                    + " WHERE event_slug = ? AND file_hash = ? AND id != ?"
                    + " AND state IN ('" + STATE_UPLOADED + "','" + STATE_DUPLICATE + "') LIMIT 1",
                new String[]{eventSlug, fileHash, String.valueOf(excludeId)})) {
            return c.moveToFirst();
        }
    }

    // ── queue reads ──

    /** Pending (unhashed) rows for an event, oldest capture first. */
    public List<Entry> pendingForHashing(String eventSlug, int limit) {
        return query(
            "state = ? AND event_slug = ?",
            new String[]{STATE_PENDING, eventSlug},
            "mtime ASC",
            limit
        );
    }

    /**
     * Rows ready to upload: hashed-and-unique, plus failed rows whose
     * exponential backoff has elapsed and that still have attempts left.
     * Oldest capture first so a backlog drains in chronological order.
     */
    public List<Entry> readyToUpload(int limit) {
        long now = System.currentTimeMillis();
        List<Entry> all = query(
            "state = ? OR (state = ? AND retries < " + MAX_RETRIES + ")",
            new String[]{STATE_HASHED, STATE_FAILED},
            "mtime ASC",
            limit * 2
        );
        List<Entry> due = new ArrayList<>();
        for (Entry e : all) {
            if (due.size() >= limit) break;
            if (STATE_HASHED.equals(e.state)) {
                due.add(e);
            } else if (isRetryDue(e, now)) {
                due.add(e);
            }
        }
        return due;
    }

    private boolean isRetryDue(Entry e, long now) {
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT last_attempt FROM " + TABLE + " WHERE id = ?",
                new String[]{String.valueOf(e.id)})) {
            long last = c.moveToFirst() && !c.isNull(0) ? c.getLong(0) : 0L;
            long backoff = RETRY_BACKOFF_BASE_MS * (1L << Math.min(e.retries, 16));
            return now - last >= backoff;
        }
    }

    private List<Entry> query(String where, String[] args, String orderBy, int limit) {
        List<Entry> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().query(
                TABLE, null, where, args, null, null, orderBy,
                limit > 0 ? String.valueOf(limit) : null)) {
            while (c.moveToNext()) out.add(readEntry(c));
        }
        return out;
    }

    // ── state transitions ──

    private void update(long id, ContentValues v) {
        v.put("updated_at", System.currentTimeMillis());
        getWritableDatabase().update(TABLE, v, "id = ?", new String[]{String.valueOf(id)});
    }

    public void markHashed(long id, String fileHash) {
        ContentValues v = new ContentValues();
        v.put("file_hash", fileHash);
        v.put("state", STATE_HASHED);
        update(id, v);
    }

    public void markDuplicate(long id, String fileHash) {
        ContentValues v = new ContentValues();
        if (fileHash != null) v.put("file_hash", fileHash);
        v.put("state", STATE_DUPLICATE);
        v.putNull("error");
        update(id, v);
    }

    public void markUploading(long id, String photoId) {
        ContentValues v = new ContentValues();
        v.put("state", STATE_UPLOADING);
        v.put("photo_id", photoId);
        v.put("last_attempt", System.currentTimeMillis());
        update(id, v);
    }

    /** Persists multipart resume state. Called as each part lands. */
    public void saveResumeState(long id, String uploadId, String partsJson) {
        ContentValues v = new ContentValues();
        v.put("upload_id", uploadId);
        v.put("parts_json", partsJson);
        update(id, v);
    }

    public void markUploaded(long id, boolean needsFaceDetection) {
        ContentValues v = new ContentValues();
        v.put("state", STATE_UPLOADED);
        v.put("preview_done", 1);
        v.put("faces_pending", needsFaceDetection ? 1 : 0);
        v.putNull("error");
        v.putNull("upload_id");
        v.putNull("parts_json");
        update(id, v);
    }

    /**
     * Records a failed attempt. Keeps upload_id/parts_json when the original
     * file's multipart upload is still usable, so the retry resumes rather
     * than re-uploading from scratch.
     */
    public void markFailed(long id, String error, boolean keepResumeState) {
        Entry current = byId(id);
        int retries = (current != null ? current.retries : 0) + 1;
        ContentValues v = new ContentValues();
        v.put("state", STATE_FAILED);
        v.put("retries", retries);
        v.put("last_attempt", System.currentTimeMillis());
        v.put("error", error);
        if (!keepResumeState) {
            v.putNull("upload_id");
            v.putNull("parts_json");
        }
        update(id, v);
    }

    /**
     * Sweeps rows left in {@link #STATE_UPLOADING} by a previous run that died
     * (process killed, OOM, device reboot mid-upload) back into the queue.
     *
     * Resume state is deliberately KEPT, so an interrupted large video picks
     * up from its last completed part. The retry counter is incremented so a
     * file that reproducibly takes the process down is quarantined after
     * {@link #MAX_RETRIES} sweeps instead of crash-looping every run forever.
     *
     * @return number of rows recovered.
     */
    public int recoverInterrupted() {
        List<Entry> stuck = query("state = ?", new String[]{STATE_UPLOADING}, "mtime ASC", 0);
        for (Entry e : stuck) {
            int retries = e.retries + 1;
            ContentValues v = new ContentValues();
            v.put("retries", retries);
            v.put("last_attempt", System.currentTimeMillis());
            if (retries >= MAX_RETRIES) {
                v.put("state", STATE_FAILED);
                v.put("error", "Sync was interrupted repeatedly while uploading this file");
            } else {
                // Back to the upload queue with resume state intact.
                v.put("state", e.fileHash != null ? STATE_HASHED : STATE_PENDING);
                v.put("error", "Interrupted, will resume");
            }
            update(e.id, v);
        }
        return stuck.size();
    }

    public Entry byId(long id) {
        List<Entry> rows = query("id = ?", new String[]{String.valueOf(id)}, null, 1);
        return rows.isEmpty() ? null : rows.get(0);
    }

    // ── face-detection handoff ──

    /**
     * Photos this engine uploaded that still need client-side face detection.
     * Faces are computed in the WebView (see apps/web/src/faceDetection.ts —
     * Workers AI has no face-embedding model), so natively-uploaded photos are
     * parked here and drained by faceDetectionQueue.ts on the next app launch.
     */
    public List<Entry> pendingFaceJobs(int limit) {
        return query("faces_pending = 1 AND state = ?", new String[]{STATE_UPLOADED}, "updated_at ASC", limit);
    }

    public void clearFaceJob(String photoId) {
        ContentValues v = new ContentValues();
        v.put("faces_pending", 0);
        getWritableDatabase().update(TABLE, v, "photo_id = ?", new String[]{photoId});
    }

    // ── stats & maintenance ──

    public int countByState(String state, String eventSlug) {
        String sql = "SELECT COUNT(*) FROM " + TABLE + " WHERE state = ?";
        String[] args = eventSlug == null
            ? new String[]{state}
            : new String[]{state, eventSlug};
        if (eventSlug != null) sql += " AND event_slug = ?";
        try (Cursor c = getReadableDatabase().rawQuery(sql, args)) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }

    /** Quarantined files, for the "these were skipped" UI. */
    public List<Entry> failedEntries(String eventSlug, int limit) {
        if (eventSlug == null) {
            return query("state = ? AND retries >= " + MAX_RETRIES, new String[]{STATE_FAILED}, "updated_at DESC", limit);
        }
        return query(
            "state = ? AND retries >= " + MAX_RETRIES + " AND event_slug = ?",
            new String[]{STATE_FAILED, eventSlug}, "updated_at DESC", limit
        );
    }

    /** Puts a quarantined file back in the queue (user-initiated retry). */
    public void resetRetries(long id) {
        ContentValues v = new ContentValues();
        v.put("retries", 0);
        v.putNull("error");
        v.putNull("last_attempt");
        Entry e = byId(id);
        v.put("state", e != null && e.fileHash != null ? STATE_HASHED : STATE_PENDING);
        update(id, v);
    }

    /**
     * Forgets sync history so the next run re-uploads everything. The escape
     * hatch behind the UI's "Forget sync history" action — the server-side
     * hash pre-check still suppresses genuine duplicates afterwards.
     */
    public int forget(String treeUri, String eventSlug) {
        if (treeUri != null) {
            return getWritableDatabase().delete(TABLE, "tree_uri = ?", new String[]{treeUri});
        }
        if (eventSlug != null) {
            return getWritableDatabase().delete(TABLE, "event_slug = ?", new String[]{eventSlug});
        }
        return 0;
    }

    /** Hashes of rows awaiting a server duplicate check, as a lookup batch. */
    public static List<String> hashesOf(Collection<Entry> entries) {
        List<String> out = new ArrayList<>(entries.size());
        for (Entry e : entries) {
            if (e.fileHash != null) out.add(e.fileHash.toLowerCase(Locale.US));
        }
        return out;
    }
}
