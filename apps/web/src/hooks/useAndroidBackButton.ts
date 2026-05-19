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

      // Photo detail → back to gallery
      if (path.startsWith('/p/')) {
        const parts = path.split('/');
        const slug = parts[2];
        if (slug) {
          navigate(`/events/${slug}`);
        } else {
          navigate(-1);
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
