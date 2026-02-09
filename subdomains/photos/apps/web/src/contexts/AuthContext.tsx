import React, { createContext, useContext, useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { MobileAuthService } from '../services/mobileAuth';

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
        
        if (storedUser && hasToken) {
          setUser(storedUser);
          setLoading(false);
          return;
        }
        
        setUser(null);
        setLoading(false);
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

  const login = async () => {
    // On native platform, use OAuth flow
    if (Capacitor.isNativePlatform()) {
      setLoading(true);
      const token = await MobileAuthService.startAuthFlow();
      
      if (token) {
        // Fetch user data
        await fetchUser();
      } else {
        alert('Authentication failed. Please try again.');
      }
      
      setLoading(false);
      return;
    }
    
    // Check if we're in development
    if (import.meta.env.DEV || window.location.hostname === 'localhost') {
      alert('Cloudflare Access is not available in development mode.\n\nTo test authentication:\n1. Deploy to production\n2. Configure Cloudflare Access in your dashboard\n3. Or use Cloudflare Tunnel for local testing\n4. Or use the mobile app');
      return;
    }
    
    // Redirect to login endpoint which is protected by Cloudflare Access
    // After authentication, it will redirect back
    const currentPath = window.location.pathname;
    const returnTo = encodeURIComponent(currentPath === '/' ? '/favorites' : currentPath);
    window.location.href = `/api/auth/login?return_to=${returnTo}`;
  };

  const logout = () => {
    if (Capacitor.isNativePlatform()) {
      MobileAuthService.clearToken();
      setUser(null);
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

  const value: AuthContextType = {
    user,
    loading,
    isAuthenticated: !!user,
    login,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
