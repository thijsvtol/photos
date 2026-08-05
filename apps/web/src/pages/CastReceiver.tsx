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

// Percentage insets drawn by the ?debug=1 calibration overlay. Originally
// added on the theory that the TV was cropping edges via overscan; the Nest
// Hub then showed every ring down to 0% while the Google TV showed none at
// all, which ruled that out (overscan trims edges, it cannot hide the middle
// of the screen). Kept because the rings remain the quickest way to eyeball
// whether the stage matches the visible display on a given device.
const OVERSCAN_GUIDES = [
  { pct: 0, color: '#ef4444' },
  { pct: 2.5, color: '#f97316' },
  { pct: 5, color: '#eab308' },
  { pct: 7.5, color: '#22c55e' },
  { pct: 10, color: '#06b6d4' },
];

/**
 * Diagnostic overlay, enabled with ?debug=1 on the receiver URL.
 *
 * A TV can't practically be inspected with devtools — enabling remote
 * debugging and connecting to the device's port 9222 is a lot of ceremony to
 * read four numbers — so the receiver reports its own geometry on screen
 * instead. The corner markers and the tiled (rather than centred) readouts
 * exist because the failure mode being chased made the centre of the page
 * fall outside the visible area entirely.
 */
function OverscanDebugOverlay({ stage }: { stage: { w: number; h: number } }) {
  const [metrics, setMetrics] = useState(() => readMetrics());

  useEffect(() => {
    const onResize = () => setMetrics(readMetrics());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div
      className="z-[9999] pointer-events-none"
      style={{ position: 'fixed', left: 0, top: 0, width: stage.w, height: stage.h }}
    >
      {OVERSCAN_GUIDES.map(({ pct, color }) => (
        <div
          key={pct}
          className="absolute flex items-start justify-start"
          style={{ inset: `${pct}%`, border: `2px solid ${color}` }}
        >
          <span
            className="text-base font-mono font-bold px-1.5 py-0.5"
            style={{ color: '#000', backgroundColor: color }}
          >
            {pct}%
          </span>
        </div>
      ))}
      {/* Corner markers. If the TV only shows one of these, the visible area
          is an off-centre crop of a larger layout — which tells us far more
          than the ring numbers do. */}
      {CORNER_MARKERS.map(({ label, cls }) => (
        <div
          key={label}
          className={`absolute ${cls} bg-white text-black font-mono font-bold text-3xl px-3 py-1`}
        >
          {label}
        </div>
      ))}
      {/* The readout is tiled across nine positions rather than centred once,
          because on a mismatched viewport the centre of the page can fall
          entirely outside what the TV displays — as it did on the first
          attempt, where nothing at all was visible. At least one copy should
          land in view wherever the crop happens to sit. */}
      {READOUT_POSITIONS.map((cls) => (
        <div
          key={cls}
          className={`absolute ${cls} bg-black/85 text-white font-mono text-base leading-snug px-4 py-3 rounded-lg`}
        >
          <div>inner&nbsp;&nbsp;{metrics.innerW} x {metrics.innerH}</div>
          <div>client&nbsp;{metrics.clientW} x {metrics.clientH}</div>
          <div>visual {metrics.visualW} x {metrics.visualH}</div>
          <div>vscale {metrics.visualScale}</div>
          <div>voff&nbsp;&nbsp;&nbsp;{metrics.visualOffX} , {metrics.visualOffY}</div>
          <div>screen {metrics.screenW} x {metrics.screenH}</div>
          <div>dpr&nbsp;&nbsp;&nbsp;&nbsp;{metrics.dpr}</div>
        </div>
      ))}
    </div>
  );
}

const CORNER_MARKERS = [
  { label: 'TL', cls: 'top-0 left-0' },
  { label: 'TR', cls: 'top-0 right-0' },
  { label: 'BL', cls: 'bottom-0 left-0' },
  { label: 'BR', cls: 'bottom-0 right-0' },
];

const READOUT_POSITIONS = [
  'top-[6%] left-[6%]',
  'top-[6%] left-1/2 -translate-x-1/2',
  'top-[6%] right-[6%]',
  'top-1/2 left-[6%] -translate-y-1/2',
  'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
  'top-1/2 right-[6%] -translate-y-1/2',
  'bottom-[6%] left-[6%]',
  'bottom-[6%] left-1/2 -translate-x-1/2',
  'bottom-[6%] right-[6%]',
];

function readMetrics() {
  const vv = window.visualViewport;
  return {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    clientW: document.documentElement.clientWidth,
    clientH: document.documentElement.clientHeight,
    screenW: window.screen?.width ?? 0,
    screenH: window.screen?.height ?? 0,
    // The decisive pair: visualViewport is what's actually *shown*, while
    // innerWidth/clientWidth are the layout viewport. If these disagree, the
    // TV is displaying a magnified crop of a larger layout — a viewport
    // mismatch, not overscan, and no amount of title-safe inset would fix it.
    visualW: vv ? Math.round(vv.width) : -1,
    visualH: vv ? Math.round(vv.height) : -1,
    visualScale: vv ? vv.scale : -1,
    visualOffX: vv ? Math.round(vv.offsetLeft) : -1,
    visualOffY: vv ? Math.round(vv.offsetTop) : -1,
    dpr: window.devicePixelRatio,
  };
}

/**
 * The receiver's stage size, in real pixels, remeasured on resize.
 *
 * Everything here used to be sized with `fixed inset-0` + `max-w-full
 * max-h-full`, which is percentage-based: it only constrains the media if the
 * engine resolves 100% against the viewport. On the Google TV receiver it
 * doesn't — a large photo expanded the document past the display, the page
 * was re-laid-out at content size, and the TV ended up showing a magnified
 * top-left corner (the Nest Hub, with a smaller panel and a saner engine, was
 * unaffected). Tellingly, the debug overlay rendered correctly right up until
 * the moment an <img> decoded.
 *
 * Sizing the stage and the media in explicit pixels removes the dependency on
 * how the engine resolves percentages entirely.
 */
function useStageSize() {
  const [size, setSize] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));

  useEffect(() => {
    const measure = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  return size;
}

/**
 * Belt-and-braces companion to useStageSize: forbid scrolling/overflow at the
 * document level for as long as the receiver is mounted, so no oversized
 * child can grow the layout viewport in the first place. Restores whatever
 * was there before on unmount, since this route shares a SPA with the normal
 * scrolling gallery pages.
 */
function useLockedDocumentOverflow() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyMargin: body.style.margin,
    };

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.margin = '0';

    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.margin = prev.bodyMargin;
    };
  }, []);
}

