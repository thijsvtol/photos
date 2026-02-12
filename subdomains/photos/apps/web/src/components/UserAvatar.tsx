import { getInitials, getAvatarColor } from '../utils/userUtils';

interface UserAvatarProps {
  email: string;
  name: string | null;
  size?: number; // Tailwind size value (e.g., 10 for h-10 w-10)
  showBorder?: boolean; // Whether to show white border ring
}

export function UserAvatar({ email, name, size = 10, showBorder = false }: UserAvatarProps) {
  const initials = getInitials(name, email);
  const colorClass = getAvatarColor(email);
  const displayName = name || email;
  
  // Generate size classes
  const sizeClass = `h-${size} w-${size}`;
  const textSizeClass = size >= 12 ? 'text-base' : size >= 10 ? 'text-sm' : 'text-xs';
  
  return (
    <div
      className={`
        ${sizeClass} 
        ${colorClass} 
        ${textSizeClass}
        ${showBorder ? 'ring-2 ring-white dark:ring-gray-900' : ''}
        rounded-full 
        flex 
        items-center 
        justify-center 
        text-white 
        font-semibold 
        cursor-default 
        transition-transform 
        hover:scale-110 
        hover:z-10
        relative
        group
      `}
      title={displayName}
    >
      {initials}
      
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
