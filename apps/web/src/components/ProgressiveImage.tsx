import React, { useState, useEffect, useRef } from 'react';
import { registerLoad, abortLoad } from '../services/imageLoadManager';

interface ProgressiveImageProps {
  src: string;
  blurDataUrl?: string | null;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: 'lazy' | 'eager';
}

const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  src,
  blurDataUrl,
  alt,
  className = '',
  style,
  loading = 'lazy'
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadTriggeredRef = useRef(false);

  useEffect(() => {
    // Reset when src changes
    setImageLoaded(false);
    setImageError(false);
    loadTriggeredRef.current = false;
  }, [src]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || loadTriggeredRef.current) return;

    let unregister: (() => void) | null = null;

    // Use IntersectionObserver to only load the full image when near viewport
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !loadTriggeredRef.current) {
            loadTriggeredRef.current = true;
            observer.disconnect();

            const img = new Image();
            img.src = src;
            unregister = registerLoad(src, img);
            img.onload = () => {
              setImageLoaded(true);
              unregister?.();
              unregister = null;
            };
            img.onerror = () => {
              setImageError(true);
              unregister?.();
              unregister = null;
            };
          }
        });
      },
      { rootMargin: '200px 0px' } // Start loading 200px before entering viewport
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      // Abort pending load on unmount to free browser connections
      if (unregister) {
        abortLoad(src);
        unregister();
      }
    };
  }, [src]);

  const handleRetry = () => {
    setImageError(false);
    setImageLoaded(false);
    loadTriggeredRef.current = false;
  };

  return (
    <div ref={containerRef} className="relative overflow-hidden w-full h-full">
      {blurDataUrl && !imageLoaded && !imageError && (
        <img
          src={blurDataUrl}
          alt={alt}
          className={`${className} blur-xl absolute inset-0`}
          style={style}
        />
      )}
      {imageError ? (
        <div className={`${className} flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400`} style={style}>
          <svg className="w-8 h-8 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
          </svg>
          <button
            onClick={handleRetry}
            className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition"
          >
            Retry
          </button>
        </div>
      ) : (
        <img
          src={imageLoaded ? src : blurDataUrl || ''}
          alt={alt}
          className={`${className} transition-opacity duration-500 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          style={style}
          loading={loading}
        />
      )}
    </div>
  );
};

export default ProgressiveImage;
