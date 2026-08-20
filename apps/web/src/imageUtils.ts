/**
 * Client-side image processing utilities
 * 
 * Images are resized in the browser before upload to reduce file sizes
 * and avoid Worker memory limits. This approach:
 * - Reduces bandwidth usage
 * - Speeds up uploads
 * - Avoids Cloudflare Worker memory constraints
 * - Provides better user experience with faster gallery loading
 */

export interface ResizeOptions {
  maxWidth: number;
  maxHeight?: number;
  quality: number;
}

// Files at or below this size are hashed in one shot with WebCrypto (fast, no WASM load). Larger
// files (typically videos) are hashed by STREAMING instead — see computeFileHash() for why.
const ONE_SHOT_MAX_SIZE = 100 * 1024 * 1024; // 100MB

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Streaming SHA-256 (hex) — feeds the file to an incremental hasher chunk-by-chunk so the whole
 * file is NEVER held in memory at once. Used for large files (videos), where a single
 * `file.arrayBuffer()` of hundreds of MB has crashed the Android WebView's renderer. WebCrypto has
 * no incremental digest, so this uses hash-wasm's `createSHA256()` — the result is a standard
 * SHA-256, byte-for-byte identical to WebCrypto's, so image and video hashes share one space and
 * stay comparable for duplicate detection. Exported for unit tests (so the streaming path can be
 * exercised without allocating a 100MB blob).
 */
export async function sha256Stream(file: Blob): Promise<string> {
  const { createSHA256 } = await import('hash-wasm');
  const hasher = await createSHA256();
  hasher.init();
  // Prefer the Streams API (true constant-memory); fall back to fixed-size slices where Blob.stream
  // isn't available (older WebViews / some test environments).
  const streamable = file as Blob & { stream?: () => ReadableStream<Uint8Array> };
  if (typeof streamable.stream === 'function') {
    const reader = streamable.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) hasher.update(value);
    }
  } else {
    const CHUNK = 8 * 1024 * 1024; // 8MB slices
    for (let offset = 0; offset < file.size; offset += CHUNK) {
      const slice = file.slice(offset, Math.min(offset + CHUNK, file.size));
      hasher.update(new Uint8Array(await slice.arrayBuffer()));
    }
  }
  return hasher.digest('hex');
}

/**
 * SHA-256 hash (hex) of a file's full contents, used for client-side duplicate detection (see
 * GET /admin/photos/duplicates and syncPeopleAcrossDuplicates() in
 * apps/worker/src/faceClustering.ts, both of which group photos/videos by this value). Best-effort:
 * returns undefined (never throws) if hashing fails, so it can never block or fail an upload.
 *
 * Small files use a one-shot WebCrypto digest; large files (videos) stream through an incremental
 * hasher so memory stays bounded regardless of size (see sha256Stream). Both produce the same
 * SHA-256, so nothing that was hashed before regresses.
 *
 * Shared between uploadManager.ts's foreground upload path, backgroundSync.ts's native
 * background-upload path (the latter used to skip this entirely, which meant essentially every
 * photo uploaded via the Android app got `file_hash = NULL` — see backgroundSync.ts's fix
 * comment for the full story), and AdminDuplicates.tsx's one-time "Backfill file hashes" action
 * (hashing an already-downloaded `Blob`, not a fresh upload's `File` — `File` extends `Blob`, so
 * this accepts either).
 */
export async function computeFileHash(file: Blob): Promise<string | undefined> {
  try {
    if (file.size <= ONE_SHOT_MAX_SIZE && typeof crypto !== 'undefined' && crypto.subtle) {
      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      return bytesToHex(new Uint8Array(digest));
    }
    return await sha256Stream(file);
  } catch (err) {
    console.warn('[computeFileHash] Failed to compute file hash:', err);
    return undefined;
  }
}

/**
 * Resize an image file to a smaller version using canvas
 */
export async function resizeImage(
  file: File,
  options: ResizeOptions
): Promise<Blob> {
  const { maxWidth, maxHeight = maxWidth, quality } = options;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      try {
        URL.revokeObjectURL(url);

        // Calculate new dimensions maintaining aspect ratio
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const aspectRatio = width / height;

          if (width > height) {
            width = Math.min(width, maxWidth);
            height = Math.round(width / aspectRatio);
          } else {
            height = Math.min(height, maxHeight);
            width = Math.round(height * aspectRatio);
          }
        }

        // Create canvas and resize
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Use high-quality image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw resized image
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to blob
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create blob from canvas'));
            }
          },
          'image/jpeg',
          quality
        );
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * Create a preview version of an image (1920px max width for full-screen laptop viewing)
 */
export async function createPreview(file: File): Promise<Blob> {
  return resizeImage(file, {
    maxWidth: 1920,
    quality: 0.85,
  });
}

/**
 * Process an image for optimal Instagram post quality.
 *
 * Always produces a fixed 4:5 vertical portrait canvas (1080 × 1350 px),
 * which is the highest-engagement format on Instagram. The original photo
 * is scaled to fit inside the canvas (contain mode) and centred on a white
 * background. A minimum 3 % white border is guaranteed on every side so
 * the image never bleeds to the edge.
 *
 * Best practices applied:
 * - Fixed 1080 × 1350 output (4:5) for maximum feed real-estate
 * - High-quality JPEG at 95 % to stay well within Instagram's re-compression
 * - High-quality image smoothing for clean down-scaling
 * - Clean white (#ffffff) background for a professional look
 */
export async function processForInstagram(imageUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        // Fixed 4:5 portrait canvas — optimal for Instagram feed visibility
        const CANVAS_WIDTH = 1080;
        const CANVAS_HEIGHT = 1350;

        const canvas = document.createElement('canvas');
        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // White background fill
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Reserve at least 3 % border on every side so the photo never
        // touches the canvas edge.
        const BORDER_FRACTION = 0.03; // 3 % per side
        const maxDrawWidth = Math.round(CANVAS_WIDTH * (1 - BORDER_FRACTION * 2));
        const maxDrawHeight = Math.round(CANVAS_HEIGHT * (1 - BORDER_FRACTION * 2));

        // Scale image to fit within the inner area (contain)
        const scale = Math.min(maxDrawWidth / img.width, maxDrawHeight / img.height);
        const drawWidth = Math.round(img.width * scale);
        const drawHeight = Math.round(img.height * scale);
        const offsetX = Math.round((CANVAS_WIDTH - drawWidth) / 2);
        const offsetY = Math.round((CANVAS_HEIGHT - drawHeight) / 2);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create Instagram blob from canvas'));
            }
          },
          'image/jpeg',
          0.95
        );
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => reject(new Error('Failed to load image for Instagram processing'));
    img.src = imageUrl;
  });
}
