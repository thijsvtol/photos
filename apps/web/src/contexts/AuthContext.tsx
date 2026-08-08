import React, { createContext, useContext, useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { MobileAuthService } from '../services/mobileAuth';
import { clearTimelineCache } from '../services/timelineCache';
import { getUserProfile } from '../api';

export interface User {
  id: string;
  email: string;
  name?: string;
  favorites_count?: number;
  isAdmin?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = async () => {
    try {
      // On native, check if we have a stored token/user
      if (Capacitor.isNativePlatform()) {
        const storedUser = await MobileAuthService.getUser();
        const hasToken = await MobileAuthService.isAuthenticated();

        if (!hasToken) {
          setUser(null);
          setLoading(false);
          return;
        }

        // Paint from the locally cached user first so startup isn't blocked on
        // the network.
        if (storedUser) {
          setUser(storedUser);
          setLoading(false);
        }

        // Then reconcile against the server, which is the source of truth for
        // `name` and `isAdmin`. The cached copy is written ONCE, at OAuth
        // callback time, from the token's claims — so anything the user
        // changes afterwards (notably setting their name via
        // RequireProfileName) was invisible to it. That made the "enter your
        // full name" modal reappear on every cold start forever: the name was
        // saved server-side, but this cache still said `name: undefined`, so
        // the modal's `!user.name` check kept firing. Refreshing here also
        // self-heals devices already stuck in that state, without making the
        // user type their name again.
        try {
          const freshUser = await getUserProfile();
          if (freshUser) {
            setUser(freshUser);
            await MobileAuthService.storeUser({
              id: freshUser.id,
              email: freshUser.email,
              name: freshUser.name ?? undefined,
              isAdmin: freshUser.isAdmin,
            });
          } else if (!storedUser) {
            // Server says nobody is signed in and there's nothing cached.
            setUser(null);
          }
        } catch (err) {
          // Offline or a transient server error must not sign the user out —
          // keep whatever was cached.
          console.warn('[AuthContext] Could not refresh profile, using cached user:', err);
          if (!storedUser) setUser(null);
        } finally {
          setLoading(false);
        }
        return;
      }

      // Check if this is an intentional logout
      const isLoggingOut = sessionStorage.getItem('logging_out') === 'true';
      if (isLoggingOut) {
        sessionStorage.removeItem('logging_out');
        setUser(null);
        setLoading(false);
        return;
      }

      // On web, use existing cookie-based auth
      const response = await fetch('/api/user/profile', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[AuthContext] User profile response:', data);
        console.log('[AuthContext] User object:', data.user);
        console.log('[AuthContext] User name:', data.user?.name);
        setUser(data.user);
      } else if (response.status === 401) {
        console.log('Authentication expired or invalid');
        setUser(null);
      } else {
        setUser(null);
      }
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  // Check for stored invite redirect after auth
  useEffect(() => {
    if (!loading && user) {
      const inviteRedirect = sessionStorage.getItem('inviteRedirect');
      if (inviteRedirect) {
        sessionStorage.removeItem('inviteRedirect');
        window.location.href = inviteRedirect;
      }
    }
  }, [loading, user]);

  const login = async () => {
    // On native platform, use OAuth flow
    if (Capacitor.isNativePlatform()) {
      setLoading(true);
      
      // Store current path to return to after login
      const currentPath = window.location.pathname + window.location.search + window.location.hash;
      sessionStorage.setItem('auth_redirect', currentPath);
      
      const token = await MobileAuthService.startAuthFlow();
      
      if (token) {
        // Fetch user data
        await fetchUser();
        
        // Get stored redirect path, default to events page
        const redirectPath = sessionStorage.getItem('auth_redirect') || '/events';
        sessionStorage.removeItem('auth_redirect');
        
        // Navigate to the stored path or refresh current page
        if (redirectPath === window.location.pathname) {
          // If we're already on the target page, force a reload to re-trigger logic
          window.location.reload();
        } else {
          // Navigate to the stored path
          window.location.href = redirectPath;
        }
      } else {
        alert('Authentication failed. Please try again.');
        setLoading(false);
      }
      
      return;
    }
    
    // Check if we're in development
    if (import.meta.env.DEV || window.location.hostname === 'localhost') {
      alert('Cloudflare Access is not available in development mode.\n\nTo test authentication:\n1. Deploy to production\n2. Configure Cloudflare Access in your dashboard\n3. Or use Cloudflare Tunnel for local testing\n4. Or use the mobile app');
      return;
    }
    
    // Redirect to login endpoint which is protected by Cloudflare Access
    // After authentication, it will redirect back
    const currentPath = window.location.pathname + window.location.search + window.location.hash;
    const returnTo = encodeURIComponent(currentPath === '/' ? '/favorites' : currentPath);
    
    // Store in sessionStorage as backup
    sessionStorage.setItem('auth_redirect', currentPath);
    
    window.location.href = `/api/auth/login?return_to=${returnTo}`;
  };

  const logout = () => {
    // Timeline photos may include private/collaborator-only events visible
    // only to the logged-in user; clear the IndexedDB cache so they don't
    // leak to whoever uses this device/browser next.
    void clearTimelineCache();

    if (Capacitor.isNativePlatform()) {
      // Clear token and user state
      MobileAuthService.clearToken();
      setUser(null);
      
      // Navigate to home page
      window.location.href = '/';
      return;
    }
    
    // Set flag to prevent "session expired" error
    sessionStorage.setItem('logging_out', 'true');
    
    // Clear session storage
    sessionStorage.removeItem('auth_redirect');
    
    // Clear local user state
    setUser(null);
    
    // Redirect to logout page which handles CF logout in iframe
    window.location.href = '/logout';
  };

  const refreshUser = async () => {
    await fetchUser();
  };

  const updateUser = (updatedUser: User) => {
    console.log('[AuthContext] Updating user directly:', updatedUser);
    setUser(updatedUser);

    // Also write through to the native cache. Without this the update lived
    // only in React state and was lost on the next cold start — the reason
    // RequireProfileName kept demanding a name the user had already given.
    if (Capacitor.isNativePlatform()) {
      MobileAuthService.storeUser({
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name ?? undefined,
        isAdmin: updatedUser.isAdmin,
      }).catch((err) => {
        console.warn('[AuthContext] Failed to persist updated user:', err);
      });
    }
  };

  const value: AuthContextType = {
    user,
    loading,
    isAuthenticated: !!user,
    login,
    logout,
    refreshUser,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
