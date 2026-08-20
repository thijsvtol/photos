# Design: propagate an online delete to the local synced folder (Android)

**Status:** IMPLEMENTED (purge-gated + own-deletes-only, opt-in). Chosen safety model: option (A)
purge-gated and "only my own deletes". Key pieces: migration `031_photo_tombstones.sql`;
`apps/worker/src/tombstones.ts` + wiring in `routes/admin/photos.ts` (delete/restore),
`photoDeletion.ts` (purge) and `routes/me.ts` (`GET /api/me/deletions`); native
`SyncLedger.byPhotoId`/`markLocallyDeleted` + `FolderSyncPlugin.deleteLocalFiles`; JS
`folderSync.reconcileDeletions` + the opt-in toggle in `FolderSyncManager`. The rest of this
document is the original design rationale.

## Goal

When a photo that originated from an Android **folder sync** is deleted on the server, also remove
the corresponding **original local file** from the device's synced folder — so the phone's storage
tracks the online library instead of keeping originals the user already deleted online.

## Verdict

**Mechanically feasible, but it is a real project, not a tweak, and it is genuinely dangerous** (it
destroys the user's only copy of an original). It needs net-new work in all three layers (server,
native, sync engine) plus a careful safety model. Recommend building it opt-in and purge-gated.

## What already exists (the linchpins)

- **Durable local↔server mapping.** The Android `SyncLedger` (`synced_files` table) stores, per
  uploaded file, both the exact local `doc_uri`/`doc_id` and the server `photo_id`
  (`SyncLedger.java` — `photo_id` written by `markUploading(id, photoId)`). This is the only
  trustworthy correlation and it already survives process death.
- **Write permission on the folder.** The SAF tree was picked via `OPEN_DOCUMENT_TREE` (read+write);
  `SafDirectoryPlugin` already `createDocument()`s into it, proving the grant includes write. So
  `DocumentsContract.deleteDocument(resolver, docUri)` on a ledger `doc_uri` is within the existing
  permission.
- **A clean server delete model with a safety window.** Server delete is a **soft delete**
  (`deleted_at` set; `DELETE /photos/:id`), restorable for **30 days** (`PUT /photos/:id/restore`),
  then hard-purged by a nightly cron (`photoDeletion.ts` / `scheduled.ts`,
  `TRASH_RETENTION_DAYS = 30`).

## What is missing (must be built)

1. **A deletions feed + durable tombstones (server).** Today deleted photos simply vanish from every
   API (`WHERE deleted_at IS NULL` everywhere), and the row is physically gone after 30 days — a
   client cannot learn *what* was deleted. Need:
   - a `photo_tombstones` table written on soft-delete (`photo_id`, `deleted_at`, and enough to let a
     device match: keep it minimal — `photo_id` is the key the device already has), that **outlives**
     the 30-day purge of the `photos` row;
   - `GET /api/me/deletions?since=<cursor>` (authenticated) returning `{ photoId, deletedAt }[]` +
     a next cursor. Scope it to deletions the caller is allowed to know about.
2. **A native SAF delete path.** No delete exists in the sync package today. Add a
   `FolderSyncPlugin` method that, given a `photo_id`, looks up its ledger `doc_uri` and calls
   `DocumentsContract.deleteDocument`; handle a `false`/exception return (stale doc id, revoked
   grant) without crashing; record a new ledger state (e.g. `locally_deleted`) so it's idempotent.
3. **A server→local reconcile phase.** The engine is strictly upload-only (`scan → hash → dedupe →
   upload`). Add a reconcile step (in `FolderSyncWorker.doWork()` or a JS-driven flow) that polls the
   deletions feed with a persisted `since` cursor and drives the native delete for matched ledger
   rows.

## Recommended safety model (the hard part)

- **Opt-in, off by default.** A clearly-worded setting in `FolderSyncManager` ("Also delete local
  files when I delete them online"). Deleting a user's originals must never be a surprise.
- **Correlate ONLY via the exact ledger `photo_id → doc_uri`.** Never fall back to filename or
  `file_hash` — copies/renames/hash-cleared copies (migration 028) would map to the wrong file.
- **Owner-device-only.** Only act on ledger rows this device actually uploaded. A second device that
  synced the same folder has its own ledger; and a delete performed by a *collaborator/admin* should
  not reach into the owner's personal storage — gate the feed so a device only sees deletions of
  photos it uploaded (match on `uploaded_by` = this account).
- **Gate on permanence, not soft-delete.** Prefer one of:
  - **(A) purge-gated:** only delete the local file after the server's 30-day hard purge, so a
    soft-delete + restore never destroys the original. Requires tombstones to outlive the row.
    Simple, safest; downside is up to ~30-day lag.
  - **(B) local-trash mirror:** on server soft-delete, *move* the local file into a local `.trash/`
    subfolder (not hard-deleted); a server restore moves it back; the local `.trash/` is cleaned
    after the retention window. Reversible and prompt, but more moving parts (move + restore + local
    GC) and doubles storage until GC.
  Recommend shipping **(A)** first; consider (B) later if the lag is a problem.
- **Robust failure handling.** `deleteDocument` returning false, revoked/replaced tree grant, moved
  files (stale `doc_id`) must all be logged and skipped, never fatal to the sync run.

## Rough effort / sequencing

1. Server: tombstone table + write-on-soft-delete + `GET /me/deletions?since=` + tests. (Smallest,
   unblocks everything.)
2. Native: `deleteDocument` path + `FolderSyncPlugin` method + ledger `locally_deleted` state.
3. Engine: reconcile phase + persisted cursor + the opt-in setting UI.
4. QA: soft-delete→restore race, revoked-grant, multi-device, and "never touches a non-synced file"
   cases.

## Open questions for product

- Purge-gated (A) vs local-trash mirror (B)?
- Should a delete by a collaborator/admin ever propagate to the owner's device, or strictly only the
  device owner's own deletes?
- Videos: same treatment (they're also synced originals) — no special casing needed beyond the
  ledger mapping.
