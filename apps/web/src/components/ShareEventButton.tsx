import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { getPreviewUrl } from '../api';
import type { Event, Photo } from '../types';

interface ShareEventButtonProps {
  event: Event;
  slug: string;
  photos: Photo[];
}

/**
 * Share button with native share API and fallback to platform-specific sharing
 */
export function ShareEventButton({ event, slug, photos }: ShareEventButtonProps) {
  const [showShareMenu, setShowShareMenu] = useState(false);

  const shareEvent = async (platform?: string) => {
    const url = `${window.location.origin}/events/${slug}`;
    const text = `Check out ${event.name} photo gallery`;

    // Use native share API on mobile if available and no platform specified
    if (!platform && 'share' in navigator) {
      try {
        const shareData: any = {
          title: event.name || 'Photo Gallery',
          text: text,
          url: url,
        };

        // Try to include a representative photo from the album
        if (photos.length > 0) {
          try {
            // Use first photo or first featured photo as representative
            const representativePhoto = photos.find((p) => p.is_featured) || photos[0];
            const imageUrl = getPreviewUrl(slug, representativePhoto.id, representativePhoto.file_type, representativePhoto.cache_version);

            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const fileName = `${slug}-preview.jpg`;
            const file = new File([blob], fileName, { type: blob.type });

            // Check if we can share files
            if ((navigator as any).canShare && (navigator as any).canShare({ files: [file] })) {
              shareData.files = [file];
            }
          } catch (err) {
            console.log('Could not include photo in share, sharing URL only:', err);
          }
        }

        await (navigator as any).share(shareData);
        setShowShareMenu(false);
        return;
      } catch (err) {
        // User cancelled or share failed
        if ((err as Error).name !== 'AbortError') {
          console.error('Error sharing:', err);
        }
        return;
      }
    }

    // Fall back to platform-specific sharing
    switch (platform) {
      case 'twitter':
        window.open(
          `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
          '_blank'
        );
        break;
      case 'facebook':
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
        break;
      case 'whatsapp':
        window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank');
        break;
      case 'copy':
        navigator.clipboard.writeText(url);
        alert('Link copied to clipboard!');
        break;
    }
    setShowShareMenu(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => {
          if ('share' in navigator) {
            shareEvent();
          } else {
            setShowShareMenu(!showShareMenu);
          }
        }}
        className="px-3 py-2 sm:px-4 sm:py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2 text-sm font-medium"
        aria-label="Share album"
      >
        <Share2 className="w-4 h-4 sm:w-5 sm:h-5" />
        <span className="hidden sm:inline">Share</span>
      </button>

      {/* Desktop share menu dropdown */}
      {showShareMenu && !('share' in navigator) && (
        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden z-30">
          <button
            onClick={() => shareEvent('twitter')}
            className="w-full px-4 py-2 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
          >
            <span>🐦</span> Twitter
          </button>
          <button
            onClick={() => shareEvent('facebook')}
            className="w-full px-4 py-2 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
          >
            <span>📘</span> Facebook
          </button>
          <button
            onClick={() => shareEvent('whatsapp')}
            className="w-full px-4 py-2 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
          >
            <span>💬</span> WhatsApp
          </button>
          <button
            onClick={() => shareEvent('copy')}
            className="w-full px-4 py-2 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
          >
            <span>🔗</span> Copy Link
          </button>
        </div>
      )}
    </div>
  );
}
