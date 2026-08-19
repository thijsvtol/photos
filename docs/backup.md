# Off-site backup to Backblaze B2

The primary copy of everything lives in **Cloudflare**:

- **Blobs** (photos & videos) — the R2 bucket `photos-storage` (`PHOTOS_BUCKET`).
- **Metadata** (people, face clusters, poster status, events, …) — the D1
  database `photos-db`.

That is a single provider on a single account. The nightly backup adds a
second, **independent** copy on a different provider (Backblaze B2) — the
"different provider, off-site" legs of a [3-2-1 backup](https://en.wikipedia.org/wiki/Backup#3-2-1_rule).
This protects against failure modes a second Cloudflare bucket cannot: an
account lockout or billing dispute, or a bug in our own code that mass-deletes
objects.

Bandwidth is free in both directions here — R2 has no egress fee, and B2 has no
ingress fee (and B2↔Cloudflare egress is free via the Bandwidth Alliance), so
the sync costs only B2 storage (~$6/TB/month).

## What runs

[`.github/workflows/backup-b2.yml`](../.github/workflows/backup-b2.yml) runs
nightly at **05:17 UTC** (after the 03:00 UTC transcode job, so we back up the
transcoded videos, not race them) and can also be triggered manually via
**Actions → Nightly Backup to B2 → Run workflow**. It calls
[`scripts/backup-to-b2.sh`](../scripts/backup-to-b2.sh), which does two
independent things:

1. **Blobs** — `rclone sync R2:photos-storage → B2:<bucket>/photos/blobs`.
   Changed or deleted files are moved to `B2:<bucket>/photos/_archive/<date>/`
   instead of being hard-deleted, so a bad delete in R2 can never destroy the
   only backup of a file.
2. **Database** — a logical SQL dump (schema + data), gzipped and uploaded to
   `B2:<bucket>/photos/db-backups/photos-db-<date>.sql.gz`. `wrangler d1 export`
   [cannot export a database containing an fts5 virtual table](https://github.com/cloudflare/workers-sdk/issues/6305)
   (your `photos_fts` search index), so the script enumerates the real tables and
   exports them one at a time (`--table` accepts only one table per call), then
   concatenates them. The fts5 index is **not** backed up — it is fully derived
   from `photos` and rebuilt on restore (see below). BLOB columns (face/AI
   embeddings) are preserved as SQL hex literals.

The three prefixes (`blobs/`, `_archive/`, `db-backups/`) are siblings under
`photos/` (the `B2_PREFIX`), so the mirror never re-syncs its own archive or
dumps. `_archive/` is pruned to `ARCHIVE_RETENTION_DAYS` (default 30 — it is the
main cost driver, since the nightly transcode rewrites videos in place) and
`db-backups/` to `DB_RETENTION_DAYS` (default 90 — the dumps are tiny).

## Cost

The transfer is free both ways (R2 has no egress fee, B2 no ingress fee) and
GitHub Actions is free on public repos, so the only cost is **B2 storage at
rest** (~$0.006/GB/month, first 10 GB free). Because `rclone sync` is
incremental, backup *frequency* barely affects cost — nightly costs about the
same as weekly. The levers that matter are total library size and
`ARCHIVE_RETENTION_DAYS`. Optionally enable a **B2 lifecycle rule** to hard-delete
hidden/old file versions (from `b2_hard_delete=false`) after a similar window.

## One-time setup

### 1. Create the B2 bucket + key

1. Create a **private** bucket in Backblaze B2 (e.g. `thijsvtol-photos-backup`).
2. Create an **Application Key** scoped to that bucket. Note the `keyID` and the
   `applicationKey` (shown once).
3. Recommended hardening (defense-in-depth against ransomware / a leaked key):
   - Enable **Object Lock** on the bucket (governance mode) so backups are
     immutable for a retention window.
   - Add a **Lifecycle rule** to keep prior file versions for ~90 days and then
     delete them, bounding storage from the `hard_delete=false` versioning.

### 2. Create an R2 read token

Cloudflare dashboard → **R2 → Manage API Tokens** → create a token with
**Object Read** permission for `photos-storage`. This yields an
`Access Key ID` and `Secret Access Key` for the S3-compatible API.

### 3. Add GitHub repository secrets

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Where it comes from |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | already present (used by other workflows) |
| `CLOUDFLARE_API_TOKEN` | already present; must include **D1 read** |
| `R2_ACCESS_KEY_ID` | R2 S3 API token (step 2) |
| `R2_SECRET_ACCESS_KEY` | R2 S3 API token (step 2) |
| `B2_KEY_ID` | B2 application key `keyID` (step 1) |
| `B2_APPLICATION_KEY` | B2 application key `applicationKey` (step 1) |
| `B2_BUCKET` | B2 bucket name (step 1) |

### 4. Test it

Trigger the workflow manually with mode `db` first (fast), confirm a
`photos-db-<date>.sql.gz` lands in B2, then run `all`.

## Running locally

```bash
export CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=...
export R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
export B2_KEY_ID=... B2_APPLICATION_KEY=... B2_BUCKET=thijsvtol-photos-backup

npm run backup            # everything
npm run backup -- db      # database only
npm run backup -- blobs   # blobs only
```

Requires [`rclone`](https://rclone.org/install/) and `wrangler` on `PATH`.

## Restoring

**A backup you have never restored is not a backup — do a trial restore once.**

Database (restore into a *fresh/empty* DB and verify before repointing prod):

```bash
rclone copyto B2:<bucket>/photos/db-backups/photos-db-2026-08-19.sql.gz ./dump.sql.gz
gunzip dump.sql.gz
wrangler d1 execute photos-db --remote --file=dump.sql
```

Then **rebuild the full-text search index**, which is intentionally not in the
dump (it is derived from `photos`). Re-run the `photos_fts` block — the
`CREATE VIRTUAL TABLE photos_fts`, the three `photos_fts_*` triggers, and the
backfill `INSERT` — from
[migrations/023_photos_organization_and_ai.sql](../migrations/023_photos_organization_and_ai.sql)
(lines 54–82) against the restored database:

```bash
wrangler d1 execute photos-db --remote --command "CREATE VIRTUAL TABLE IF NOT EXISTS photos_fts USING fts5(original_filename, ai_caption, ai_tags, city, content='photos', content_rowid='rowid');"
# ...then the three CREATE TRIGGER statements and the backfill INSERT from that migration.
```

Blobs (current mirror lives under `photos/blobs/`; recover a specific
deleted/changed file from `photos/_archive/<date>/`):

```bash
rclone copy B2:<bucket>/photos/blobs R2:photos-storage
```

## Tuning

Environment variables understood by the script (all optional except `B2_BUCKET`):
`R2_BUCKET`, `B2_BUCKET`, `B2_PREFIX`, `D1_DATABASE`, `ARCHIVE_RETENTION_DAYS`
(default 30), `DB_RETENTION_DAYS` (default 90), `RETENTION_DAYS` (fallback for
both), `BACKUP_STAMP`.
