import type { Env } from './types';

/**
 * Shared "permanently delete" logic (R2 objects + DB row), used by both the
 * admin "delete forever" / empty-trash endpoints (routes/admin/photos.ts)
 * and the nightly trash-purge cron (scheduled.ts). Soft-deleted photos are
 * only ever hard-deleted through this path, once their retention window has
 * passed (or an admin explicitly empties the trash).
 */
export interface DeletablePhotoRef {
  id: string;
  slug: string;
  source_photo_id: string | null;
}

const R2_DELETE_BATCH_SIZE = 25;
// D1 caps bound parameters at 100 per statement; keep IN (...) chunks under that.
const DB_DELETE_CHUNK_SIZE = 90;

export async function permanentlyDeletePhotos(env: Env, photos: DeletablePhotoRef[]): Promise<void> {
  if (photos.length === 0) return;

  // Only delete R2 objects for non-copied photos — copies share files with their source.
  const originals = photos.filter((p) => !p.source_photo_id);
  for (let i = 0; i < originals.length; i += R2_DELETE_BATCH_SIZE) {
    const batch = originals.slice(i, i + R2_DELETE_BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (photo) => {
        // The extension varies per derivative, so each variant needs its own
        // delete: images store .jpg, video originals .mp4, and — since the
        // playability job started writing 1080p H.264 derivatives — video
        // previews .mp4 as well. That last one was missing, which would have
        // stranded a derivative in R2 for every video ever deleted; nothing
        // fails when that happens, it just quietly accrues storage.
        await Promise.all([
          env.PHOTOS_BUCKET.delete(`original/${photo.slug}/${photo.id}.jpg`),
          env.PHOTOS_BUCKET.delete(`original/${photo.slug}/${photo.id}.mp4`),
          env.PHOTOS_BUCKET.delete(`preview/${photo.slug}/${photo.id}.jpg`),
          env.PHOTOS_BUCKET.delete(`preview/${photo.slug}/${photo.id}.mp4`),
          env.PHOTOS_BUCKET.delete(`ig/${photo.slug}/${photo.id}.jpg`),
          // Video poster (cover frame) — see media.ts's /poster route and migration 030.
          env.PHOTOS_BUCKET.delete(`poster/${photo.slug}/${photo.id}.jpg`),
        ]);
      })
    );
  }

  const ids = photos.map((p) => p.id);
  for (let i = 0; i < ids.length; i += DB_DELETE_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + DB_DELETE_CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(', ');
    await env.DB.prepare(`DELETE FROM photos WHERE id IN (${placeholders})`).bind(...chunk).run();
  }
}
