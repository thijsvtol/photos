import type { Env } from './types';
import { checkFeature } from './features';
import { sendUploadNotification } from './routes/collaborators';

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
 * Entry point invoked by the Worker `scheduled` handler. Finds collaborator
 * uploads that have not yet been notified, emails a batched summary, and marks
 * the photos as notified so they are not reported again.
 */
export async function runUploadNotifications(env: Env): Promise<void> {
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
    return;
  }

  const photoIds = rows.map((row) => row.id);

  // If email/collaborators are not enabled, still mark the photos as notified so
  // the backlog does not grow unbounded; there is simply nobody to email.
  const canNotify =
    checkFeature(env, 'enableCollaborators') && checkFeature(env, 'canSendEmails');
  if (!canNotify) {
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

  for (const notification of notifications) {
    const uploaderLabel =
      notification.uploaders.length === 1
        ? notification.uploaders[0]
        : notification.uploaders.length > 1
          ? `${notification.uploaders.length} collaborators`
          : 'A collaborator';

    for (const recipient of notification.recipients) {
      await sendUploadNotification(env, {
        adminEmail: recipient,
        adminName: null,
        uploaderName: uploaderLabel,
        uploaderEmail: uploaderLabel,
        eventName: notification.eventName,
        eventSlug: notification.eventSlug,
        photoCount: notification.photoCount,
      });
    }
  }

  // Mark everything we processed as notified (even events with no recipients).
  await markPhotosNotified(env, photoIds);
}
