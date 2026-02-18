/**
 * Google Analytics 4 integration service.
 * Provides type-safe wrappers for GA4 event tracking with feature flag checks.
 */

import { config } from '../config';

// Extend Window interface for gtag
declare global {
  interface Window {
    gtag?: (
      command: 'config' | 'event' | 'set',
      targetOrAction: string,
      params?: Record<string, any>
    ) => void;
    dataLayer?: any[];
  }
}

/**
 * Check if analytics is enabled and gtag is available.
 */
function isAnalyticsEnabled(): boolean {
  return (
    config.features.enableAnalytics &&
    typeof window !== 'undefined' &&
    typeof window.gtag === 'function'
  );
}

/**
 * Initialize Google Analytics 4.
 * Should be called once on app startup.
 */
export function initAnalytics(): void {
  if (!config.features.enableAnalytics) {
    console.log('[Analytics] Disabled via feature flag');
    return;
  }

  if (!config.gaMeasurementId || config.gaMeasurementId === 'G-PLACEHOLDER') {
    console.log('[Analytics] No measurement ID configured');
    return;
  }

  console.log('[Analytics] Initialized with ID:', config.gaMeasurementId);
}

/**
 * Track a page view.
 * @param path - The page path (e.g., '/events/winter-2024')
 * @param title - Optional page title
 */
export function trackPageView(path: string, title?: string): void {
  if (!isAnalyticsEnabled()) return;

  window.gtag!('event', 'page_view', {
    page_path: path,
    page_title: title,
  });
}

/**
 * Track when a user views a photo in detail view.
 * @param photoId - The photo ID
 * @param eventSlug - The event slug the photo belongs to
 */
export function trackPhotoView(photoId: number, eventSlug: string): void {
  if (!isAnalyticsEnabled()) return;

  window.gtag!('event', 'view_item', {
    item_id: photoId.toString(),
    item_name: `Photo ${photoId}`,
    item_category: eventSlug,
  });
}

/**
 * Track photo download events.
 * @param photoId - The photo ID (or 'bulk' for bulk downloads)
 * @param eventSlug - The event slug
 * @param bulk - Whether this is a bulk download
 * @param count - Number of photos (for bulk downloads)
 */
export function trackPhotoDownload(
  photoId: number | 'bulk',
  eventSlug: string,
  bulk: boolean = false,
  count: number = 1
): void {
  if (!isAnalyticsEnabled()) return;

  window.gtag!('event', 'download', {
    item_id: photoId.toString(),
    item_category: eventSlug,
    download_type: bulk ? 'bulk' : 'single',
    count: count,
  });
}

/**
 * Track when a user adds or removes a photo from favorites.
 * @param photoId - The photo ID
 * @param action - Whether adding or removing from favorites
 */
export function trackFavorite(photoId: number, action: 'add' | 'remove'): void {
  if (!isAnalyticsEnabled()) return;

  window.gtag!('event', action === 'add' ? 'add_to_wishlist' : 'remove_from_wishlist', {
    item_id: photoId.toString(),
  });
}

/**
 * Track search queries.
 * @param query - The search term
 */
export function trackSearch(query: string): void {
  if (!isAnalyticsEnabled()) return;

  window.gtag!('event', 'search', {
    search_term: query,
  });
}

/**
 * Track custom events.
 * Use this for any application-specific events not covered by the above methods.
 * @param eventName - The event name
 * @param params - Event parameters
 */
export function trackEvent(eventName: string, params?: Record<string, any>): void {
  if (!isAnalyticsEnabled()) return;

  window.gtag!('event', eventName, params);
}
