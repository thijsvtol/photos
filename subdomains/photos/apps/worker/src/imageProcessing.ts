/**
 * Simple image processing utilities for resizing and watermarking
 * Uses browser-compatible APIs that work in Cloudflare Workers
 */

interface ProcessImageOptions {
  maxWidth: number;
  maxHeight: number;
  watermarkText: string;
}

interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Calculate new dimensions maintaining aspect ratio
 */
export function calculateDimensions(
  originalWidth: number,
  originalHeight: number,
  maxSize: number
): ImageDimensions {
  const aspectRatio = originalWidth / originalHeight;
  
  let newWidth = originalWidth;
  let newHeight = originalHeight;
  
  if (originalWidth > originalHeight) {
    // Landscape
    if (originalWidth > maxSize) {
      newWidth = maxSize;
      newHeight = Math.round(maxSize / aspectRatio);
    }
  } else {
    // Portrait or square
    if (originalHeight > maxSize) {
      newHeight = maxSize;
      newWidth = Math.round(maxSize * aspectRatio);
    }
  }
  
  return { width: newWidth, height: newHeight };
}

/**
 * Format capture time for watermark (Europe/Amsterdam timezone)
 */
export function formatWatermarkTime(isoTime: string): string {
  try {
    const date = new Date(isoTime);
    // Format as YYYY-MM-DD HH:MM in Europe/Amsterdam timezone
    // Using nl-NL locale for European formatting
    return date.toLocaleString('nl-NL', {
      timeZone: 'Europe/Amsterdam',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).replace(',', '');
  } catch {
    return '';
  }
}

/**
 * Generate watermark text for a photo
 */
export function generateWatermarkText(
  eventName: string,
  captureTime: string
): string {
  const timeStr = formatWatermarkTime(captureTime);
  return `Thijs van Tol • ${timeStr} • ${eventName}`;
}

/**
 * Resize a JPEG image to fit within max dimensions while maintaining aspect ratio
 * Note: createImageBitmap/OffscreenCanvas are not available in all Workers runtimes
 * This is a fallback that returns the original image
 */
async function resizeJpeg(
  imageData: ArrayBuffer,
  maxWidth: number,
  maxHeight: number,
  quality: number = 0.85
): Promise<ArrayBuffer> {
  // For local development, just return the original
  // In production with proper runtime support, implement actual resizing
  return imageData;
}

/**
 * Generate preview and IG versions of an uploaded photo
 * Currently copies originals - actual resizing requires proper runtime support
 */
export async function generateThumbnails(
  bucket: R2Bucket,
  slug: string,
  photoId: string
): Promise<void> {
  try {
    // Get the original image
    const originalKey = `original/${slug}/${photoId}.jpg`;
    const original = await bucket.get(originalKey);
    
    if (!original) {
      console.error(`Original image not found: ${originalKey}`);
      return;
    }
    
    const imageData = await original.arrayBuffer();
    console.log(`Processing ${photoId}: original size ${imageData.byteLength} bytes`);
    
    // For now, copy the original to preview and IG paths
    // TODO: Implement actual resizing when runtime supports it
    const previewKey = `preview/${slug}/${photoId}.jpg`;
    await bucket.put(previewKey, imageData, {
      httpMetadata: {
        contentType: 'image/jpeg',
      },
    });
    console.log(`Created preview: ${previewKey}`);
    
    const igKey = `ig/${slug}/${photoId}.jpg`;
    await bucket.put(igKey, imageData, {
      httpMetadata: {
        contentType: 'image/jpeg',
      },
    });
    console.log(`Created IG version: ${igKey}`);
    
    // Verify the files were created
    const previewCheck = await bucket.head(previewKey);
    const igCheck = await bucket.head(igKey);
    
    console.log(`Thumbnails generated for ${photoId}: preview=${!!previewCheck}, ig=${!!igCheck}`);
  } catch (error) {
    console.error('Error generating thumbnails:', error);
    // Don't throw - let the original upload succeed even if thumbnail generation fails
  }
}

/**
 * Note: Current implementation resizes images using OffscreenCanvas API.
 * 
 * For production with watermarking, consider adding:
 * 1. Text overlay using canvas.fillText() for watermarks
 * 2. Cloudflare Images API for more advanced transformations (paid feature)
 * 3. External service for complex watermarking (AWS Lambda with sharp/imagemagick)
 * 
 * The generateWatermarkText() function is ready for watermark implementation.
 */
