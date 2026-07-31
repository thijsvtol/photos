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

export default function CastReceiver() {
  const [media, setMedia] = useState<CastMediaMessage | null>(null);
  const [albumIndex, setAlbumIndex] = useState(0);
  const slideshowTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

        context.start();
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

  if (!media) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <p className="text-white/60 text-2xl font-light">Ready to cast</p>
      </div>
    );
  }

  const currentItem =
    media.type === 'album'
      ? media.items?.[albumIndex]
      : { url: media.url!, type: media.type, title: media.title };

  if (!currentItem) return null;

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      {currentItem.type === 'video' ? (
        <video
          key={currentItem.url}
          src={currentItem.url}
          autoPlay
          controls={false}
          className="max-w-full max-h-full object-contain"
          onEnded={() => {
            if (media.type === 'album' && media.items) {
              setAlbumIndex((prev) => (prev + 1) % media.items!.length);
            }
          }}
        />
      ) : (
        <img
          key={currentItem.url}
          src={currentItem.url}
          alt={currentItem.title || ''}
          className="max-w-full max-h-full object-contain"
        />
      )}
      {currentItem.title && (
        <div className="absolute bottom-8 left-0 right-0 text-center text-white/80 text-lg font-light drop-shadow">
          {currentItem.title}
        </div>
      )}
    </div>
  );
}
