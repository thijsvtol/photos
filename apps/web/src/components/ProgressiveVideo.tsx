import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

/** How many times to silently retry a failed video load before showing the manual Retry button. */
const AUTO_RETRY_LIMIT = 3;
/** Base delay (ms) for auto-retry backoff; attempt N waits AUTO_RETRY_BASE_DELAY_MS * N. */
const AUTO_RETRY_BASE_DELAY_MS = 800;

interface ProgressiveVideoProps {
  src: string;
  /** Tiny (16x16) blur_placeholder data-URI — the progressive placeholder behind the poster. */
  poster?: string | null;
  /**
   * URL of the real still-image poster (cover frame) JPEG for this video. When provided, the tile
   * renders that IMAGE at rest and only mounts the <video> (at the multi-MB MP4) on hover — so
   * scrolling a gallery of videos never fetches video bytes. When omitted (video not yet
   * backfilled, or a non-grid caller), falls back to the legacy behavior: mount the <video> near
   * the viewport to paint a frame, using the blur as its poster attribute.
   */
  posterUrl?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

const ProgressiveVideo: React.FC<ProgressiveVideoProps> = ({
  src,
  poster,
  posterUrl,
  className = '',
  style,
}) => {
  /** The poster image failed to load (e.g. a video not yet backfilled — the /poster route 404s).
   *  We then fall back to the legacy near-viewport <video> mount for this tile, so a missing
   *  poster degrades to today's behavior rather than a broken image. */
  const [posterFailed, setPosterFailed] = useState(false);
  // Only take the poster-image path while we actually have a working poster.
  const usePosterImage = !!posterUrl && !posterFailed;
  const [isNearViewport, setIsNearViewport] = useState(false);
  /** Desktop hover over the tile — the mount trigger on the poster-image path. */
  const [hovering, setHovering] = useState(false);
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

  // On the poster-image path the <video> mounts only while hovering; on the legacy fallback it
  // mounts whenever the tile is near the viewport.
  const shouldMountVideo = usePosterImage ? hovering : isNearViewport;

  useEffect(() => {
    setIsNearViewport(false);
    setHovering(false);
    setIsPlaying(false);
    setMetadataLoaded(false);
    setVideoError(false);
    setPosterFailed(false);
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
   * Legacy fallback ONLY (no poster image available): mount the <video> when the tile comes near
   * the viewport, and UNMOUNT it again once it is far away. On the poster-image path this is
   * skipped entirely — the poster <img> is the at-rest thumbnail and the <video> mounts on hover
   * — which is what keeps scrolling from fetching any video bytes.
   *
   * Two observers rather than one, because a single rootMargin can only express
   * one threshold and load/unload must not share an edge — that would thrash on
   * any small scroll jitter. Loading at 200px and releasing only past 1500px
   * gives a wide hysteresis band, so normal back-and-forth scrolling never
   * re-fetches.
   */
  useEffect(() => {
    if (usePosterImage) return; // poster path mounts on hover, not on scroll proximity
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
  }, [src, usePosterImage]);

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

  const handleTileMouseEnter = () => {
    if (usePosterImage && supportsHover) setHovering(true);
  };
  const handleTileMouseLeave = () => {
    if (usePosterImage && supportsHover) {
      setHovering(false);
      setIsPlaying(false);
      setMetadataLoaded(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden w-full h-full"
      onMouseEnter={handleTileMouseEnter}
      onMouseLeave={handleTileMouseLeave}
    >
      {/* At-rest thumbnail */}
      {usePosterImage ? (
        // Real poster image over the tiny blur. Kept mounted under the <video> so hover-in/out
        // never refetches or flickers. Native lazy-loading keeps a long grid from fetching every
        // poster at once. onError (e.g. a 404 for a not-yet-backfilled video) flips this tile to
        // the legacy near-viewport <video> path instead of showing a broken image.
        <>
          {poster && (
            <img src={poster} alt="" aria-hidden className={`${className} absolute inset-0 blur-xl`} style={style} />
          )}
          <img
            src={posterUrl!}
            alt=""
            loading="lazy"
            className={`${className} relative`}
            style={style}
            onError={() => setPosterFailed(true)}
          />
        </>
      ) : (
        !isNearViewport && poster && (
          <img src={poster} alt="" className={`${className} blur-xl`} style={style} />
        )
      )}

      {shouldMountVideo && (
        <>
          <video
            ref={videoRef}
            src={src}
            className={usePosterImage ? `${className} absolute inset-0` : className}
            style={style}
            muted
            playsInline
            preload="metadata"
            // On the poster path the <video> only appears on hover, so autoplay = the preview the
            // hover implies. On the fallback path it stays paused (showing a frame) until hovered.
            autoPlay={usePosterImage}
            poster={poster || undefined}
            // Force the first frame to decode/paint on the FALLBACK path. `preload="metadata"`
            // alone doesn't guarantee a painted frame on every browser/WebView; seeking a hair
            // past 0 makes it appear. Not needed on the poster path (the poster image is already
            // showing and the video autoplays).
            onLoadedMetadata={(e) => {
              if (!usePosterImage && (isNative || !poster) && e.currentTarget.currentTime === 0) {
                try {
                  e.currentTarget.currentTime = 0.1;
                } catch {
                  /* ignore seek errors */
                }
              }
            }}
            onLoadedData={() => setMetadataLoaded(true)}
            onPlaying={() => setIsPlaying(true)}
            onMouseEnter={(e) => {
              if (!usePosterImage && supportsHover) {
                e.currentTarget.play();
                setIsPlaying(true);
              }
            }}
            onMouseLeave={(e) => {
              if (!usePosterImage && supportsHover) {
                e.currentTarget.pause();
                e.currentTarget.currentTime = 0;
                setIsPlaying(false);
              }
            }}
            onEnded={() => setIsPlaying(false)}
            onError={handleVideoError}
          />
          {/* Fallback path only: hold the blur poster over the <video> until its first frame
              paints. On the poster path the real poster image underneath already fills this role. */}
          {!usePosterImage && !metadataLoaded && !isPlaying && !videoError && poster && (
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
        </>
      )}

      {/* Play icon overlay — always visible on touch/native devices, hidden on hover devices once playing */}
      {!isPlaying && !videoError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 backdrop-blur-sm rounded-full p-2.5 shadow-lg">
            <Play className="w-5 h-5 text-white fill-white" />
          </div>
        </div>
      )}
    </div>
  );
};

export default ProgressiveVideo;
