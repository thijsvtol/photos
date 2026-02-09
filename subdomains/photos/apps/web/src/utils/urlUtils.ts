import { Capacitor } from '@capacitor/core';

/**
 * Convert relative URLs to absolute URLs for native apps
 * In Capacitor apps, media must use absolute URLs to production
 */
export const getAbsoluteUrl = (relativePath: string): string => {
  // If already absolute, return as-is
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }

  // In native app, use production domain
  if (Capacitor.isNativePlatform()) {
    const prodUrl = import.meta.env.VITE_API_URL?.replace('/api', '') || 'https://photos.thijsvtol.nl';
    return `${prodUrl}${relativePath}`;
  }

  // In web, use relative path
  return relativePath;
};

/**
 * Get preview image URL for a photo
 */
export const getPreviewUrl = (slug: string, photoId: string, fileType?: string): string => {
  const isVideo = fileType === 'video/mp4';
  const extension = isVideo ? 'mp4' : 'jpg';
  const relativePath = `/media/${slug}/preview/${photoId}.${extension}`;
  return getAbsoluteUrl(relativePath);
};

/**
 * Get original image URL for a photo
 */
export const getOriginalUrl = (slug: string, photoId: string, fileType?: string): string => {
  const isVideo = fileType === 'video/mp4';
  const extension = isVideo ? 'mp4' : 'jpg';
  const relativePath = `/media/${slug}/original/${photoId}.${extension}`;
  return getAbsoluteUrl(relativePath);
};
