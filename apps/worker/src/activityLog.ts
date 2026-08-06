import type { Env } from './types';

/**
 * Lightweight append-only activity feed, read via polling from the admin UI
 * (no Durable Objects / realtime infra — see repo cost-governance notes).
 *
 * This table covers deliberate human actions on photos, events, tags and
 * people. Collaboration actions (invite/accept/decline/remove, plus
 * collaborator uploads) are NOT duplicated here — they already live in the
 * per-event `collaboration_history` table, and the admin feed endpoint
 * (routes/admin/analytics.ts) unions the two on read. Background jobs
 * (thumbnail regeneration, geocoding, face clustering) are deliberately
 * excluded: they're machine work, not an audit trail.
 *
 * Failures here are logged but never thrown — logging an activity entry must
 * never break the primary action it's attached to.
 */
export type ActivityAction =
  // Photos
  | 'photo_upload'
  | 'photo_favorite'
  | 'photo_trash'
  | 'photo_restore'
  | 'photo_delete_permanent'
  | 'photo_bulk_delete'
  | 'photo_bulk_copy'
  | 'photo_replace'
  | 'photo_archive'
  | 'photo_featured'
  | 'photo_location_edit'
  // Events
  | 'event_create'
  | 'event_update'
  | 'event_delete'
  | 'event_tags_update'
  | 'event_location_update'
  // Tags
  | 'tag_create'
  | 'tag_update'
  | 'tag_delete'
  // People
  | 'person_update'
  | 'person_merge'
  | 'person_delete'
  | 'person_tag_add'
  | 'person_tag_remove';

/**
 * Domain prefix of an action, used by the admin UI to group and filter the
 * feed. Kept in sync with ACTIVITY_DOMAINS on the client (apps/web/src/api.ts).
 */
export type ActivityDomain = 'photos' | 'events' | 'tags' | 'people' | 'sharing';

export async function logActivity(
  env: Env,
  params: {
    eventId?: number | null;
    actorEmail: string;
    action: ActivityAction;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await env.DB
      .prepare(`
        INSERT INTO activity_log (event_id, actor_email, action, target_type, target_id, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        params.eventId ?? null,
        params.actorEmail,
        params.action,
        params.targetType ?? null,
        params.targetId ?? null,
        params.metadata ? JSON.stringify(params.metadata) : null
      )
      .run();
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}
