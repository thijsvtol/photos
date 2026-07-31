import { useCallback, useEffect, useRef, useState } from 'react';

type DensityLevel = 'comfortable' | 'default' | 'dense';

const ROW_HEIGHTS: Record<DensityLevel, number> = {
  comfortable: 280,
  default: 200,
  dense: 140,
};

const DENSITY_ORDER: DensityLevel[] = ['comfortable', 'default', 'dense'];

const STORAGE_KEY = 'gallery_grid_density';

export function useGridDensity() {
  const [density, setDensity] = useState<DensityLevel>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && DENSITY_ORDER.includes(saved as DensityLevel)) {
      return saved as DensityLevel;
    }
    // No saved preference yet: pick a sensible device-aware default instead of
    // always defaulting to 'default' regardless of screen size. Matches the
    // app's `sm` breakpoint (640px) used elsewhere for mobile/desktop layout.
    const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches;
    return isDesktop ? 'dense' : 'default';
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const lastPinchDistRef = useRef<number | null>(null);

  const changeDensity = useCallback((level: DensityLevel) => {
    setDensity(level);
    localStorage.setItem(STORAGE_KEY, level);
  }, []);

  // Pinch-to-zoom support
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const getDistance = (touches: TouchList) => {
      if (touches.length < 2) return null;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        lastPinchDistRef.current = getDistance(e.touches);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || lastPinchDistRef.current === null) return;

      const currentDist = getDistance(e.touches);
      if (currentDist === null) return;

      const delta = currentDist - lastPinchDistRef.current;
      const threshold = 60; // px of pinch movement needed

      if (Math.abs(delta) > threshold) {
        e.preventDefault();
        const currentIdx = DENSITY_ORDER.indexOf(density);

        if (delta > 0 && currentIdx > 0) {
          // Pinch out → larger photos (more comfortable)
          changeDensity(DENSITY_ORDER[currentIdx - 1]);
        } else if (delta < 0 && currentIdx < DENSITY_ORDER.length - 1) {
          // Pinch in → smaller photos (more dense)
          changeDensity(DENSITY_ORDER[currentIdx + 1]);
        }

        lastPinchDistRef.current = currentDist;
      }
    };

    const handleTouchEnd = () => {
      lastPinchDistRef.current = null;
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [density, changeDensity]);

  return {
    density,
    changeDensity,
    targetRowHeight: ROW_HEIGHTS[density],
    containerRef,
    densityLevels: DENSITY_ORDER,
  };
}
