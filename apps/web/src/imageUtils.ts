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
 * Process an image for optimal Instagram upload quality.
 *
 * Instagram specs:
 * - Recommended width: 1080px
 * - Portrait (4:5): 1080×1350 — max portrait ratio allowed
 * - Square (1:1): 1080×1080
 * - Landscape (1.91:1): 1080×566 — max landscape ratio allowed
 *
 * Photos whose aspect ratio falls within Instagram's accepted range keep
 * their original ratio at 1080px wide. Photos outside the range are
 * letterboxed with white borders to fit the nearest accepted ratio.
 * A minimum 10% white border is applied on all sides in every case.
 */
export async function processForInstagram(imageUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const originalRatio = img.width / img.height;

        // Instagram's accepted aspect-ratio range
        const MIN_RATIO = 4 / 5;   // 0.8  — most portrait allowed
        const MAX_RATIO = 1.91;    // max landscape allowed
        const TARGET_WIDTH = 1080;

        // Clamp to Instagram's accepted range
        const clampedRatio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, originalRatio));

        const canvasWidth = TARGET_WIDTH;
        const canvasHeight = Math.round(TARGET_WIDTH / clampedRatio);

        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // White border background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);

        // Reserve at least 10% border on every side, so the image occupies
        // at most 80% of each canvas dimension.
        const BORDER_FRACTION = 0.10; // 10% per side
        const maxDrawWidth = Math.round(canvasWidth * (1 - BORDER_FRACTION * 2));
        const maxDrawHeight = Math.round(canvasHeight * (1 - BORDER_FRACTION * 2));

        // Scale image to fit within the inner area (contain)
        const scale = Math.min(maxDrawWidth / img.width, maxDrawHeight / img.height);
        const drawWidth = Math.round(img.width * scale);
        const drawHeight = Math.round(img.height * scale);
        const offsetX = Math.round((canvasWidth - drawWidth) / 2);
        const offsetY = Math.round((canvasHeight - drawHeight) / 2);

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
