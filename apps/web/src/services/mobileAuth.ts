import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { getConfig } from '../config';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const EVENT_SESSIONS_KEY = 'event_sessions';
const LOCAL_TOKEN_KEY = 'mobile_bearer_token';

export interface AuthToken {
  token: string;
  expiresAt: number;
}

export interface StoredUser {
  id: string;
  email: string;
  name?: string;
  isAdmin?: boolean;
}

/**
 * Mobile OAuth Authentication Service
 * 
 * Flow:
 * 1. App opens browser to: <your-domain>/mobile-auth
 * 2. User authenticates via Cloudflare Access
 * 3. Backend generates OAuth token
 * 4. Browser redirects to: photos://auth/callback?token=xxx&expires=xxx
 * 5. App captures deep link, stores token
 * 6. All API requests use: Authorization: Bearer <token>
 */
export class MobileAuthService {
  private static tokenCallbackResolve: ((token: AuthToken | null) => void) | null = null;

  private static getEventSessionStorageKey(eventSlug: string): string {
    return `event_session_${eventSlug}`;
  }

  /**
   * Initialize deep link listener
   */
  static async initialize() {
    // Listen for deep link callbacks
    App.addListener('appUrlOpen', (event) => {
      console.log('[MobileAuth] Deep link received:', event.url);
      
      if (event.url.startsWith('photos://auth/callback')) {
        this.handleAuthCallback(event.url);
        return;
      }

      // Collaboration invite link opened directly in the app
      // (photos://invite/TOKEN) — hand off to the router via the same
      // custom-event pattern used for notification taps (see App.tsx).
      if (event.url.startsWith('photos://invite/')) {
        const token = event.url.replace('photos://invite/', '').split(/[/?#]/)[0];
        if (token) {
          window.dispatchEvent(new CustomEvent('navigateToInvite', { detail: { token } }));
        }
      }
    });
  }

  /**
   * Start OAuth flow - opens browser for authentication
   */
  static async startAuthFlow(): Promise<AuthToken | null> {
    return new Promise((resolve) => {
      const run = async () => {
        // Store resolve callback for deep link handler
        this.tokenCallbackResolve = resolve;

        // Generate random state for CSRF protection
        const state = Math.random().toString(36).substring(7);
        await Preferences.set({ key: 'oauth_state', value: state });

        const config = getConfig();
        // Use domain instead of apiUrl to avoid double /api prefix
        const domain = config.domain.startsWith('http') ? config.domain : `https://${config.domain}`;
        const authUrl = `${domain}/api/mobile-login?state=${state}`;

        try {
          await Browser.open({
            url: authUrl,
            presentationStyle: 'popover'
          });
        } catch (error) {
          console.error('[MobileAuth] Failed to open browser:', error);
          resolve(null);
        }

        // Timeout after 5 minutes
        setTimeout(() => {
          if (this.tokenCallbackResolve === resolve) {
            console.log('[MobileAuth] Auth flow timeout');
            this.tokenCallbackResolve = null;
            resolve(null);
          }
        }, 300000);
      };

      void run();
    });
  }

  /**
   * Handle deep link callback from browser
   */
  private static async handleAuthCallback(url: string) {
    try {
      const urlObj = new URL(url);
      const token = urlObj.searchParams.get('token');
      const expiresIn = urlObj.searchParams.get('expires');
      const state = urlObj.searchParams.get('state');
      const userData = urlObj.searchParams.get('user');

      // Verify state (CSRF protection)
      const { value: storedState } = await Preferences.get({ key: 'oauth_state' });
      if (state !== storedState) {
        console.error('[MobileAuth] Invalid state parameter');
        this.tokenCallbackResolve?.(null);
        return;
      }

      if (!token || !expiresIn) {
        console.error('[MobileAuth] Missing token or expires parameter');
        this.tokenCallbackResolve?.(null);
        return;
      }

      const authToken: AuthToken = {
        token,
        expiresAt: Date.now() + (parseInt(expiresIn) * 1000)
      };

      // Store token securely
      await this.storeToken(authToken);

      // Store user data if provided
      if (userData) {
        const user = JSON.parse(decodeURIComponent(userData));
        await this.storeUser(user);
      }

      console.log('[MobileAuth] Token stored successfully');
      this.tokenCallbackResolve?.(authToken);
      this.tokenCallbackResolve = null;

      // Close browser
      await Browser.close();
    } catch (error) {
      console.error('[MobileAuth] Error handling callback:', error);
      this.tokenCallbackResolve?.(null);
      this.tokenCallbackResolve = null;
    }
  }

  /**
   * Store auth token
   */
  static async storeToken(token: AuthToken) {
    await Preferences.set({
      key: TOKEN_KEY,
      value: JSON.stringify(token)
    });
    // Mirror to localStorage for synchronous access in image URL construction
    localStorage.setItem(LOCAL_TOKEN_KEY, token.token);
    // The native folder-sync engine reads this same Preferences entry, but it
    // also needs the API base URL (a web-side build/runtime concern) and a
    // nudge to reschedule — a background run that started while signed out
    // would otherwise stay idle until the app happened to be opened again.
    await this.notifyFolderSyncEngine();
  }

  /**
   * Re-pushes config to the native folder-sync engine after an auth change.
   *
   * Best-effort and non-blocking by design: sign-in and sign-out must never
   * fail because folder sync is unavailable (web platform, plugin missing).
   */
  private static async notifyFolderSyncEngine() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const { default: FolderSync } = await import('./folderSyncPlugin');
      await FolderSync.configure({ apiBaseUrl: getConfig().apiUrl });
    } catch (err) {
      console.warn('[MobileAuth] Failed to notify folder sync engine:', err);
    }
  }

