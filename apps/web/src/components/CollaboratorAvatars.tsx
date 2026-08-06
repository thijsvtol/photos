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
              size={size}
              showBorder={true}
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
    </div>
  );
}
