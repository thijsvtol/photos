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
}

const ProgressNotification = registerPlugin<ProgressNotificationPlugin>('ProgressNotification', {
  web: () => {
    // Web fallback - just returns empty implementations
    return {
      show: async () => {},
      cancel: async () => {},
    };
  },
});

export default ProgressNotification;
