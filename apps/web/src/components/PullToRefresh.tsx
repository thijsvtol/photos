import React from 'react';
import { Loader2 } from 'lucide-react';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { useRefresh } from '../contexts/RefreshContext';

interface PullToRefreshProps {
  enabled?: boolean;
  children?: React.ReactNode;
}

/**
 * Pull-to-refresh component for mobile apps
 * Shows a loading indicator when pulling down at the top of the page
 */
const PullToRefresh: React.FC<PullToRefreshProps> = ({
  enabled = true,
  children,
}) => {
  const { refresh } = useRefresh();
  const { pullDistance, isRefreshing, isActive } = usePullToRefresh({
    onRefresh: refresh,
    enabled,
    threshold: 80,
  });

  const opacity = Math.min(pullDistance / 80, 1);
  const rotation = (pullDistance / 80) * 360;

  return (
    <>
      {/* Pull indicator */}
      {isActive && (
        <div
          className="fixed top-0 left-0 right-0 z-[9999] pt-safe-top flex items-center justify-center pointer-events-none"
          style={{
            transform: `translateY(${Math.min(pullDistance - 20, 60)}px)`,
            opacity,
            transition: isRefreshing ? 'transform 0.3s ease-out, opacity 0.3s' : 'none',
          }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-full shadow-2xl p-4 border-2 border-blue-500">
            <Loader2
              className={`w-8 h-8 text-blue-600 dark:text-blue-400 ${
                isRefreshing ? 'animate-spin' : ''
              }`}
              style={{
                transform: isRefreshing ? undefined : `rotate(${rotation}deg)`,
                transition: isRefreshing ? undefined : 'transform 0.1s',
              }}
            />
          </div>
        </div>
      )}
      {children}
    </>
  );
};

export default PullToRefresh;
