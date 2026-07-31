import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();

/** How many times to silently retry a failed image load before showing the manual Retry button. */
const AUTO_RETRY_LIMIT = 3;
/** Base delay (ms) for auto-retry backoff; attempt N waits AUTO_RETRY_BASE_DELAY_MS * N. */
const AUTO_RETRY_BASE_DELAY_MS = 800;

interface ProgressiveImageProps {
  src: string;
  blurDataUrl?: string | null;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: 'lazy' | 'eager';
  /** Marks images the user is most likely looking at right now (e.g. first visible row) so the
   *  browser fetches them before other queued images. Passed through as the native fetchPriority hint. */
  priority?: boolean;
}

const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  src,
  blurDataUrl,
  alt,
  className = '',
  style,
  loading = 'lazy',
  priority = false,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  // Always start with no src: on both web and native we only assign the real src once the
  // element is near the viewport. This ensures photos load in viewport-proximity order
  // (what the user is looking at first, then surrounding photos) instead of the browser's
  // own arbitrary scheduling of a page full of eagerly-set <img src> tags.
  const [activeSrc, setActiveSrc] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setActiveSrc(null);
    retryCountRef.current = 0;
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, [src]);

  // Use IntersectionObserver (web + native) to set src only once the tile is near the
  // viewport, so images load in the order the user is scrolling through them.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || activeSrc) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSrc(src);
            observer.disconnect();
          }
        }
      },
      { rootMargin: priority ? '0px' : '300px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [src, activeSrc, priority]);

  // Check if image was already cached
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setImageLoaded(true);
    }
  }, [activeSrc]);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

  const reloadImage = useCallback(() => {
    setImageError(false);
    setImageLoaded(false);
    // Force the <img> to re-request even if activeSrc is unchanged.
    setActiveSrc(null);
    requestAnimationFrame(() => setActiveSrc(src));
  }, [src]);

  const handleError = useCallback(() => {
    if (retryCountRef.current < AUTO_RETRY_LIMIT) {
      retryCountRef.current += 1;
      const delay = AUTO_RETRY_BASE_DELAY_MS * retryCountRef.current;
      retryTimeoutRef.current = setTimeout(reloadImage, delay);
    } else {
      setImageError(true);
    }
  }, [reloadImage]);

  const handleManualRetry = () => {
    retryCountRef.current = 0;
    reloadImage();
  };

  return (
    <div ref={containerRef} className="relative overflow-hidden w-full h-full">
      {/* Blur placeholder shown while loading */}
      {blurDataUrl && !imageLoaded && !imageError && (
        <img
          src={blurDataUrl}
          alt=""
          className={`${className} absolute inset-0 w-full h-full object-cover scale-110 blur-lg`}
          style={style}
          aria-hidden="true"
        />
      )}
      {imageError ? (
        <div className={`${className} flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400`} style={style}>
          <svg className="w-8 h-8 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
          </svg>
          <button
            onClick={handleManualRetry}
            className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition"
          >
            Retry
          </button>
        </div>
      ) : activeSrc ? (
        <img
          ref={imgRef}
          src={activeSrc}
          alt={alt}
          className={`${className} transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          style={style}
          loading={isNative ? undefined : loading}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          onLoad={() => setImageLoaded(true)}
          onError={handleError}
        />
      ) : null}
    </div>
  );
};

export default ProgressiveImage;