function useDebugFlag(): boolean {
  const [enabled] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('debug') === '1';
    } catch {
      return false;
    }
  });
  return enabled;
}

export default function CastReceiver() {
  const debug = useDebugFlag();
  const stage = useStageSize();
  useLockedDocumentOverflow();
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

  // Explicit pixel dimensions rather than `inset-0`, and `overflow-hidden` so
  // nothing inside can ever paint outside the stage — see useStageSize.
  const stageStyle: React.CSSProperties = {
    position: 'fixed',
    left: 0,
    top: 0,
    width: stage.w,
    height: stage.h,
    overflow: 'hidden',
  };
  const mediaStyle: React.CSSProperties = {
    maxWidth: stage.w,
    maxHeight: stage.h,
  };

  if (!displayedItem) {
    return (
      <div style={stageStyle} className="bg-black flex items-center justify-center">
        <p className="text-white/60 text-2xl font-light">Ready to cast</p>
        {debug && <OverscanDebugOverlay stage={stage} />}
      </div>
    );
  }

  return (
    <div style={stageStyle} className="bg-black flex items-center justify-center">
      {/* Blurred backdrop — fills the letterbox bars left by object-contain
          with a scaled, blurred copy of the same photo, so a 3:2 photo on a
          16:9 TV doesn't read as half-empty. Deliberately photos only: a
          second <video> element would double the decode load on the
          Chromecast's hardware pipeline for a purely cosmetic effect.
          scale-110 hides the transparent edges the blur would otherwise
          feather in. The foreground below needs `relative` so it paints on
          top of this positioned element. */}
      {displayedItem.type === 'photo' && (
        <img
          key={`backdrop-${displayedItem.url}`}
          src={displayedItem.url}
          alt=""
          aria-hidden="true"
          style={{ position: 'absolute', left: 0, top: 0, width: stage.w, height: stage.h }}
          className="object-cover scale-110 blur-2xl brightness-50"
        />
      )}
      {displayedItem.type === 'video' ? (
        <video
          key={`${displayedItem.url}#${videoRetryToken}`}
          src={displayedItem.url}
          autoPlay
          controls={false}
          preload="auto"
          style={mediaStyle}
          className="relative object-contain animate-fadeIn"
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
          style={mediaStyle}
          className="relative object-contain animate-fadeIn"
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
      {debug && <OverscanDebugOverlay stage={stage} />}
    </div>
  );
}
