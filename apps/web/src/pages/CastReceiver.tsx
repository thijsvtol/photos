import { useEffect, useRef, useState } from 'react';
import { CAST_NAMESPACE, type CastMediaMessage } from '../services/castService';

/**
 * Custom Google Cast RECEIVER page.
 *
 * This is what actually runs on the Chromecast/TV device (not in the phone's
 * browser/app) once a user casts from CastButton. The stock default media
 * receiver Google provides only knows how to play a single audio/video
 * stream — it has no concept of a photo slideshow or an "album" of mixed
 * photos/videos, so a CUSTOM receiver is required for that. This page is
 * that receiver: it registers with `cast.framework.CastReceiverContext`,
 * listens for JSON messages on our custom namespace from the sender
 * (web/native CastButton), and renders full-screen accordingly.
 *
 * Deployment note: this route must be registered as the "Receiver
 * Application URL" for a custom receiver in the Google Cast SDK Developer
 * Console (https://cast.google.com/publish) — a one-time manual step by the
 * site owner, using this page's absolute URL
 * (https://<domain>/cast-receiver) — to obtain the Application ID that
 * castService.ts / VITE_CAST_APP_ID needs.
 */
const CAST_RECEIVER_SDK_URL = 'https://www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js';

const SLIDESHOW_INTERVAL_MS = 6000;
// How many upcoming album items to fetch into the browser cache ahead of
// time, so advancing the slideshow can swap instantly instead of waiting on
// the network for each new photo.
const PRELOAD_AHEAD_COUNT = 2;

type DisplayItem = { url: string; type: 'photo' | 'video'; title?: string };

// If a video hasn't started playing within this long, assume the initial
// fetch/buffering stalled (large videos over a slow/congested Wi-Fi network
// are the main culprit) and force a fresh reload rather than leaving the
// screen stuck black indefinitely.
const VIDEO_STALL_TIMEOUT_MS = 15000;
const VIDEO_MAX_AUTO_RETRIES = 2;

