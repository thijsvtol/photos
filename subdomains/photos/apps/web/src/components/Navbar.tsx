import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Camera, Heart, MapPin, LayoutGrid, Settings, LogOut } from 'lucide-react';
import { adminLogout } from '../api';

const Navbar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = localStorage.getItem('isAdmin') === 'true';
  const isOnAdminPage = location.pathname.startsWith('/admin');
  
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

  const handleLogout = async () => {
    try {
      await adminLogout();
      navigate('/events');
      window.location.reload(); // Reload to clear any cached admin state
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 text-gray-900 hover:text-gray-700 transition-colors">
            <Camera className="w-6 h-6" />
            <span className="font-bold text-lg hidden sm:inline">Thijs van Tol</span>
            <span className="font-bold text-lg sm:hidden">TvT</span>
          </Link>
          
          {/* Navigation Links */}
          <div className="flex items-center gap-1 sm:gap-2">
            <Link to="/events" className={linkClass('/events')}>
              <LayoutGrid className="w-4 h-4" />
              <span className="hidden sm:inline">Events</span>
            </Link>
            
            <Link to="/favorites" className={linkClass('/favorites')}>
              <Heart className="w-4 h-4" />
              <span className="hidden sm:inline">Favorites</span>
            </Link>
            
            <Link to="/map" className={linkClass('/map')}>
              <MapPin className="w-4 h-4" />
              <span className="hidden sm:inline">Map</span>
            </Link>
            
            <Link to="/admin" className={linkClass('/admin')}>
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Admin</span>
            </Link>

            {(isAdmin || isOnAdminPage) && (
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium text-red-600 hover:bg-red-50"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
