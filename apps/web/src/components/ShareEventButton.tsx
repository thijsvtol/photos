import { useState } from 'react';
import { Share2, UserPlus, Check } from 'lucide-react';
import { getPreviewUrl } from '../api';
import type { Event, Photo, InviteLink } from '../types';

interface ShareEventButtonProps {
  event: Event;
  slug: string;
  photos: Photo[];
  /** Invite link to share with collaborators. Only passed when the event is collaborators_only and the current user can invite. */
  inviteLink?: InviteLink | null;
  /** Whether the current user can copy/share the invite link */
  canInvite?: boolean;
}

/**
 * Share button with native share API and fallback to platform-specific sharing
 */
export function ShareEventButton({ event, slug, photos, inviteLink, canInvite = false }: ShareEventButtonProps) {
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    const url = `${window.location.origin}/invite/${inviteLink.token}`;
    try {
      if ('share' in navigator) {
        await (navigator as any).share({
          title: `Join ${event.name}`,
          text: `You're invited to collaborate on ${event.name}`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 2000);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        // Fallback to clipboard if share fails
        try {
          await navigator.clipboard.writeText(url);
          setInviteCopied(true);
          setTimeout(() => setInviteCopied(false), 2000);
        } catch {
          // ignore
        }
      }
    }
    setShowShareMenu(false);
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

      {/* Share menu dropdown */}
      {showShareMenu && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-20" onClick={() => setShowShareMenu(false)} />

          <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden z-30">
            {/* Invite collaborators — shown only when user can invite */}
            {canInvite && inviteLink && (
              <>
                <button
                  onClick={copyInviteLink}
                  className="w-full px-4 py-2.5 text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex items-center gap-2 font-medium"
                >
                  {inviteCopied ? <Check className="w-4 h-4 text-green-500" /> : <UserPlus className="w-4 h-4" />}
                  {inviteCopied ? 'Link copied!' : 'Invite Collaborators'}
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
    </div>
  );
}
