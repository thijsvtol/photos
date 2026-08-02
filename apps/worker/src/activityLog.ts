import type { Env } from './types';

/**
 * Lightweight append-only activity feed, read via polling from the admin UI
 * (no Durable Objects / realtime infra — see repo cost-governance notes).
 * Complements the existing per-event `collaboration_history` table (invite/
 * accept/decline/remove/upload) with a few event types that table doesn't
 * cover: favorites, event/album creation, and photo trashing. Failures here
 * are logged but never thrown — logging an activity entry must never break
 * the primary action it's attached to.
 */
export type ActivityAction =
  | 'photo_favorite'
  | 'event_create'
  | 'album_create'
  | 'photo_trash';

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
