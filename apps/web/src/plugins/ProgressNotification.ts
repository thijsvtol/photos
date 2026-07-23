import { registerPlugin } from '@capacitor/core';

export interface ProgressNotificationPlugin {
  show(options: {
    id: number;
    title: string;
    body: string;
    largeBody?: string;
    progress: number;
    maxProgress: number;
    indeterminate?: boolean;
    ongoing?: boolean;
    eventSlug?: string;
  }): Promise<void>;

  cancel(options: { id: number }): Promise<void>;

  /** Start a foreground service (Android only) that keeps the app process
   *  alive and network access unrestricted while uploads are in progress,
   *  so uploads survive the app being backgrounded/screen locked instead of
   *  being aborted with generic network errors. Uses the same notification
   *  id as show(), so only a single notification is displayed. No-op on
   *  platforms other than Android. */
  startForeground(options: { id: number; title: string; body: string }): Promise<void>;

  /** Stop the upload foreground service started by startForeground(). */
  stopForeground(): Promise<void>;
}

const ProgressNotification = registerPlugin<ProgressNotificationPlugin>('ProgressNotification', {
  web: () => {
    // Web fallback - just returns empty implementations
    return {
      show: async () => {},
      cancel: async () => {},
      startForeground: async () => {},
      stopForeground: async () => {},
    };
  },
});

export default ProgressNotification;
