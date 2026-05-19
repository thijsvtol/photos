import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'nl.thijsvtol.photos',
  appName: 'TvT Photos',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_notification",
      iconColor: "#488AFF",
    },
    BackgroundTask: {
      interval: 900, // 15 minutes in seconds
    },
    App: {
      appUrlScheme: 'photos',
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 0,
      backgroundColor: '#ffffff',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#ffffff',
    },
  },
  android: {
    path: '../android',
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
  },
  projectId: 'photos-app',
};

export default config;
