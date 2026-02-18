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
