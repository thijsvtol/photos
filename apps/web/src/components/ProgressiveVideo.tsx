import React, { useState, useEffect, useRef } from 'react';
import { Play } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

interface ProgressiveVideoProps {
  src: string;
  poster?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

const ProgressiveVideo: React.FC<ProgressiveVideoProps> = ({
  src,
  poster,
  className = '',
  style,
}) => {
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [supportsHover, setSupportsHover] = useState(true);
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    setIsNearViewport(false);
    setIsPlaying(false);
    setMetadataLoaded(false);
  }, [src]);

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    setSupportsHover(mq.matches);
    const handler = () => setSupportsHover(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || isNearViewport) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsNearViewport(true);
            observer.disconnect();
          }
        });
      },
      { rootMargin: '200px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [src, isNearViewport]);

  // Abort video preload on unmount to free browser connections
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="relative overflow-hidden w-full h-full">
      {!isNearViewport && poster && (
        <img
          src={poster}
          alt=""
          className={`${className} blur-xl`}
          style={style}
        />
      )}
      {isNearViewport && (
        <>
          <video
            ref={videoRef}
            src={src}
            className={className}
            style={style}
            muted
            playsInline
            preload="metadata"
            poster={poster || undefined}
            // Force the first frame to decode/paint. Some Android WebViews don't
            // render a preview frame from preload="metadata" alone, leaving the
            // tile blank — seeking a hair past 0 makes the frame appear.
            onLoadedMetadata={(e) => {
              if (isNative && e.currentTarget.currentTime === 0) {
                try {
                  e.currentTarget.currentTime = 0.1;
                } catch {
                  /* ignore seek errors */
                }
              }
            }}
            onLoadedData={() => setMetadataLoaded(true)}
            onMouseEnter={(e) => {
              if (supportsHover) {
                e.currentTarget.play();
                setIsPlaying(true);
              }
            }}
            onMouseLeave={(e) => {
              if (supportsHover) {
                e.currentTarget.pause();
                e.currentTarget.currentTime = 0;
                setIsPlaying(false);
              }
            }}
            onEnded={() => setIsPlaying(false)}
          />
          {/* Show poster overlay until the first video frame is visible */}
          {!metadataLoaded && !isPlaying && poster && (
            <img
              src={poster}
              alt=""
              className={`absolute inset-0 w-full h-full object-cover`}
              style={style}
            />
          )}
          {/* Play icon overlay — always visible on touch/native devices, hidden on hover devices until hovered */}
          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-black/50 backdrop-blur-sm rounded-full p-2.5 shadow-lg">
                <Play className="w-5 h-5 text-white fill-white" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ProgressiveVideo;
