import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

/** How many times to silently retry a failed video load before showing the manual Retry button. */
const AUTO_RETRY_LIMIT = 3;
/** Base delay (ms) for auto-retry backoff; attempt N waits AUTO_RETRY_BASE_DELAY_MS * N. */
const AUTO_RETRY_BASE_DELAY_MS = 800;

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
  const [videoError, setVideoError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isNative = Capacitor.isNativePlatform();
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setIsNearViewport(false);
    setIsPlaying(false);
    setMetadataLoaded(false);
    setVideoError(false);
    retryCountRef.current = 0;
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, [src]);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, []);

  const handleManualRetry = useCallback(() => {
    retryCountRef.current = 0;
    setVideoError(false);
    setMetadataLoaded(false);
    videoRef.current?.load();
  }, []);

  const handleVideoError = useCallback(() => {
    if (retryCountRef.current < AUTO_RETRY_LIMIT) {
      retryCountRef.current += 1;
      const delay = AUTO_RETRY_BASE_DELAY_MS * retryCountRef.current;
      retryTimeoutRef.current = setTimeout(() => {
        videoRef.current?.load();
      }, delay);
    } else {
      setVideoError(true);
    }
  }, []);

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
            onError={handleVideoError}
          />
          {/* Show poster overlay until the first video frame is visible */}
          {!metadataLoaded && !isPlaying && !videoError && poster && (
            <img
              src={poster}
              alt=""
              className={`absolute inset-0 w-full h-full object-cover`}
              style={style}
            />
          )}
          {videoError && (
            <div className={`${className} absolute inset-0 flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400`} style={style}>
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
          )}
          {/* Play icon overlay — always visible on touch/native devices, hidden on hover devices until hovered */}
          {!isPlaying && !videoError && (
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