  /**
   * Get stored auth token
   */
  static async getToken(): Promise<string | null> {
    const { value } = await Preferences.get({ key: TOKEN_KEY });
    if (!value) return null;

    try {
      const token: AuthToken = JSON.parse(value);
      
      // Check if expired
      if (token.expiresAt < Date.now()) {
        console.log('[MobileAuth] Token expired');
        await this.clearToken();
        return null;
      }

      // Ensure localStorage mirror is in sync for image URL construction
      if (localStorage.getItem(LOCAL_TOKEN_KEY) !== token.token) {
        localStorage.setItem(LOCAL_TOKEN_KEY, token.token);
      }

      return token.token;
    } catch (error) {
      console.error('[MobileAuth] Error parsing token:', error);
      return null;
    }
  }

  /**
   * Store user data
   */
  static async storeUser(user: StoredUser) {
    await Preferences.set({
      key: USER_KEY,
      value: JSON.stringify(user)
    });
  }

  /**
   * Get stored user data
   */
  static async getUser(): Promise<StoredUser | null> {
    const { value } = await Preferences.get({ key: USER_KEY });
    if (!value) return null;

    try {
      return JSON.parse(value);
    } catch (error) {
      console.error('[MobileAuth] Error parsing user:', error);
      return null;
    }
  }

  /**
   * Clear stored token and user
   */
  static async clearToken() {
    const eventSessions = await this.getAllEventSessionTokens();
    Object.keys(eventSessions).forEach((slug) => {
      localStorage.removeItem(this.getEventSessionStorageKey(slug));
    });

    localStorage.removeItem(LOCAL_TOKEN_KEY);
    await Preferences.remove({ key: TOKEN_KEY });
    await Preferences.remove({ key: USER_KEY });
    await Preferences.remove({ key: EVENT_SESSIONS_KEY });
    await Preferences.remove({ key: 'oauth_state' });
    // Let the native engine notice the token is gone now, rather than
    // discovering it on its next scheduled run and posting a "sign in again"
    // notification the user didn't need to see.
    await this.notifyFolderSyncEngine();
  }

  static async setEventSessionToken(eventSlug: string, token: string) {
    const sessions = await this.getAllEventSessionTokens();
    sessions[eventSlug] = token;
    await Preferences.set({
      key: EVENT_SESSIONS_KEY,
      value: JSON.stringify(sessions),
    });

    localStorage.setItem(this.getEventSessionStorageKey(eventSlug), token);
  }

  static async getEventSessionToken(eventSlug: string): Promise<string | null> {
    const sessions = await this.getAllEventSessionTokens();
    return sessions[eventSlug] || null;
  }

  static async getAllEventSessionTokens(): Promise<Record<string, string>> {
    const { value } = await Preferences.get({ key: EVENT_SESSIONS_KEY });
    if (!value) {
      return {};
    }

    try {
      const parsed = JSON.parse(value) as Record<string, string>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  /**
   * Check if user is authenticated
   */
  static async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null;
  }
}
