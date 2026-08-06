import { getInitials, getAvatarColor } from '../utils/userUtils';
import { getPreviewUrl } from '../api';

interface UserAvatarProps {
  email: string;
  name: string | null;
  size?: number; // Tailwind size value (e.g., 10 for h-10 w-10)
  showBorder?: boolean; // Whether to show white border ring
  /** Cover photo of this user's linked person (see person_clusters.linked_user_email) — when
   *  present, renders this photo instead of initials. All four fields are required together
   *  since building a preview URL needs the event slug + file type. */
  coverPhoto?: {
    photoId: string;
    eventSlug: string;
    fileType?: string | null;
    cacheVersion?: number | null;
  } | null;
  /** Makes the avatar an actual clickable button (e.g. to open a collaborator detail modal)
   *  instead of a plain hover-only display. */
  onClick?: () => void;
}

export function UserAvatar({ email, name, size = 10, showBorder = false, coverPhoto, onClick }: UserAvatarProps) {
  const initials = getInitials(name, email);
  const colorClass = getAvatarColor(email);
  // Never show the raw email address in a public-facing tooltip/title — only the display name,
  // or a generic fallback for someone who hasn't set one yet (see the "force a name on login"
  // flow, which should make this fallback increasingly rare over time).
  const displayName = name || 'Collaborator';
  
  // Generate size classes
  const sizeClass = `h-${size} w-${size}`;
  const textSizeClass = size >= 12 ? 'text-base' : size >= 10 ? 'text-sm' : 'text-xs';
  
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`
        ${sizeClass} 
        ${textSizeClass}
        ${showBorder ? 'ring-2 ring-white dark:ring-gray-900' : ''}
        rounded-full 
        flex 
        items-center 
        justify-center 
        text-white 
        font-semibold 
        ${onClick ? 'cursor-pointer' : 'cursor-default'} 
        transition-transform 
        hover:scale-110 
        hover:z-10
        relative
        group
      `}
      title={displayName}
    >
      {/* overflow-hidden is scoped to this inner wrapper (not the outer div) so it only clips
          the cover photo image to the circle — putting it on the outer div would also clip the
          absolutely-positioned tooltip below (a sibling relative to that same container),
          making it never actually appear on hover despite the CSS otherwise being correct. */}
      <div className={`w-full h-full rounded-full flex items-center justify-center overflow-hidden ${coverPhoto ? '' : colorClass}`}>
        {coverPhoto ? (
          <img
            src={getPreviewUrl(coverPhoto.eventSlug, coverPhoto.photoId, coverPhoto.fileType || undefined, coverPhoto.cacheVersion || undefined)}
            alt={displayName}
            className="w-full h-full object-cover"
          />
        ) : (
          initials
        )}
      </div>
      
      {/* Tooltip */}
      <div className="
        absolute 
        bottom-full 
        left-1/2 
        -translate-x-1/2 
        mb-2 
        px-2 
        py-1 
        bg-gray-900 
        dark:bg-gray-700 
        text-white 
        text-xs 
        rounded 
        whitespace-nowrap 
        opacity-0 
        group-hover:opacity-100 
        pointer-events-none 
        transition-opacity
        z-50
      ">
        {displayName}
        <div className="
          absolute 
          top-full 
          left-1/2 
          -translate-x-1/2 
          border-4 
          border-transparent 
          border-t-gray-900 
          dark:border-t-gray-700
        " />
      </div>
    </div>
  );
}
