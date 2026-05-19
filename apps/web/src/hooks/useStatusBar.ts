import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';

/**
 * Dynamically style the Android status bar for the photo viewer only.
 * - Photo viewer: black background with light (white) icons
 * - All other pages: default (white background, dark icons) — set once on mount
 */
export function useStatusBar() {
  const location = useLocation();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const isPhotoDetail = location.pathname.startsWith('/p/');

    import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
      if (isPhotoDetail) {
        StatusBar.setStyle({ style: Style.Dark });
        StatusBar.setBackgroundColor({ color: '#000000' });
      } else {
        StatusBar.setStyle({ style: Style.Light });
        StatusBar.setBackgroundColor({ color: '#ffffff' });
      }
    }).catch(() => {});
  }, [location.pathname]);
}
