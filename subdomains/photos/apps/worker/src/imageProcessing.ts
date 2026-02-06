/**
 * Image processing utilities
 * Note: Image resizing is now done client-side in the browser
 * This file is kept for potential future server-side processing needs
 */

/**
 * Format capture time for watermark (Europe/Amsterdam timezone)
 */
export function formatWatermarkTime(isoTime: string): string {
  try {
    const date = new Date(isoTime);
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
