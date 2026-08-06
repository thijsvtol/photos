import React, { useEffect, useState, useCallback } from 'react';
import { Cast } from 'lucide-react';
import { castService, type CastMediaMessage } from '../services/castService';
import { ensureCastToken } from '../api';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';

interface CastButtonProps {
  /** Builds the message to send once a cast session is (or becomes) active.
   *  Called lazily so the current photo/album can be resolved at click time. */
  getMedia: () => CastMediaMessage;
  /** Event slug the media belongs to. Used to fetch an event-scoped auth
   *  token before starting a session, so the receiver (running unauthenticated
   *  on the TV) can load protected media for private/password-protected events. */
  slug: string;
  className?: string;
  /** Compact icon-only rendering (e.g. inside the PhotoDetail action bar) vs.
   *  a labeled button (e.g. in the gallery toolbar). */
  variant?: 'icon' | 'labeled';
}

/**
 * Cast button — only rendered once the Cast SDK/native plugin reports a
 * receiver is actually reachable (or, on native, once the plugin says the
 * device supports casting at all). Hidden entirely if no receiver
 * Application ID is configured (see castService.init/VITE_CAST_APP_ID) so it
 * never dead-ends the user in an environment where casting can't work.
 */
export const CastButton: React.FC<CastButtonProps> = ({ getMedia, slug, className = '', variant = 'icon' }) => {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  useEffect(() => {
    castService.init().catch((err) => console.error('[CastButton] init failed:', err));
    const unsubAvail = castService.onAvailabilityChange(setAvailable);
    const unsubSession = castService.onSessionChange(setConnected);
    return () => { unsubAvail(); unsubSession(); };
  }, []);

  const handleClick = useCallback(async () => {
    if (castService.isConnected()) {
      const ok = await confirm('Stop casting?', 'This will disconnect from the cast device.', {
        confirmText: 'Stop casting',
        variant: 'danger',
      });
      if (!ok) return;

      setBusy(true);
      try {
        await castService.endSession();
      } catch (err) {
        console.error('[CastButton] Failed to stop casting:', err);
        toast.showError('Failed to stop casting.');
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      // Ensure we have a valid auth token cached for this event *before* the
      // receiver launches — it runs in an unauthenticated browser context on
      // the TV, so it can't rely on our cookies/headers itself.
      await ensureCastToken(slug);
      await castService.requestSession();
      await castService.loadMedia(getMedia());
    } catch (err) {
      console.error('[CastButton] Cast action failed:', err);
      toast.showError('Failed to start casting. Make sure a Chromecast device is on the same network.');
    } finally {
      setBusy(false);
    }
  }, [getMedia, slug, toast, confirm]);

  if (!available) return null;

  if (variant === 'labeled') {
    return (
      <>
      <button
        onClick={handleClick}
        disabled={busy}
        className={`flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 text-sm font-medium rounded-full transition-colors disabled:opacity-60 ${
          connected ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
        } ${className}`}
      >
        <Cast className="w-4 h-4 sm:w-5 sm:h-5" />
        <span className="hidden sm:inline">{connected ? 'Casting' : 'Cast'}</span>
      </button>
      {ConfirmDialog}
      </>
    );
  }

  return (
    <>
    <button
      onClick={handleClick}
      disabled={busy}
      title={connected ? 'Stop casting' : 'Cast to device'}
      className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-95 disabled:opacity-60 ${
        connected ? 'text-blue-400' : 'text-white/90 hover:bg-white/10'
      } ${className}`}
    >
      <Cast className="w-6 h-6" />
      <span className="text-[10px] font-medium">{connected ? 'Casting' : 'Cast'}</span>
    </button>
    {ConfirmDialog}
    </>
  );
};

export default CastButton;
