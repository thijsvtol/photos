import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

/**
 * Handle Android hardware back button.
 * - On photo detail: go back to gallery
 * - On gallery: go back to event list
 * - On event list/home: minimize app
 */
export function useAndroidBackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handler = App.addListener('backButton', ({ canGoBack }) => {
      const path = location.pathname;

      // Photo detail → close the overlay, back to gallery/timeline/favorites.
      // Prefer a real history pop (navigate(-1)) over pushing a fresh route: PhotoDetail always
      // arrives via a push from the gallery/timeline/favorites view (and uses `replace: true`
      // when swiping between photos), so history[-1] is exactly that originating view — which,
      // under the background-location overlay routing (see App.tsx), never actually unmounted,
      // so popping back to it is instant with no re-fetch/scroll-restore needed.
      if (path.startsWith('/p/')) {
        if (canGoBack) {
          navigate(-1);
          return;
        }

        const state = location.state as { backgroundLocation?: { pathname: string; search: string } } | null;
        if (state?.backgroundLocation) {
          navigate(`${state.backgroundLocation.pathname}${state.backgroundLocation.search}`);
        } else {
          const parts = path.split('/');
          const slug = parts[2];
          if (slug) {
            navigate(`/events/${slug}`);
          } else {
            // No history to pop (canGoBack is false) and no slug to build a
            // gallery URL from (malformed path) — there's nowhere sensible
            // to go back to, so fall back to the top-level events list.
            navigate('/events');
          }
        }
        return;
      }

      // Event gallery → event list
      if (path.startsWith('/events/') && path !== '/events') {
        navigate('/events');
        return;
      }

      // Share upload → back
      if (path === '/share-upload') {
        navigate('/events');
        return;
      }

      // Map, favorites, timeline, etc. → event list
      if (['/map', '/favorites', '/timeline', '/usage'].includes(path)) {
        navigate('/events');
        return;
      }

      // Root pages → minimize app
      if (path === '/' || path === '/events') {
        App.minimizeApp();
        return;
      }

      // Fallback
      if (canGoBack) {
        navigate(-1);
      } else {
        App.minimizeApp();
      }
    });

    return () => {
      handler.then(h => h.remove());
    };
  }, [navigate, location.pathname]);
}
