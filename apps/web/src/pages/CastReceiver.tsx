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

export default function CastReceiver() {
  const [media, setMedia] = useState<CastMediaMessage | null>(null);
  const [albumIndex, setAlbumIndex] = useState(0);
  // The item currently rendered on screen. Deliberately kept separate from
  // the "target" item (whatever media/albumIndex say should show next) so
  // the previous photo/video stays visible — instead of a black gap — while
  // the next one loads in the background.
  const [displayedItem, setDisplayedItem] = useState<DisplayItem | null>(null);
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
        // Without this option, CastReceiverContext auto-closes the app once
        // it decides there's no active media session, which — since
        // there's never any further activity/messages while a single photo
        // or a long video just sits on screen — was cutting casting short,
        // most noticeably during video playback.
        const options = new (window as any).cast.framework.CastReceiverOptions();
        options.disableIdleTimeout = true;
        // CastReceiverOptions.mediaElement defaults to "the first media
        // element found in the page" — meaning CastReceiverContext was
        // auto-attaching its own PlayerManager/media-session machinery to
        // our plain <video> tag the moment one appeared, even though we
        // never issue an actual framework LOAD request for it. That's what
        // was cutting the cast session short shortly after a video's
        // 'ended' event fired (reproducible even with very short clips,
        // since the auto-managed "idle" state is reached almost
        // immediately once such a short video finishes). Skipping the
        // player library load entirely prevents PlayerManager from ever
        // attaching to/managing our video element, leaving playback fully
        // under our own control.
        options.skipPlayersLoad = true;
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
          key={displayedItem.url}
          src={displayedItem.url}
          autoPlay
          controls={false}
          className="max-w-full max-h-full object-contain animate-fadeIn"
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
      {displayedItem.title && (
        <div className="absolute bottom-8 left-0 right-0 text-center text-white/80 text-lg font-light drop-shadow">
          {displayedItem.title}
        </div>
      )}
    </div>
  );
}
