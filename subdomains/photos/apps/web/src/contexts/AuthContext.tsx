import React, { createContext, useContext, useState, useEffect } from 'react';

export interface User {
  id: string;
  email: string;
  name?: string;
  favorites_count?: number;
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
    
    // Store the current location to return after login (if not already on a protected page)
    if (window.location.pathname !== '/favorites') {
      sessionStorage.setItem('auth_redirect', window.location.pathname);
    }
    
    // Redirect to the favorites page (which is protected by Access)
    // Access will automatically redirect to the proper login URL
    // and then redirect back to /favorites after successful authentication
    window.location.href = '/favorites';
  };

  const logout = () => {
    if (import.meta.env.DEV || window.location.hostname === 'localhost') {
      setUser(null);
      return;
    }
    
    // Clear session storage
    sessionStorage.removeItem('auth_redirect');
    
    // Clear local user state immediately
    setUser(null);
    
    // Call Cloudflare Access logout in background to clear session
    // Using an iframe to avoid full page redirect
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = '/cdn-cgi/access/logout';
    document.body.appendChild(iframe);
    
    // Remove iframe after a short delay
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 2000);
    
    // Redirect to home page instead of Cloudflare logout page
    if (window.location.pathname !== '/') {
      window.location.href = '/';
    }
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
