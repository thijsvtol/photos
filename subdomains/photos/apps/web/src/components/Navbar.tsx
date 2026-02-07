import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Heart, MapPin, LayoutGrid, Settings, LogOut, User, LogIn, ChevronDown } from 'lucide-react';
import { adminLogout } from '../api';
import { useAuth } from '../contexts/AuthContext';

const Navbar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, login, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isAdmin = localStorage.getItem('isAdmin') === 'true';
  const isOnAdminPage = location.pathname.startsWith('/admin');
  
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
      ? `${base} bg-blue-100 text-blue-700`
      : `${base} text-gray-600 hover:bg-gray-100`;
  };

  const handleAdminLogout = async () => {
    try {
      await adminLogout();
      navigate('/events');
      window.location.reload(); // Reload to clear any cached admin state
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleUserLogout = () => {
    setShowUserMenu(false);
    logout();
  };

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 text-gray-900 hover:text-gray-700 transition-colors">
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
            
            {/* Admin button hidden for now
            <Link to="/admin" className={linkClass('/admin')}>
              <Settings className="w-4 h-4 sm:mr-0" aria-hidden="true" />
              <span className="hidden sm:inline">Admin</span>
              <span className="sr-only sm:hidden">Admin</span>
            </Link>
            */}

            {(isAdmin || isOnAdminPage) && (
              <button
                onClick={handleAdminLogout}
                className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium text-red-600 hover:bg-red-50"
                aria-label="Admin Logout"
              >
                <LogOut className="w-4 h-4 sm:mr-0" aria-hidden="true" />
                <span className="hidden sm:inline">Admin Logout</span>
                <span className="sr-only sm:hidden">Admin Logout</span>
              </button>
            )}

            {/* User Menu */}
            <div className="relative ml-2" ref={menuRef}>
              {isAuthenticated ? (
                <>
                  <button
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium text-gray-700 hover:bg-gray-100"
                    aria-label="User menu"
                  >
                    <User className="w-4 h-4" aria-hidden="true" />
                    <span className="hidden lg:inline max-w-[150px] truncate">
                      {user?.name || user?.email}
                    </span>
                    <ChevronDown className="w-3 h-3" aria-hidden="true" />
                  </button>
                  
                  {showUserMenu && (
                    <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-2">
                      <div className="px-4 py-2 border-b border-gray-100">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {user?.name || 'User'}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {user?.email}
                        </p>
                        {user?.favorites_count !== undefined && (
                          <p className="text-xs text-gray-500 mt-1">
                            {user.favorites_count} favorite{user.favorites_count !== 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={handleUserLogout}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
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
                  className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium text-gray-700 hover:bg-gray-100"
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
    </nav>
  );
};

export default Navbar;
