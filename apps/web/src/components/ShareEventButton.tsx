import { useState, useEffect } from 'react';
import { Share2, UserPlus, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { getPreviewUrl } from '../api';
import type { Event, Photo } from '../types';
import { config } from '../config';
import { useToast } from './Toast';
import CollaboratorManager from './CollaboratorManager';

interface ShareEventButtonProps {
  event: Event;
  slug: string;
  photos: Photo[];
  /** Whether the current user can copy/share the invite link */
  canInvite?: boolean;
}

/**
 * Share button that directly triggers native/web share sheet (same as photo share)
 * Plus optional collaborator invite button.
 */
export function ShareEventButton({ event, slug, photos, canInvite = false }: ShareEventButtonProps) {
  const [showCollaboratorModal, setShowCollaboratorModal] = useState(false);
  const toast = useToast();

  // Prevent body scroll and pull-to-refresh while collaborator modal is open
  useEffect(() => {
    if (!showCollaboratorModal) return;
    const origBodyOverflow = document.body.style.overflow;
    const origBodyOverscroll = document.body.style.overscrollBehavior;
    const origHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = origBodyOverflow;
      document.body.style.overscrollBehavior = origBodyOverscroll;
      document.documentElement.style.overscrollBehavior = origHtmlOverscroll;
    };
  }, [showCollaboratorModal]);

  const shareEvent = async () => {
    const domain = Capacitor.isNativePlatform() ? `https://${config.domain}` : window.location.origin;
    const url = `${domain}/events/${slug}`;
    const text = `Check out ${event.name} photo gallery`;

    // Use Capacitor native share on mobile app
    if (Capacitor.isNativePlatform()) {
      try {
        const shareOptions: { title?: string; text?: string; url?: string; dialogTitle?: string; files?: string[] } = {
          title: event.name || 'Photo Gallery',
          text: text,
          url: url,
          dialogTitle: 'Share album',
        };

        // Try to include a representative photo
        if (photos.length > 0) {
          try {
            const representativePhoto = photos.find((p) => p.is_featured) || photos[0];
            const imageUrl = getPreviewUrl(slug, representativePhoto.id, representativePhoto.file_type, representativePhoto.cache_version);
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve) => {
              reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
              reader.readAsDataURL(blob);
            });
            const saved = await Filesystem.writeFile({
              path: `share_album_preview.jpg`,
              data: base64,
              directory: Directory.Cache,
            });
            shareOptions.files = [saved.uri];
          } catch {
            // Could not include file, share without it
          }
        }

        await Share.share(shareOptions);
        return;
      } catch (err) {
        if ((err as Error).message !== 'Share canceled') {
          console.error('Native share error:', err);
        }
        return;
      }
    }

    // Use OS share sheet (works on desktop and mobile browsers)
    if (navigator.share) {
      try {
        const shareData: ShareData = {
          title: event.name || 'Photo Gallery',
          text: text,
          url: url,
        };

        // Try to include a representative photo as a file
        if (photos.length > 0) {
          try {
            const representativePhoto = photos.find((p) => p.is_featured) || photos[0];
            const imageUrl = getPreviewUrl(slug, representativePhoto.id, representativePhoto.file_type, representativePhoto.cache_version);
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const file = new File([blob], `${slug}-preview.jpg`, { type: blob.type });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              shareData.files = [file];
            }
          } catch {
            // Could not include photo, share URL only
          }
        }

        await navigator.share(shareData);
        return;
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Error sharing:', err);
        }
        return;
      }
    }

    // Fallback: copy to clipboard
    await navigator.clipboard.writeText(url);
    toast.showSuccess('Link copied to clipboard!');
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => void shareEvent()}
        className="px-3 py-2 sm:px-4 sm:py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-2 text-sm font-medium"
        aria-label="Share album"
      >
        <Share2 className="w-4 h-4 sm:w-5 sm:h-5" />
        <span className="hidden sm:inline">Share</span>
      </button>

      {canInvite && (
        <button
          onClick={() => setShowCollaboratorModal(true)}
          className="px-3 py-2 sm:px-4 sm:py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-2 text-sm font-medium"
          aria-label="Manage collaborators"
        >
          <UserPlus className="w-4 h-4 sm:w-5 sm:h-5" />
          <span className="hidden sm:inline">Invite</span>
        </button>
      )}

      {showCollaboratorModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6 overscroll-contain">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" onClick={() => setShowCollaboratorModal(false)} />
          <div className="relative z-[121] w-full max-w-4xl max-h-[90vh] overflow-y-auto overscroll-contain rounded-xl">
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
