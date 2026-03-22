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
