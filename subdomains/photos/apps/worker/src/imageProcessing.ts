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
    return date.toLocaleString('en-CA', {
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
 * Note: Actual image processing with watermarking requires a more robust solution.
 * 
 * For production, consider:
 * 1. Cloudflare Images API for transformations
 * 2. External service (AWS Lambda with sharp/imagemagick)
 * 3. Cloudflare Workers with WASM-compiled image library
 * 
 * This file provides the utility functions that would be used by such a service.
 */
