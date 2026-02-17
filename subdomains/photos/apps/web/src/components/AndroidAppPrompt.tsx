import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const DISMISSED_KEY = 'android_app_prompt_dismissed';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=nl.thijsvtol.photos';

export const AndroidAppPrompt: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if user is on Android
    const isAndroid = /Android/i.test(navigator.userAgent);
    
    // Check if prompt was previously dismissed
    const wasDismissed = localStorage.getItem(DISMISSED_KEY) === 'true';
    
    // Show prompt if on Android and not previously dismissed
    if (isAndroid && !wasDismissed) {
      // Delay showing the prompt slightly for better UX
      setTimeout(() => {
        setIsVisible(true);
      }, 2000);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setIsVisible(false);
  };

  const handleDownload = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    window.open(PLAY_STORE_URL, '_blank');
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black bg-opacity-50 animate-fadeIn">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full p-6 relative animate-slideUp">
        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          aria-label="Close"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Content */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Get the App!
          </h2>
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            Download our Android app for a better experience with faster uploads, offline access, and more features.
          </p>

          {/* Play Store Badge */}
          <a
            href={PLAY_STORE_URL}
            onClick={handleDownload}
            className="inline-block mb-4 hover:opacity-80 transition-opacity"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png"
              alt="Get it on Google Play"
              className="h-16 w-auto"
            />
          </a>

          {/* Alternative text button for dismissing */}
          <div>
            <button
              onClick={handleDismiss}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 underline"
            >
              Continue in browser
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
