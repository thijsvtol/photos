import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

/**
 * Subtle offline banner shown when network is unavailable.
 * Only displayed on native platforms to avoid confusion on web.
 */
export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    // Check initial state
    setIsOffline(!navigator.onLine);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Also use Capacitor Network plugin for more reliable detection
    import('@capacitor/network').then(({ Network }) => {
      Network.addListener('networkStatusChange', (status) => {
        setIsOffline(!status.connected);
      });
      Network.getStatus().then((status) => {
        setIsOffline(!status.connected);
      });
    }).catch(() => {});

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[70] bg-amber-500 text-white text-center py-1.5 px-4 text-xs font-medium flex items-center justify-center gap-1.5 shadow-sm">
      <WifiOff className="w-3.5 h-3.5" />
      <span>Geen internetverbinding — je ziet gecachte content</span>
    </div>
  );
}
