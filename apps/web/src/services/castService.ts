/**
 * Google Cast integration.
 *
 * Two very different environments need two very different approaches:
 *
 * - WEB (desktop/mobile browser): Chrome (and Chromium-based browsers) expose
 *   the standard Cast Web Sender SDK (`chrome.cast` / `cast.framework`) via a
 *   script tag. This works out of the box with no native code — the browser
 *   itself handles device discovery and the cast session.
 *
 * - NATIVE ANDROID APP (Capacitor WebView): a generic Android WebView does
 *   NOT implement `chrome.cast` — that API only exists inside the Chrome
 *   browser app itself. So casting from the native app requires a real native
 *   Capacitor plugin (see android/.../plugins/CastPlugin.java) that wraps
 *   Google's native Cast SDK (`play-services-cast-framework`) and exposes a
 *   thin JS bridge with the same shape as the web path below, so callers
 *   (CastButton) don't need to care which platform they're on.
 *
 * Both paths ultimately load the SAME custom receiver app (a page in this
 * SPA, see pages/CastReceiver.tsx) running on the Chromecast device, and send
 * it simple JSON messages over a custom namespace to say what to display.
 */
import { Capacitor } from '@capacitor/core';

/** Custom message namespace shared with pages/CastReceiver.tsx. */
export const CAST_NAMESPACE = 'urn:x-cast:nl.thijsvtol.photos';

export interface CastMediaMessage {
  type: 'photo' | 'video' | 'album';
  /** Direct preview/original URL for a single photo/video. */
  url?: string;
  title?: string;
  /** For 'album': ordered list of photo/video URLs + metadata for a slideshow. */
  items?: Array<{ url: string; type: 'photo' | 'video'; title?: string }>;
}

interface NativeCastPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  startDiscovery(): Promise<void>;
  loadMedia(options: { message: string }): Promise<void>;
  endSession(): Promise<void>;
  addListener(eventName: 'sessionStateChanged', cb: (data: { connected: boolean; deviceName?: string }) => void): Promise<{ remove: () => void }>;
}

type CastAvailabilityListener = (available: boolean) => void;
type CastSessionListener = (connected: boolean, deviceName?: string) => void;

const CAST_SENDER_SCRIPT_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

class CastService {
  private availabilityListeners = new Set<CastAvailabilityListener>();
  private sessionListeners = new Set<CastSessionListener>();
  private available = false;
  private connected = false;
  private initialised = false;
  private nativePlugin: NativeCastPlugin | null = null;

  /** App ID for the custom receiver, registered by the site owner in the
   *  Google Cast SDK Developer Console (https://cast.google.com/publish).
   *  Casting is simply unavailable (button hidden) until this is configured. */
  private get appId(): string | undefined {
    return import.meta.env.VITE_CAST_APP_ID as string | undefined;
  }

  isAvailable(): boolean {
    return this.available;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onAvailabilityChange(listener: CastAvailabilityListener): () => void {
    this.availabilityListeners.add(listener);
    listener(this.available);
    return () => { this.availabilityListeners.delete(listener); };
  }

  onSessionChange(listener: CastSessionListener): () => void {
    this.sessionListeners.add(listener);
    listener(this.connected);
    return () => { this.sessionListeners.delete(listener); };
  }

  private setAvailable(value: boolean) {
    if (this.available === value) return;
    this.available = value;
    for (const l of this.availabilityListeners) l(value);
  }

  private setConnected(value: boolean) {
    if (this.connected === value) return;
    this.connected = value;
    for (const l of this.sessionListeners) l(value);
  }

  /** Idempotent — safe to call from multiple components' effects. */
  async init(): Promise<void> {
    if (this.initialised) return;
    this.initialised = true;

    if (!this.appId) {
      // No receiver Application ID configured — casting stays hidden rather
      // than showing a button that can never actually connect anywhere.
      return;
    }

    if (Capacitor.isNativePlatform()) {
      await this.initNative();
    } else {
      this.initWeb();
    }
  }

  private initWeb() {
    (window as unknown as { __onGCastApiAvailable?: (isAvailable: boolean) => void }).__onGCastApiAvailable = (isAvailable: boolean) => {
      if (!isAvailable) return;
      try {
        const cast = (window as any).cast;
        const chrome = (window as any).chrome;
        cast.framework.CastContext.getInstance().setOptions({
          receiverApplicationId: this.appId,
          autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });
        this.setAvailable(true);

        cast.framework.CastContext.getInstance().addEventListener(
          cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
          (event: { sessionState: string }) => {
            const session = cast.framework.CastContext.getInstance().getCurrentSession();
            // Parenthesized explicitly — without it, `||` has lower
            // precedence than `&&`, so this used to evaluate as
            // `(!!session && STARTED) || RESUMED`, meaning a RESUMED event
            // set connected=true even with no session, and a null session
            // during a STARTED event fell through unintentionally.
            this.setConnected(!!session && (
              event.sessionState === cast.framework.SessionState.SESSION_STARTED
              || event.sessionState === cast.framework.SessionState.SESSION_RESUMED
            ));
          }
        );
      } catch (err) {
        console.error('[castService] Failed to initialize Cast Web Sender SDK:', err);
      }
    };

    if (!document.querySelector(`script[src="${CAST_SENDER_SCRIPT_URL}"]`)) {
      const script = document.createElement('script');
      script.src = CAST_SENDER_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  }

  private async initNative() {
    try {
      const { registerPlugin } = await import('@capacitor/core');
      const plugin = registerPlugin<NativeCastPlugin>('Cast');
      this.nativePlugin = plugin;

      const { available } = await plugin.isAvailable();
      this.setAvailable(available);
      if (!available) return;

      await plugin.addListener('sessionStateChanged', ({ connected }) => {
        this.setConnected(connected);
      });
    } catch (err) {
      console.warn('[castService] Native Cast plugin not available:', err);
      this.setAvailable(false);
    }
  }

  /** Send the current photo/video/album to the connected receiver. */
  async loadMedia(message: CastMediaMessage): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      if (!this.nativePlugin) throw new Error('Cast plugin not initialized');
      await this.nativePlugin.loadMedia({ message: JSON.stringify(message) });
      return;
    }

    const cast = (window as any).cast;
    const session = cast?.framework?.CastContext?.getInstance()?.getCurrentSession();
    if (!session) throw new Error('No active Cast session');
    await session.sendMessage(CAST_NAMESPACE, message);
  }

  /** Opens the browser's native cast device picker (web) or starts native
   *  discovery (Android app). */
  async requestSession(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      if (!this.nativePlugin) throw new Error('Cast plugin not initialized');
      await this.nativePlugin.startDiscovery();
      return;
    }

    const cast = (window as any).cast;
    if (!cast) throw new Error('Cast SDK not loaded');
    await cast.framework.CastContext.getInstance().requestSession();
  }

  async endSession(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await this.nativePlugin?.endSession();
      return;
    }
    const cast = (window as any).cast;
    cast?.framework?.CastContext?.getInstance()?.getCurrentSession()?.endSession(true);
  }
}

export const castService = new CastService();
