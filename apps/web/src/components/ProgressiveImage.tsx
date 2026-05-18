import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();

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
  const [activeSrc, setActiveSrc] = useState<string | null>(isNative ? null : src);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setActiveSrc(isNative ? null : src);
  }, [src]);

  // On native: use IntersectionObserver to set src when near viewport
  useEffect(() => {
    if (!isNative) return;
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
      { rootMargin: '300px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [src, activeSrc]);

  // Check if image was already cached
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setImageLoaded(true);
    }
  }, [activeSrc]);

  const handleRetry = () => {
    setImageError(false);
    setImageLoaded(false);
    setActiveSrc(src);
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
            onClick={handleRetry}
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
          decoding="async"
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
        />
      ) : null}
    </div>
  );
};

export default ProgressiveImage;
