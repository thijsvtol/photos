import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'nl.thijsvtol.photos',
  appName: 'Photos',
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
  },
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
  },
  projectId: 'photos-app',
};

export default config;
