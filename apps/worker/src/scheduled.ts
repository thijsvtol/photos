import type { Env } from './types';
import { checkFeature } from './features';
import { sendUploadNotification } from './routes/collaborators';
import { createLogger } from './logger';
import { permanentlyDeletePhotos } from './photoDeletion';
import { TRASH_RETENTION_DAYS } from './routes/admin/photos';

/**
 * Hourly upload-notification job.
 *
 * Instead of emailing on every single photo upload (which is spammy), a
 * scheduled Worker cron runs once an hour, batches all collaborator uploads
 * per event, and emails the event's collaborators + configured admins a single
 * "N new photos" summary. Uploaders are never notified about their own uploads.
 *
 * No new infrastructure is required: it reuses the existing Mailgun email
 * integration and a `notified_at` marker column on the photos table.
 */

export interface NewPhotoRow {
  id: string;
  event_id: number;
  event_name: string;
  event_slug: string;
  uploaded_by: string | null;
}

export interface EventNotification {
  eventId: number;
  eventName: string;
  eventSlug: string;
  photoCount: number;
  /** Distinct uploader display values (emails) for this batch. */
  uploaders: string[];
  /** Recipients to email (collaborators + admins, excluding uploaders). */
  recipients: string[];
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Pure grouping logic (no I/O) so it can be unit tested.
 *
 * Groups new photos per event and computes the recipient list for each event:
 * the union of the event's collaborators and the global admin emails, minus the
 * uploaders themselves. Events that end up with no recipients are still returned
 * (with an empty recipients array) so their photos can be marked as notified.
 */
export function groupUploadNotifications(
  rows: NewPhotoRow[],
  collaboratorsByEvent: Map<number, string[]>,
  adminEmails: string[]
): EventNotification[] {
  const normalizedAdmins = adminEmails.map(normalizeEmail).filter(Boolean);
  const byEvent = new Map<number, EventNotification & { uploaderSet: Set<string> }>();

  for (const row of rows) {
    let entry = byEvent.get(row.event_id);
    if (!entry) {
      entry = {
        eventId: row.event_id,
        eventName: row.event_name,
        eventSlug: row.event_slug,
        photoCount: 0,
        uploaders: [],
        recipients: [],
        uploaderSet: new Set<string>(),
      };
      byEvent.set(row.event_id, entry);
    }
    entry.photoCount += 1;
    if (row.uploaded_by) {
      const uploader = normalizeEmail(row.uploaded_by);
      if (uploader && !entry.uploaderSet.has(uploader)) {
        entry.uploaderSet.add(uploader);
        entry.uploaders.push(row.uploaded_by.trim());
      }
    }
  }

  const result: EventNotification[] = [];
  for (const entry of byEvent.values()) {
    const collaborators = (collaboratorsByEvent.get(entry.eventId) || []).map(normalizeEmail);
    const recipientSet = new Set<string>();
    for (const email of [...collaborators, ...normalizedAdmins]) {
      if (email && !entry.uploaderSet.has(email)) {
        recipientSet.add(email);
      }
    }
    result.push({
      eventId: entry.eventId,
      eventName: entry.eventName,
      eventSlug: entry.eventSlug,
      photoCount: entry.photoCount,
      uploaders: entry.uploaders,
      recipients: Array.from(recipientSet),
    });
  }
  return result;
}

async function markPhotosNotified(env: Env, photoIds: string[]): Promise<void> {
  const now = new Date().toISOString();
  const chunkSize = 50;
  for (let i = 0; i < photoIds.length; i += chunkSize) {
    const chunk = photoIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(', ');
    await env.DB.prepare(
      `UPDATE photos SET notified_at = ? WHERE id IN (${placeholders})`
    ).bind(now, ...chunk).run();
  }
}

/**
 * Defense-in-depth cleanup for incomplete uploads.
 *
 * Every multipart upload creates a `photos` row with `upload_complete = 0`
 * at /start time (see routes/admin/uploads.ts). If a client abandons an
 * upload without ever calling /cancel (app uninstalled, browser tab closed
 * permanently, retries exhausted with no server-side abort reachable, etc.)
 * that row — and its in-progress R2 multipart upload/parts — would
 * otherwise linger forever. This job deletes stale incomplete rows so they
 * don't accumulate; the corresponding R2 multipart upload (if any) will be
 * cleaned up by R2's own automatic abort-incomplete-multipart-upload
 * behavior/lifecycle rules, since the Workers R2 binding has no API to list
 * or abort multipart uploads it didn't create in this request.
 */
const STALE_UPLOAD_THRESHOLD_HOURS = 48;

export async function runStaleUploadCleanup(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_UPLOAD_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString();
  await env.DB
    .prepare(`DELETE FROM photos WHERE upload_complete = 0 AND uploaded_at < ?`)
    .bind(cutoff)
    .run();
}

/**
 * Hard-deletes (R2 + DB row) any photo that has been sitting in Trash longer
 * than TRASH_RETENTION_DAYS (see routes/admin/photos.ts for the soft-delete
 * side of this — DELETE /photos/:photoId just sets `deleted_at`). Mirrors
 * the same permanentlyDeletePhotos() helper used by the admin "delete
 * forever"/"empty trash" endpoints, so both paths behave identically.
 */
export async function runTrashPurge(env: Env): Promise<void> {
  const log = createLogger(env);
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { results } = await env.DB.prepare(`
    SELECT p.id, p.source_photo_id, e.slug
    FROM photos p
    JOIN events e ON p.event_id = e.id
    WHERE p.deleted_at IS NOT NULL AND p.deleted_at < ?
  `).bind(cutoff).all<{ id: string; source_photo_id: string | null; slug: string }>();

  const toPurge = results || [];
  if (toPurge.length === 0) {
    log.debug('[runTrashPurge] No photos past the trash retention window');
    return;
  }

  log.info(`[runTrashPurge] Purging ${toPurge.length} photo(s) past the ${TRASH_RETENTION_DAYS}-day trash retention window`);
  await permanentlyDeletePhotos(env, toPurge);
}

/**
 * Entry point invoked by the Worker `scheduled` handler. Finds collaborator
 * uploads that have not yet been notified, emails a batched summary, and marks
 * the photos as notified so they are not reported again.
 */
export async function runUploadNotifications(env: Env): Promise<void> {
  const log = createLogger(env);

  // Fetch photos that still need a notification (collaborator uploads only).
  const { results } = await env.DB.prepare(`
    SELECT p.id, p.event_id, p.uploaded_by, e.name AS event_name, e.slug AS event_slug
    FROM photos p
    JOIN events e ON p.event_id = e.id
    WHERE p.notified_at IS NULL
      AND p.uploaded_by IS NOT NULL
      AND p.upload_complete = 1
  `).all<NewPhotoRow>();

  const rows = results || [];
  if (rows.length === 0) {
    log.debug('[runUploadNotifications] No un-notified collaborator uploads found');
    return;
  }

  const photoIds = rows.map((row) => row.id);

  // If email/collaborators are not enabled, still mark the photos as notified so
  // the backlog does not grow unbounded; there is simply nobody to email.
  const collaboratorsEnabled = checkFeature(env, 'enableCollaborators');
  const emailsEnabled = checkFeature(env, 'canSendEmails');
  if (!collaboratorsEnabled || !emailsEnabled) {
    log.warn(
      `[runUploadNotifications] Skipping ${photoIds.length} photo(s) notification — feature flag(s) disabled ` +
      `(enableCollaborators=${collaboratorsEnabled}, canSendEmails=${emailsEnabled}). Marking as notified without emailing anyone.`
    );
    await markPhotosNotified(env, photoIds);
    return;
  }

  // Load collaborators for the affected events.
  const eventIds = Array.from(new Set(rows.map((row) => row.event_id)));
  const collaboratorsByEvent = new Map<number, string[]>();
  for (const eventId of eventIds) {
    const { results: collabRows } = await env.DB.prepare(
      `SELECT user_email FROM event_collaborators WHERE event_id = ?`
    ).bind(eventId).all<{ user_email: string }>();
    collaboratorsByEvent.set(
      eventId,
      (collabRows || []).map((r) => r.user_email)
    );
  }

  const adminEmails = (env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);

  const notifications = groupUploadNotifications(rows, collaboratorsByEvent, adminEmails);

  let emailsSent = 0;
  let eventsWithNoRecipients = 0;
  for (const notification of notifications) {
    if (notification.recipients.length === 0) {
      eventsWithNoRecipients += 1;
      log.warn(
        `[runUploadNotifications] Event "${notification.eventName}" (${notification.eventSlug}) had ` +
        `${notification.photoCount} new photo(s) but no recipients to notify (no collaborators/admins ` +
        `configured, or all uploaders were the only collaborators) — marking notified without emailing.`
      );
      continue;
    }

    const uploaderLabel =
      notification.uploaders.length === 1
        ? notification.uploaders[0]
        : notification.uploaders.length > 1
          ? `${notification.uploaders.length} collaborators`
          : 'A collaborator';

    for (const recipient of notification.recipients) {
      try {
        await sendUploadNotification(env, {
          adminEmail: recipient,
          adminName: null,
          uploaderName: uploaderLabel,
          uploaderEmail: uploaderLabel,
          eventName: notification.eventName,
          eventSlug: notification.eventSlug,
          photoCount: notification.photoCount,
        });
        emailsSent += 1;
      } catch (err) {
        // sendUploadNotification already catches its own Mailgun/fetch errors
        // internally and logs+returns rather than throwing, but guard here too
        // so one unexpected failure can't abort the rest of the batch (which
        // would otherwise also skip markPhotosNotified below, causing these
        // photos to be re-processed — and re-emailed for recipients already
        // notified — on every subsequent hourly run).
        log.error(
          `[runUploadNotifications] Unexpected error notifying ${recipient} for event "${notification.eventName}":`,
          err
        );
      }
    }
  }

  log.debug(
    `[runUploadNotifications] Processed ${photoIds.length} photo(s) across ${notifications.length} event(s): ` +
    `${emailsSent} email(s) sent, ${eventsWithNoRecipients} event(s) with no recipients.`
  );

  // Mark everything we processed as notified (even events with no recipients).
  await markPhotosNotified(env, photoIds);
}