export default function CastReceiver() {
  const [media, setMedia] = useState<CastMediaMessage | null>(null);
  const [albumIndex, setAlbumIndex] = useState(0);
  // The item currently rendered on screen. Deliberately kept separate from
  // the "target" item (whatever media/albumIndex say should show next) so
  // the previous photo/video stays visible — instead of a black gap — while
  // the next one loads in the background.
  const [displayedItem, setDisplayedItem] = useState<DisplayItem | null>(null);
  // Whether the current video has started rendering frames yet. Shown as a
  // spinner overlay instead of a bare black screen while a large video
  // buffers its first frame.
  const [videoBuffering, setVideoBuffering] = useState(false);
  const [videoError, setVideoError] = useState(false);
  // Raw MediaError detail (code + browser message) shown on screen so a
  // real playback failure can be diagnosed remotely, without needing to
  // plug the Cast device into a computer for devtools/remote debugging.
  const [videoErrorDetail, setVideoErrorDetail] = useState<string | null>(null);
  // Bumped to force the <video> element to remount (and thus re-fetch from
  // scratch) when the stall watchdog below fires.
  const [videoRetryToken, setVideoRetryToken] = useState(0);
  const videoRetryCountRef = useRef(0);
  const videoStallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoStartedRef = useRef(false);
  const slideshowTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const preloadCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const loadSdk = () =>
      new Promise<void>((resolve, reject) => {
        if ((window as any).cast?.framework?.CastReceiverContext) {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = CAST_RECEIVER_SDK_URL;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Cast Receiver SDK'));
        document.head.appendChild(script);
      });

    loadSdk()
      .then(() => {
        if (cancelled) return;
        const context = (window as any).cast.framework.CastReceiverContext.getInstance();

        context.addCustomMessageListener(CAST_NAMESPACE, (event: { data: CastMediaMessage }) => {
          setAlbumIndex(0);
          setMedia(event.data);
        });

        // This receiver never uses the standard Cast media session
        // (PlayerManager) — it's driven entirely by our own custom JSON
        // messages above, rendering plain <img>/<video> tags directly.
        // `disableIdleTimeout` is the officially documented flag for exactly
        // this scenario ("prevents the receiver from being closed when it
        // becomes idle after active playback stops... for non-media apps")
        // — without it, CastReceiverContext auto-closes the app once it
        // decides playback/activity has stopped, which was cutting casting
        // short right after a video finished.
        //
        // NOTE: we previously also set `options.skipPlayersLoad = true`,
        // reasoning that our plain <video> tag didn't need the CAF player
        // libraries. That turned out to be wrong: skipping them prevented
        // the Chromecast hardware's video decode/render pipeline from
        // attaching at all, so videos failed to play outright (a real
        // `error` event on the <video> element, previously invisible since
        // there was no error handling — it just showed as a black screen).
        // Do NOT re-add skipPlayersLoad.
        const options = new (window as any).cast.framework.CastReceiverOptions();
        options.disableIdleTimeout = true;
        context.start(options);
      })
      .catch((err) => console.error('[CastReceiver] Failed to initialize:', err));

    return () => { cancelled = true; };
  }, []);

  // Auto-advance the slideshow for 'album' casts.
  useEffect(() => {
    if (slideshowTimerRef.current) {
      clearInterval(slideshowTimerRef.current);
      slideshowTimerRef.current = null;
    }
    if (media?.type !== 'album' || !media.items || media.items.length <= 1) return;

    slideshowTimerRef.current = setInterval(() => {
      setAlbumIndex((prev) => (prev + 1) % (media.items?.length || 1));
    }, SLIDESHOW_INTERVAL_MS);

    return () => {
      if (slideshowTimerRef.current) clearInterval(slideshowTimerRef.current);
    };
  }, [media]);

  const targetItem: DisplayItem | null =
    media?.type === 'album'
      ? media.items?.[albumIndex]
        ? { ...media.items[albumIndex] }
        : null
      : media?.url
        ? { url: media.url, type: media.type, title: media.title }
        : null;

  // Only swap what's on screen once the target item has actually finished
  // loading (images: decoded via a background Image(); videos: shown
  // immediately since they buffer progressively via the <video> element
  // itself and can't be meaningfully "preloaded" the same way).
  useEffect(() => {
    if (!targetItem) {
      setDisplayedItem(null);
      return;
    }

    if (targetItem.type === 'video') {
      setDisplayedItem(targetItem);
      return;
    }

    let cancelled = false;
    const cache = preloadCacheRef.current;
    const cached = cache.get(targetItem.url);
    if (cached && cached.complete) {
      setDisplayedItem(targetItem);
      return;
    }

    const img = cached || new Image();
    img.src = targetItem.url;
    cache.set(targetItem.url, img);
    img.onload = () => { if (!cancelled) setDisplayedItem(targetItem); };
    // Show it anyway on error rather than getting stuck on the previous
    // photo forever — the <img> below will render its own broken-image icon.
    img.onerror = () => { if (!cancelled) setDisplayedItem(targetItem); };

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetItem?.url, targetItem?.type, targetItem?.title]);

  // Prefetch the next few album photos into the browser cache so that by
  // the time the slideshow timer advances to them, they display instantly.
  useEffect(() => {
    if (media?.type !== 'album' || !media.items || media.items.length === 0) return;
    const cache = preloadCacheRef.current;
    for (let i = 1; i <= PRELOAD_AHEAD_COUNT; i++) {
      const item = media.items[(albumIndex + i) % media.items.length];
      if (!item || item.type === 'video' || cache.has(item.url)) continue;
      const img = new Image();
      img.src = item.url;
      cache.set(item.url, img);
    }
  }, [media, albumIndex]);

  // Reset buffering/error/retry state whenever a new video is displayed, and
  // arm a watchdog: if it hasn't started playing within VIDEO_STALL_TIMEOUT_MS
  // (large videos over a slow/congested network are the main cause of a
  // stalled fetch), force the <video> element to remount and refetch rather
  // than leaving the screen stuck black indefinitely. The watchdog disarms
  // itself permanently once playback actually starts (see onPlaying below) —
  // it only guards against the *initial* load stalling.
  useEffect(() => {
    if (videoStallTimerRef.current) {
      clearTimeout(videoStallTimerRef.current);
      videoStallTimerRef.current = null;
    }

    if (displayedItem?.type !== 'video') return;

    setVideoBuffering(true);
    setVideoError(false);
    setVideoErrorDetail(null);
    videoRetryCountRef.current = 0;
    videoStartedRef.current = false;

    const armTimer = () => {
      videoStallTimerRef.current = setTimeout(() => {
        if (videoStartedRef.current) return;

        if (videoRetryCountRef.current < VIDEO_MAX_AUTO_RETRIES) {
          videoRetryCountRef.current += 1;
          setVideoRetryToken((prev) => prev + 1);
          armTimer();
        } else {
          setVideoBuffering(false);
          setVideoError(true);
        }
      }, VIDEO_STALL_TIMEOUT_MS);
    };
    armTimer();

    return () => {
      if (videoStallTimerRef.current) clearTimeout(videoStallTimerRef.current);
    };
  }, [displayedItem?.url, displayedItem?.type]);

  if (!displayedItem) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <p className="text-white/60 text-2xl font-light">Ready to cast</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      {displayedItem.type === 'video' ? (
        <video
          key={`${displayedItem.url}#${videoRetryToken}`}
          src={displayedItem.url}
          autoPlay
          controls={false}
          preload="auto"
          className="max-w-full max-h-full object-contain animate-fadeIn"
          onPlaying={() => {
            videoStartedRef.current = true;
            if (videoStallTimerRef.current) {
              clearTimeout(videoStallTimerRef.current);
              videoStallTimerRef.current = null;
            }
            setVideoBuffering(false);
          }}
          onWaiting={() => setVideoBuffering(true)}
          onCanPlay={() => setVideoBuffering(false)}
          onError={(e) => {
            if (videoStallTimerRef.current) {
              clearTimeout(videoStallTimerRef.current);
              videoStallTimerRef.current = null;
            }
            const mediaError = e.currentTarget.error;
            // MediaError.code: 1=ABORTED 2=NETWORK 3=DECODE 4=SRC_NOT_SUPPORTED
            const detail = mediaError
              ? `code ${mediaError.code}${mediaError.message ? `: ${mediaError.message}` : ''}`
              : 'unknown error';
            console.error('[CastReceiver] Video error:', detail, displayedItem.url);
            setVideoBuffering(false);
            setVideoError(true);
            setVideoErrorDetail(detail);
          }}
          onEnded={() => {
            if (media?.type === 'album' && media.items) {
              setAlbumIndex((prev) => (prev + 1) % media.items!.length);
            }
          }}
        />
      ) : (
        <img
          key={displayedItem.url}
          src={displayedItem.url}
          alt={displayedItem.title || ''}
          className="max-w-full max-h-full object-contain animate-fadeIn"
        />
      )}
      {/* Buffering spinner — shown while a (usually large) video hasn't
          rendered its first frame yet, instead of a bare black screen. */}
      {displayedItem.type === 'video' && videoBuffering && !videoError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}
      {displayedItem.type === 'video' && videoError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
          <p className="text-lg font-light">This video couldn't be loaded</p>
          {videoErrorDetail && (
            <p className="text-xs text-white/40 font-mono">{videoErrorDetail}</p>
          )}
        </div>
      )}
      {displayedItem.title && (
        <div className="absolute bottom-8 left-0 right-0 text-center text-white/80 text-lg font-light drop-shadow">
          {displayedItem.title}
        </div>
      )}
    </div>
  );
}
