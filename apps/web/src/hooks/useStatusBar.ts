import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';

/**
 * Dynamically style the Android status bar based on current route.
 * - Photo viewer: transparent with light icons (white)
 * - Other pages: white background with dark icons
 */
export function useStatusBar() {
  const location = useLocation();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const isPhotoDetail = location.pathname.startsWith('/p/');

    import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
      if (isPhotoDetail) {
        StatusBar.setStyle({ style: Style.Dark }); // light icons on dark bg
        StatusBar.setBackgroundColor({ color: '#000000' });
      } else {
        StatusBar.setStyle({ style: Style.Light }); // dark icons on light bg
        StatusBar.setBackgroundColor({ color: '#ffffff' });

        // Check for dark mode
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          StatusBar.setStyle({ style: Style.Dark });
          StatusBar.setBackgroundColor({ color: '#1f2937' }); // gray-800
        }
      }
    }).catch(() => {
      // StatusBar plugin not available
    });
  }, [location.pathname]);
}
