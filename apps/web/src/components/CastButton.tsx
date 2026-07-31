import React, { useEffect, useState, useCallback } from 'react';
import { Cast } from 'lucide-react';
import { castService, type CastMediaMessage } from '../services/castService';
import { useToast } from './Toast';

interface CastButtonProps {
  /** Builds the message to send once a cast session is (or becomes) active.
   *  Called lazily so the current photo/album can be resolved at click time. */
  getMedia: () => CastMediaMessage;
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
export const CastButton: React.FC<CastButtonProps> = ({ getMedia, className = '', variant = 'icon' }) => {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    castService.init().catch((err) => console.error('[CastButton] init failed:', err));
    const unsubAvail = castService.onAvailabilityChange(setAvailable);
    const unsubSession = castService.onSessionChange(setConnected);
    return () => { unsubAvail(); unsubSession(); };
  }, []);

  const handleClick = useCallback(async () => {
    setBusy(true);
    try {
      if (!castService.isConnected()) {
        await castService.requestSession();
      }
      await castService.loadMedia(getMedia());
    } catch (err) {
      console.error('[CastButton] Cast action failed:', err);
      toast.showError('Failed to start casting. Make sure a Chromecast device is on the same network.');
    } finally {
      setBusy(false);
    }
  }, [getMedia, toast]);

  if (!available) return null;

  if (variant === 'labeled') {
    return (
      <button
        onClick={handleClick}
        disabled={busy}
        className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-full transition disabled:opacity-60 ${
          connected ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
        } ${className}`}
      >
        <Cast className="w-4 h-4" />
        {connected ? 'Casting' : 'Cast'}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      title={connected ? 'Casting to device' : 'Cast to device'}
      className={`flex flex-col items-center gap-1 p-2 rounded-xl transition active:scale-95 disabled:opacity-60 ${
        connected ? 'text-blue-400' : 'text-white/90 hover:bg-white/10'
      } ${className}`}
    >
      <Cast className="w-6 h-6" />
      <span className="text-[10px] font-medium">{connected ? 'Casting' : 'Cast'}</span>
    </button>
  );
};

export default CastButton;
