import { Preferences } from '@capacitor/preferences';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

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
 * 1. App opens browser to: https://photos.thijsvtol.nl/mobile-auth
 * 2. User authenticates via Cloudflare Access
 * 3. Backend generates OAuth token
 * 4. Browser redirects to: photos://auth/callback?token=xxx&expires=xxx
 * 5. App captures deep link, stores token
 * 6. All API requests use: Authorization: Bearer <token>
 */
export class MobileAuthService {
  private static tokenCallbackResolve: ((token: AuthToken | null) => void) | null = null;

  /**
   * Initialize deep link listener
   */
  static async initialize() {
    // Listen for deep link callbacks
    App.addListener('appUrlOpen', (event) => {
      console.log('[MobileAuth] Deep link received:', event.url);
      
      if (event.url.startsWith('photos://auth/callback')) {
        this.handleAuthCallback(event.url);
      }
    });
  }

  /**
   * Start OAuth flow - opens browser for authentication
   */
  static async startAuthFlow(): Promise<AuthToken | null> {
    return new Promise(async (resolve) => {
      // Store resolve callback for deep link handler
      this.tokenCallbackResolve = resolve;

      // Generate random state for CSRF protection
      const state = Math.random().toString(36).substring(7);
      await Preferences.set({ key: 'oauth_state', value: state });

      // First go to /api/mobile-login to ensure user is authenticated, then auto-redirect to mobile-auth
      const authUrl = `https://photos.thijsvtol.nl/api/mobile-login?state=${state}`;
      
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
    await Preferences.remove({ key: TOKEN_KEY });
    await Preferences.remove({ key: USER_KEY });
    await Preferences.remove({ key: 'oauth_state' });
  }

  /**
   * Check if user is authenticated
   */
  static async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null;
  }
}
