import React, { createContext, useContext, useState, useEffect } from 'react';

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
      const response = await fetch('/api/user/profile', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        // API returns { user: null } if not authenticated
        setUser(data.user);
      } else if (response.status === 401) {
        // Token expired or invalid - clear user state
        console.log('Authentication expired or invalid');
        setUser(null);
      } else {
        setUser(null);
      }
    } catch (error) {
      // Don't log error for unauthenticated state - this is expected
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  const login = () => {
    // Check if we're in development or if Access is not configured
    if (import.meta.env.DEV || window.location.hostname === 'localhost') {
      alert('Cloudflare Access is not available in development mode.\n\nTo test authentication:\n1. Deploy to production\n2. Configure Cloudflare Access in your dashboard\n3. Or use Cloudflare Tunnel for local testing');
      return;
    }
    
    // Store the current location to return after login
    const currentPath = window.location.pathname;
    if (currentPath !== '/favorites' && currentPath !== '/cdn-cgi/access/logout') {
      sessionStorage.setItem('auth_redirect', currentPath);
    }
    
    // Clear any expired tokens by logging out of Access first, then redirecting to favorites
    // This ensures we get a fresh token
    window.location.href = '/cdn-cgi/access/logout?return_to=' + encodeURIComponent('/favorites');
  };

  const logout = () => {
    // Clear session storage
    sessionStorage.removeItem('auth_redirect');
    
    // Clear local user state immediately
    setUser(null);
    
    if (import.meta.env.DEV || window.location.hostname === 'localhost') {
      return;
    }
    
    // Call Cloudflare Access logout in background using iframe
    // This clears the Access session without redirecting the user
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = '/cdn-cgi/access/logout';
    document.body.appendChild(iframe);
    
    // Wait for logout to complete, then hard refresh
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
      
      // Hard refresh to clear all state
      if (window.location.pathname.startsWith('/admin') || window.location.pathname === '/favorites') {
        window.location.href = '/events';
      } else {
        window.location.reload();
      }
    }, 1000);
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
