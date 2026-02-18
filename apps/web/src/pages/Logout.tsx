import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SEO from '../components/SEO';
import { getConfig } from '../config';

const Logout: React.FC = () => {
  const navigate = useNavigate();
  const config = getConfig();

  useEffect(() => {
    // Set logout flag to prevent "session expired" message
    sessionStorage.setItem('logging_out', 'true');
    
    // Create hidden iframe to call CF logout endpoint
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = '/cdn-cgi/access/logout';
    document.body.appendChild(iframe);

    // Redirect to home after 2 seconds (gives time for logout to process)
    const timer = setTimeout(() => {
      document.body.removeChild(iframe);
      navigate('/', { replace: true });
    }, 2000);

    return () => {
      clearTimeout(timer);
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <SEO
        title={`Logging Out - ${config.appName}`}
        description="Logging you out..."
        url={`${window.location.origin}/logout`}
      />
      <div className="text-center bg-white p-8 rounded-xl shadow-lg max-w-md">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Logging Out...</h1>
        <p className="text-gray-600">Clearing your session, please wait...</p>
      </div>
    </div>
  );
};

export default Logout;
