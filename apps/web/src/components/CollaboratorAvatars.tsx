import { UserAvatar } from './UserAvatar';
import type { Collaborator } from '../types';

interface CollaboratorAvatarsProps {
  collaborators: Collaborator[];
}

export function CollaboratorAvatars({ collaborators }: CollaboratorAvatarsProps) {
  if (collaborators.length === 0) return null;
  
  // Determine stacking strategy based on number of collaborators
  const total = collaborators.length;
  const maxVisible = 15;
  const displayCollaborators = collaborators.slice(0, maxVisible);
  const hasMore = total > maxVisible;
  const moreCount = total - maxVisible;
  
  // Dynamic spacing: comfortable for ≤5, compact for 6-15
  const overlapClass = total <= 5 ? '-ml-2' : '-ml-3';
  
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
              size={10}
              showBorder={true}
            />
          </div>
        ))}
        
        {hasMore && (
          <div
            className={`
              ${overlapClass}
              h-10 
              w-10 
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
      
      <span className="ml-3 text-sm text-gray-600 dark:text-gray-400">
        {total} {total === 1 ? 'collaborator' : 'collaborators'}
      </span>
    </div>
  );
}
