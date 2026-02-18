import React, { useState, useEffect } from 'react';

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
  const [currentSrc, setCurrentSrc] = useState(blurDataUrl || src);

  useEffect(() => {
    // Preload the full image
    const img = new Image();
    img.src = src;
    img.onload = () => {
      setCurrentSrc(src);
      setImageLoaded(true);
    };
  }, [src]);

  return (
    <div className="relative overflow-hidden w-full h-full">
      {blurDataUrl && !imageLoaded && (
        <img
          src={blurDataUrl}
          alt={alt}
          className={`${className} blur-xl absolute inset-0`}
          style={style}
        />
      )}
      <img
        src={currentSrc}
        alt={alt}
        className={`${className} transition-opacity duration-500 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
        style={style}
        loading={loading}
        onLoad={() => {
          if (currentSrc === src) {
            setImageLoaded(true);
          }
        }}
      />
    </div>
  );
};

export default ProgressiveImage;
