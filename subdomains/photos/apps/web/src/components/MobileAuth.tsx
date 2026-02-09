import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { ShieldCheck } from 'lucide-react';

export default function MobileAuth() {
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleAuthenticate = async () => {
    setIsAuthenticating(true);
    
    try {
      // Open Cloudflare Access login page in system browser
      // This will allow user to authenticate and set cookies
      await Browser.open({ 
        url: 'https://photos.thijsvtol.nl/admin',
        presentationStyle: 'popover'
      });
      
      // Wait for user to complete authentication
      // User should close the browser when done
      alert('After logging in through Cloudflare Access, close the browser and return here. Then refresh the page.');
      
    } catch (error) {
      console.error('Authentication error:', error);
      alert('Failed to open authentication page');
    } finally {
      setIsAuthenticating(false);
    }
  };

  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-6 h-6 text-blue-600 mt-1" />
        <div className="flex-1">
          <h3 className="font-semibold text-blue-900 mb-2">Authentication Required</h3>
          <p className="text-sm text-blue-700 mb-4">
            Admin features require Cloudflare Access authentication. 
            Tap the button below to authenticate in your browser.
          </p>
          <button
            onClick={handleAuthenticate}
            disabled={isAuthenticating}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {isAuthenticating ? 'Opening...' : 'Authenticate with Cloudflare Access'}
          </button>
          <p className="text-xs text-blue-600 mt-3">
            After authenticating, close the browser and refresh this page. Your session will be valid for 24 hours.
          </p>
        </div>
      </div>
    </div>
  );
}
