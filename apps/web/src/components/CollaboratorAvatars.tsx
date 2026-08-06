import { useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Images } from 'lucide-react';
import { UserAvatar } from './UserAvatar';
import type { Collaborator } from '../types';

interface CollaboratorAvatarsProps {
  collaborators: Collaborator[];
  /** Tailwind size value passed to each UserAvatar (default 10, i.e. h-10 w-10). Use a smaller
   *  value (e.g. 8) to fit inline in a compact header row alongside other actions. */
  size?: number;
  /** Whether to show the "N collaborators" text label next to the avatars. Defaults to true;
   *  set false for a compact inline placement where the count would just be redundant clutter
   *  (each avatar's tooltip still shows who they are on hover). */
  showLabel?: boolean;
}

export function CollaboratorAvatars({ collaborators, size = 10, showLabel = true }: CollaboratorAvatarsProps) {
  const [detailCollaborator, setDetailCollaborator] = useState<Collaborator | null>(null);

  if (collaborators.length === 0) return null;
  
  // Determine stacking strategy based on number of collaborators
  const total = collaborators.length;
  const maxVisible = 15;
  const displayCollaborators = collaborators.slice(0, maxVisible);
  const hasMore = total > maxVisible;
  const moreCount = total - maxVisible;
  
  // Dynamic spacing: comfortable for ≤5, compact for 6-15
  const overlapClass = total <= 5 ? '-ml-2' : '-ml-3';
  const moreSizeClass = `h-${size} w-${size}`;
  
  return (
    <div className="flex items-center">
      <div className="flex items-center">
        {displayCollaborators.map((collaborator, index) => (
          <div
            key={collaborator.email}
            className={index > 0 ? overlapClass : ''}
            style={{ zIndex: maxVisible - index }}
          >
            <UserAvatar
              email={collaborator.email}
              name={collaborator.name}
              fallbackName={collaborator.person_name}
              size={size}
              showBorder={true}
              onClick={() => setDetailCollaborator(collaborator)}
              coverPhoto={
                collaborator.cover_photo_id && collaborator.cover_event_slug
                  ? {
                      photoId: collaborator.cover_photo_id,
                      eventSlug: collaborator.cover_event_slug,
                      fileType: collaborator.cover_file_type,
                      cacheVersion: collaborator.cover_cache_version,
                    }
                  : null
              }
            />
          </div>
        ))}
        
        {hasMore && (
          <div
            className={`
              ${overlapClass}
              ${moreSizeClass} 
              rounded-full 
              bg-gray-400 
              dark:bg-gray-600 
              ring-2 
              ring-white 
              dark:ring-gray-900
              flex 
              items-center 
              justify-center 
              text-white 
              text-xs 
              font-semibold
              cursor-default
            `}
            title={`${moreCount} more collaborator${moreCount > 1 ? 's' : ''}`}
            style={{ zIndex: 0 }}
          >
            +{moreCount}
          </div>
        )}
      </div>
      
      {showLabel && (
        <span className="ml-3 text-sm text-gray-600 dark:text-gray-400">
          {total} {total === 1 ? 'collaborator' : 'collaborators'}
        </span>
      )}

      {/* Collaborator detail modal — clicking any avatar above opens this instead of nothing
          happening (avatars used to be purely a hover-tooltip display). Offers a "View photos
          of X" link into the Timeline's people filter (?people=<person_id>) when this
          collaborator has a linked, identified person — the same access control the Timeline
          filter itself already enforces (see GET /api/people/named) applies there, so this link
          is safe to show to anyone who can already see the collaborator list. */}
      {detailCollaborator && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60"
          onClick={() => setDetailCollaborator(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-xs w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end">
              <button
                onClick={() => setDetailCollaborator(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-col items-center -mt-2">
              <UserAvatar
                email={detailCollaborator.email}
                name={detailCollaborator.name}
                fallbackName={detailCollaborator.person_name}
                size={20}
                coverPhoto={
                  detailCollaborator.cover_photo_id && detailCollaborator.cover_event_slug
                    ? {
                        photoId: detailCollaborator.cover_photo_id,
                        eventSlug: detailCollaborator.cover_event_slug,
                        fileType: detailCollaborator.cover_file_type,
                        cacheVersion: detailCollaborator.cover_cache_version,
                      }
                    : null
                }
              />
              <h3 className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">
                {detailCollaborator.name || detailCollaborator.person_name || 'Collaborator'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">{detailCollaborator.role}</p>

              {detailCollaborator.person_id ? (
                <Link
                  to={`/timeline?people=${detailCollaborator.person_id}`}
                  onClick={() => setDetailCollaborator(null)}
                  className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
                >
                  <Images className="w-4 h-4" /> View photos of {(detailCollaborator.name || detailCollaborator.person_name || 'them').split(' ')[0]}
                </Link>
              ) : (
                <p className="mt-4 text-xs text-gray-400 dark:text-gray-500 text-center">
                  This collaborator isn't linked to an identified person yet, so their photos can't be filtered for.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
