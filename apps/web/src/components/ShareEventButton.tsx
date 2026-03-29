import { useState } from 'react';
import { Share2, UserPlus, X } from 'lucide-react';
import { getPreviewUrl } from '../api';
import type { Event, Photo } from '../types';
import CollaboratorManager from './CollaboratorManager';

interface ShareEventButtonProps {
  event: Event;
  slug: string;
  photos: Photo[];
  /** Whether the current user can copy/share the invite link */
  canInvite?: boolean;
}

/**
 * Share button with native share API and fallback to platform-specific sharing
 */
export function ShareEventButton({ event, slug, photos, canInvite = false }: ShareEventButtonProps) {
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showCollaboratorModal, setShowCollaboratorModal] = useState(false);

  const copyToClipboard = async (value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  };

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
        void copyToClipboard(url);
        alert('Link copied to clipboard!');
        break;
    }
    setShowShareMenu(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowShareMenu(!showShareMenu)}
        className="px-3 py-2 sm:px-4 sm:py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2 text-sm font-medium"
        aria-label="Share album"
      >
        <Share2 className="w-4 h-4 sm:w-5 sm:h-5" />
        <span className="hidden sm:inline">Share</span>
      </button>

      {/* Share menu dropdown */}
      {showShareMenu && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-20" onClick={() => setShowShareMenu(false)} />

          <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden z-30">
            {/* Invite collaborators — shown only when user can invite */}
            {canInvite && (
              <>
                <button
                  onClick={() => {
                    setShowShareMenu(false);
                    setShowCollaboratorModal(true);
                  }}
                  className="w-full px-4 py-2.5 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2 font-medium"
                >
                  <UserPlus className="w-4 h-4" />
                  Collaborators & Invite Links
                </button>
                <div className="border-t border-gray-100 dark:border-gray-700" />
              </>
            )}
            {'share' in navigator ? (
              <button
                onClick={() => { void shareEvent(); setShowShareMenu(false); }}
                className="w-full px-4 py-2 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2"
              >
                <Share2 className="w-4 h-4" /> Share Album
              </button>
            ) : (
              <>
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
              </>
            )}
          </div>
        </>
      )}

      {showCollaboratorModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" onClick={() => setShowCollaboratorModal(false)} />
          <div className="relative z-[121] w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-900 border border-b-0 border-gray-200 dark:border-gray-700 rounded-t-xl">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">Collaborators & Invite Links</h3>
              <button
                onClick={() => setShowCollaboratorModal(false)}
                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Close collaborators modal"
              >
                <X className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            </div>
            <div className="rounded-b-xl border border-gray-200 dark:border-gray-700 border-t-0 bg-white dark:bg-gray-900 p-4">
              <CollaboratorManager eventSlug={slug} eventName={event.name} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
