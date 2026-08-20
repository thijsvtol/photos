import type { Env } from './types';
import { createLogger } from './logger';

/**
 * Batch-limited AI enrichment: generates a short caption (used for both
 * full-text search and as informal alt-text) and a semantic-search text
 * embedding for photos that don't have one yet. Runs entirely on Workers AI
 * so it stays inside Cloudflare's free 10,000-neurons/day allocation (see
 * developers.cloudflare.com/workers-ai/platform/pricing) — this is why it's
 * a batch per hourly cron tick rather than an eager per-upload call.
 *
 * Deliberately NOT run per-upload (would risk burning through the daily
 * free allocation on a single big batch upload) and NOT run on a GPU
 * pipeline elsewhere (Workers AI is simpler and free at this scale).
 *
 * Throughput sizing: the daily budget is ~10,000 free neurons, a caption call
 * costs roughly a handful of neurons and the embedding call is cheap (~1841
 * neurons per million input tokens). At BATCH_SIZE photos per hourly tick the
 * job *attempts* BATCH_SIZE * 24 photos/day. It is safe to aim high because it
 * is self-throttling: once the daily free allocation is exhausted Workers AI
 * starts returning rate-limit/capacity errors, which isTransientAiError()
 * recognises so the batch stops and leaves those photos unprocessed
 * (ai_processed_at stays NULL) to retry on the next tick/day — rather than
 * marking them done with no caption. So on a Workers Free plan this converges
 * to exactly the free allowance per day; on a Paid plan it bounds overage to
 * roughly BATCH_SIZE * 24 photos/day worth of neurons.
 */

// Per-run cap. Overridable via the AI_ENRICHMENT_BATCH_SIZE var without a code
// change. Default 50: 50 * 24 hourly ticks = up to 1200 photos/day attempted,
// which is enough to clear a multi-thousand-photo backfill in days while the
// transient-error deferral above keeps it inside the free tier.
const DEFAULT_BATCH_SIZE = 50;

// A batch of BATCH_SIZE photos makes ~2 AI calls + an R2 get + a DB write each;
// clamp so a mistyped var can't blow past the Worker subrequest limit (1000 on
// Paid) or run the scheduled invocation for too long.
const MAX_BATCH_SIZE = 200;

/**
 * True if an AI error is transient (daily free allocation exhausted, model at
 * capacity, upstream timeout) rather than a genuine problem with this photo.
 * Such photos must be left unprocessed to retry later, not marked done.
 */
function isTransientAiError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('capacity') ||
    msg.includes('rate limit') ||
    msg.includes('rate-limit') ||
    msg.includes('too many requests') ||
    msg.includes('429') ||
    msg.includes('3040') || // Workers AI "Rate limited" error code
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('temporarily')
  );
}

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

  const parsed = parseInt(env.AI_ENRICHMENT_BATCH_SIZE ?? '', 10);
  const batchSize = Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, MAX_BATCH_SIZE)
    : DEFAULT_BATCH_SIZE;

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
  `).bind(batchSize).all<{
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
      // Transient failure (daily free allocation exhausted, model at capacity,
      // upstream timeout): leave this photo unprocessed and stop the batch so it
      // and the rest retry on the next tick/day. Marking it done here would burn
      // it — permanently skipped with no caption — which is exactly what breaks a
      // large backfill running at the edge of the free tier.
      if (isTransientAiError(err)) {
        log.warn(`[runAiEnrichment] Transient AI error on photo ${photo.id}; deferring this photo and the rest of the batch:`, err);
        break;
      }
      log.error(`[runAiEnrichment] Failed to enrich photo ${photo.id}:`, err);
      // Genuine per-photo failure: mark as processed so a single bad photo
      // doesn't block the batch query forever; it simply won't have a
      // caption/embedding.
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
