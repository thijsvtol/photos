import type { Env } from './types';
import { createLogger } from './logger';

/**
 * Batch-limited AI enrichment: generates a short caption (used for both
 * full-text search and as informal alt-text) and a semantic-search text
 * embedding for photos that don't have one yet. Runs entirely on Workers AI
 * so it stays inside Cloudflare's free 10,000-neurons/day allocation (see
 * developers.cloudflare.com/workers-ai/platform/pricing) — this is why it's
 * a small batch per hourly cron tick rather than an eager per-upload call.
 *
 * Deliberately NOT run per-upload (would risk burning through the daily
 * free allocation on a single big batch upload) and NOT run on a GPU
 * pipeline elsewhere (Workers AI is simpler and free at this scale).
 */

// Conservative per-run cap: a caption call is roughly a few thousand
// neurons depending on image size/response length, and the embedding call
// is cheap (~1841 neurons per million input tokens) — capping at a handful
// of photos per hourly tick keeps well under the 10k/day free allocation
// even if every event has more videos/images uploaded than expected.
const BATCH_SIZE = 5;

const CAPTION_MODEL = '@cf/llava-hf/llava-1.5-7b-hf' as const;
const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5' as const;

function float32ToBlob(vector: number[]): ArrayBuffer {
  return new Float32Array(vector).buffer;
}

export async function runAiEnrichment(env: Env): Promise<void> {
  const log = createLogger(env);

  if (!env.AI) {
    log.debug('[runAiEnrichment] No AI binding configured — skipping');
    return;
  }

  const { results } = await env.DB.prepare(`
    SELECT p.id, p.event_id, p.file_type, p.original_filename, p.cache_version,
           p.source_photo_id, p.source_event_slug, e.slug as event_slug
    FROM photos p
    JOIN events e ON p.event_id = e.id
    WHERE p.ai_processed_at IS NULL
      AND p.upload_complete = 1
      AND p.deleted_at IS NULL
    ORDER BY p.uploaded_at ASC
    LIMIT ?
  `).bind(BATCH_SIZE).all<{
    id: string; event_id: number; file_type: string; original_filename: string;
    cache_version: number; source_photo_id: string | null; source_event_slug: string | null;
    event_slug: string;
  }>();

  const photos = results || [];
  if (photos.length === 0) {
    log.debug('[runAiEnrichment] No photos pending enrichment');
    return;
  }

  for (const photo of photos) {
    try {
      // Videos have no single representative frame available cheaply here —
      // mark as processed (skipped) rather than repeatedly retrying forever.
      if (photo.file_type === 'video/mp4') {
        await env.DB.prepare("UPDATE photos SET ai_processed_at = datetime('now') WHERE id = ?").bind(photo.id).run();
        continue;
      }

      const r2Slug = photo.source_event_slug ?? photo.event_slug;
      const r2PhotoId = photo.source_photo_id ?? photo.id;
      const extension = photo.file_type.startsWith('raw/') ? 'jpg' : 'jpg'; // previews are always .jpg
      const previewKey = `preview/${r2Slug}/${r2PhotoId}.${extension}`;

      const object = await env.PHOTOS_BUCKET.get(previewKey);
      if (!object) {
        // No preview yet (e.g. still processing) — try again next run rather
        // than marking as processed, so it isn't skipped forever.
        continue;
      }

      const imageBytes = new Uint8Array(await object.arrayBuffer());

      const captionResult = await env.AI.run(CAPTION_MODEL, {
        image: Array.from(imageBytes),
        prompt: 'Describe this photo in one short sentence, mentioning any notable objects, people, animals, or setting.',
        max_tokens: 64,
      }) as { description?: string };

      const caption = (captionResult?.description || '').trim().slice(0, 500) || null;

      let embeddingBlob: ArrayBuffer | null = null;
      if (caption) {
        const embeddingText = `${photo.original_filename} ${caption}`.slice(0, 2000);
        const embeddingResult = await env.AI.run(EMBEDDING_MODEL, { text: [embeddingText] }) as {
          data?: number[][];
        };
        const vector = embeddingResult?.data?.[0];
        if (vector && vector.length > 0) {
          embeddingBlob = float32ToBlob(vector);
        }
      }

      await env.DB.prepare(`
        UPDATE photos SET ai_caption = ?, embedding = ?, ai_processed_at = datetime('now')
        WHERE id = ?
      `).bind(caption, embeddingBlob, photo.id).run();
    } catch (err) {
      log.error(`[runAiEnrichment] Failed to enrich photo ${photo.id}:`, err);
      // Mark as processed anyway so a single bad photo doesn't block the
      // batch query forever; it simply won't have a caption/embedding.
      await env.DB.prepare("UPDATE photos SET ai_processed_at = datetime('now') WHERE id = ?").bind(photo.id).run().catch(() => {});
    }
  }
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Embeds a free-text search query using the same model used for photo captions. */
export async function embedSearchQuery(env: Env, query: string): Promise<Float32Array | null> {
  if (!env.AI) return null;
  try {
    const result = await env.AI.run(EMBEDDING_MODEL, { text: [query.slice(0, 2000)] }) as { data?: number[][] };
    const vector = result?.data?.[0];
    return vector && vector.length > 0 ? new Float32Array(vector) : null;
  } catch (err) {
    createLogger(env).error('[embedSearchQuery] Failed to embed search query:', err);
    return null;
  }
}
