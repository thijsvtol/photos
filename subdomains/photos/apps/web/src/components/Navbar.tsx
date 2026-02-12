import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Heart, MapPin, LayoutGrid, Settings, LogOut, User, LogIn, ChevronDown } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../contexts/AuthContext';
import UserSettings from './UserSettings';

const Navbar: React.FC = () => {
  const location = useLocation();
  const { user, isAuthenticated, login, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isAndroid = Capacitor.getPlatform() === 'android';
  
  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const isActive = (path: string) => {
    if (path === '/events') {
      return location.pathname === '/events' || location.pathname.startsWith('/events/') || location.pathname.startsWith('/p/');
    }
    return location.pathname === path;
  };
  
  const linkClass = (path: string) => {
    const base = "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium";
    return isActive(path) 
      ? `${base} bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300`
      : `${base} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700`;
  };

  const handleLogout = () => {
    setShowUserMenu(false);
    logout();
  };

  return (
    <nav className={`bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50 shadow-sm ${isAndroid ? 'pt-8' : ''}`}>
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 text-gray-900 dark:text-white hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
            <img src="/favicon.svg" alt="Logo" className="w-6 h-6" />
            <span className="font-bold text-lg hidden sm:inline">Thijs van Tol</span>
            <span className="font-bold text-lg sm:hidden">TvT</span>
          </Link>
          
          {/* Navigation Links */}
          <div className="flex items-center gap-1 sm:gap-2">
            <Link to="/events" className={linkClass('/events')}>
              <LayoutGrid className="w-4 h-4 sm:mr-0" aria-hidden="true" />
              <span className="hidden sm:inline">Events</span>
              <span className="sr-only sm:hidden">Events</span>
            </Link>
            
            <Link to="/favorites" className={linkClass('/favorites')}>
              <Heart className="w-4 h-4 sm:mr-0" aria-hidden="true" />
              <span className="hidden sm:inline">Favorites</span>
              <span className="sr-only sm:hidden">Favorites</span>
            </Link>
            
            <Link to="/map" className={linkClass('/map')}>
              <MapPin className="w-4 h-4 sm:mr-0" aria-hidden="true" />
              <span className="hidden sm:inline">Map</span>
              <span className="sr-only sm:hidden">Map</span>
            </Link>
            
            {/* Show admin link if user is admin */}
            {user?.isAdmin && (
              <Link to="/admin" className={linkClass('/admin')}>
                <Settings className="w-4 h-4 sm:mr-0" aria-hidden="true" />
                <span className="hidden sm:inline">Admin</span>
                <span className="sr-only sm:hidden">Admin</span>
              </Link>
            )}

            {/* User Menu */}
            <div className="relative ml-2" ref={menuRef}>
              {isAuthenticated ? (
                <>
                  <button
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                    aria-label="User menu"
                  >
                    <User className="w-4 h-4" aria-hidden="true" />
                    <span className="hidden lg:inline max-w-[150px] truncate">
                      {user?.name || user?.email}
                    </span>
                    <ChevronDown className="w-3 h-3" aria-hidden="true" />
                  </button>
                  
                  {showUserMenu && (
                    <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-2">
                      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {user?.name || 'User'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {user?.email}
                        </p>
                        {user?.favorites_count !== undefined && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {user.favorites_count} favorite{user.favorites_count !== 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setShowUserMenu(false);
                          setShowSettings(true);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                      >
                        <Settings className="w-4 h-4" />
                        Settings
                      </button>
                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                      >
                        <LogOut className="w-4 h-4" />
                        Logout
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <button
                  onClick={login}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  aria-label="Login"
                >
                  <LogIn className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Login</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* User Settings Modal */}
      <UserSettings isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </nav>
  );
};

export default Navbar;
