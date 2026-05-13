import React, { useState, useEffect, useRef } from 'react';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const loadTriggeredRef = useRef(false);

  useEffect(() => {
    // Reset when src changes
    setImageLoaded(false);
    loadTriggeredRef.current = false;
  }, [src]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || loadTriggeredRef.current) return;

    // Use IntersectionObserver to only load the full image when near viewport
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !loadTriggeredRef.current) {
            loadTriggeredRef.current = true;
            observer.disconnect();

            const img = new Image();
            img.src = src;
            img.onload = () => {
              setImageLoaded(true);
            };
          }
        });
      },
      { rootMargin: '200px 0px' } // Start loading 200px before entering viewport
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [src]);

  return (
    <div ref={containerRef} className="relative overflow-hidden w-full h-full">
      {blurDataUrl && !imageLoaded && (
        <img
          src={blurDataUrl}
          alt={alt}
          className={`${className} blur-xl absolute inset-0`}
          style={style}
        />
      )}
      <img
        src={imageLoaded ? src : blurDataUrl || ''}
        alt={alt}
        className={`${className} transition-opacity duration-500 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
        style={style}
        loading={loading}
        onLoad={() => {
          if (imageLoaded) {
            // Already handled by preload
          }
        }}
      />
    </div>
  );
};

export default ProgressiveImage;
