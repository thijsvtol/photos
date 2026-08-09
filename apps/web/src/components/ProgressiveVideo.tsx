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
  /** True while we are deliberately tearing the <video> down, so the `error`
   *  event that provokes isn't mistaken for a failed load — see handleVideoError. */
  const isUnloadingRef = useRef(false);

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
    // Ignore the error our own unload provokes. Clearing `src` and calling
    // load() to release the decoder makes Chromium fire `error`
    // (MEDIA_ELEMENT_ERROR: Empty src attribute) on the way out. Treating that
    // as a real failure burned retry attempts and, after three of them, latched
    // videoError — so a tile that had merely scrolled out of view came back
    // showing the "Retry" placeholder instead of the video. That is precisely
    // the "some videos don't load" symptom, manufactured by the cleanup itself.
    if (isUnloadingRef.current) return;

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

  /**
   * Mount the <video> when the tile comes near the viewport, and UNMOUNT it again
   * once it is far away.
   *
   * This used to be one-way: the observer set isNearViewport(true) and then
   * disconnected, so every tile the user ever scrolled past kept a live <video>
   * with `preload="metadata"` for the lifetime of the page. In this library that
   * is brutal — the gallery serves the ORIGINAL file for video tiles (videos get
   * no separate preview), and the synced videos average ~70MB, with 147 between
   * 50-200MB and 22 over 200MB (avg 550MB). Scrolling through a few hundred of
   * them left a few hundred concurrent metadata fetches against very large files,
   * which is what exhausted connections (videos stuck not loading) and stalled
   * scrolling for seconds at a time.
   *
   * Two observers rather than one, because a single rootMargin can only express
   * one threshold and load/unload must not share an edge — that would thrash on
   * any small scroll jitter. Loading at 200px and releasing only past 1500px
   * gives a wide hysteresis band, so normal back-and-forth scrolling never
   * re-fetches.
   */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const loadObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          isUnloadingRef.current = false;
          setIsNearViewport(true);
        }
      },
      { rootMargin: '200px 0px' }
    );

    const unloadObserver = new IntersectionObserver(
      (entries) => {
        if (entries.every((entry) => !entry.isIntersecting)) {
          // Release the decoder and any in-flight range request explicitly.
          // Unmounting alone leaves that to the browser's discretion, which is
          // exactly the "eventually" this fix exists to avoid.
          const video = videoRef.current;
          if (video) {
            isUnloadingRef.current = true;
            video.pause();
            video.removeAttribute('src');
            video.load();
          }
          setIsNearViewport(false);
          setIsPlaying(false);
          setMetadataLoaded(false);
          // A tile coming back into view deserves a clean slate: drop any
          // pending retry and the error state, so an earlier genuine failure
          // (or a load cut short by scrolling) doesn't persist as a dead tile.
          if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
          }
          retryCountRef.current = 0;
          setVideoError(false);
        }
      },
      { rootMargin: '1500px 0px' }
    );

    loadObserver.observe(el);
    unloadObserver.observe(el);
    return () => {
      loadObserver.disconnect();
      unloadObserver.disconnect();
    };
  }, [src]);

  // Abort video preload on unmount to free browser connections
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video) {
        isUnloadingRef.current = true;
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
            // Force the first frame to decode/paint. `preload="metadata"` alone
            // doesn't guarantee a painted frame on every browser/WebView —
            // seeking a hair past 0 makes it appear. Previously this only ran
            // on native (Android WebView), but plain desktop/mobile web
            // browsers can show the same blank-tile behavior whenever there's
            // no `poster` (e.g. blur_placeholder failed to capture at upload
            // time), so this now always runs as a fallback when no poster is
            // available, regardless of platform.
            onLoadedMetadata={(e) => {
              if ((isNative || !poster) && e.currentTarget.currentTime === 0) {
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
