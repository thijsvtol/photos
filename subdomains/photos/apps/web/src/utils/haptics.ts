import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/**
 * Haptic feedback utilities for native mobile apps
 * Gracefully degrades to no-op on web
 */

export const haptics = {
  /**
   * Light impact - for selections, button taps
   */
  light: async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (e) {
      // Silently fail if haptics not available
    }
  },

  /**
   * Medium impact - for important actions
   */
  medium: async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (e) {
      // Silently fail
    }
  },

  /**
   * Heavy impact - for major actions, errors
   */
  heavy: async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Heavy });
    } catch (e) {
      // Silently fail
    }
  },

  /**
   * Success notification - for successful operations
   */
  success: async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch (e) {
      // Silently fail
    }
  },

  /**
   * Warning notification - for warnings
   */
  warning: async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.notification({ type: NotificationType.Warning });
    } catch (e) {
      // Silently fail
    }
  },

  /**
   * Error notification - for errors
   */
  error: async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.notification({ type: NotificationType.Error });
    } catch (e) {
      // Silently fail
    }
  },

  /**
   * Selection changed - for selection toggles
   */
  selectionChanged: async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await Haptics.selectionChanged();
    } catch (e) {
      // Silently fail
    }
  },
};
