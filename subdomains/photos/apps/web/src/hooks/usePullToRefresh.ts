import { useEffect, useState, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

interface PullToRefreshOptions {
  onRefresh: () => Promise<void>;
  enabled?: boolean;
  threshold?: number;
}

/**
 * Hook to enable pull-to-refresh on native mobile apps
 * Only works when page is scrolled to top
 */
export const usePullToRefresh = ({
  onRefresh,
  enabled = true,
  threshold = 80,
}: PullToRefreshOptions) => {
  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Use refs to avoid re-registering event listeners
  const startYRef = useRef(0);
  const isAtTopRef = useRef(true);
  const isPullingRef = useRef(false);
  const isRefreshingRef = useRef(false);
  const pullDistanceRef = useRef(0);

  useEffect(() => {
    // Only enable on native platforms
    if (!Capacitor.isNativePlatform() || !enabled) {
      return;
    }

    const handleTouchStart = (e: TouchEvent) => {
      // Check if touch started within a no-pull-refresh zone (like modals)
      const target = e.target as HTMLElement;
      const isInNoPullZone = target.closest('[data-no-pull-refresh]');
      if (isInNoPullZone) {
        return;
      }
      
      // Check if we're at the top of the page
      isAtTopRef.current = window.scrollY === 0;
      if (isAtTopRef.current && !isRefreshingRef.current) {
        startYRef.current = e.touches[0].clientY;
        isPullingRef.current = true;
        setIsPulling(true);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isAtTopRef.current || isRefreshingRef.current || !isPullingRef.current) return;

      const currentY = e.touches[0].clientY;
      const distance = currentY - startYRef.current;

      // Only allow pulling down
      if (distance > 0) {
        // Add resistance effect
        const resistedDistance = Math.min(distance * 0.5, threshold * 1.5);
        pullDistanceRef.current = resistedDistance;
        setPullDistance(resistedDistance);

        // Prevent default scrolling when pulling
        if (distance > 10) {
          e.preventDefault();
        }
      }
    };

    const handleTouchEnd = async () => {
      if (!isAtTopRef.current || isRefreshingRef.current) {
        isPullingRef.current = false;
        setIsPulling(false);
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      isPullingRef.current = false;
      setIsPulling(false);

      // Get current pull distance from ref
      const currentPullDistance = pullDistanceRef.current;

      // Trigger refresh if pulled beyond threshold
      if (currentPullDistance >= threshold) {
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        try {
          await onRefresh();
        } finally {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
          pullDistanceRef.current = 0;
          setPullDistance(0);
        }
      } else {
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    };

    // Add event listeners with passive: false to allow preventDefault
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enabled, threshold, onRefresh]);

  return {
    isPulling,
    pullDistance,
    isRefreshing,
    isActive: isPulling || isRefreshing,
  };
};
