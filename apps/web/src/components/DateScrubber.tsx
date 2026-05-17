import React, { useCallback, useEffect, useRef, useState } from 'react';

interface DateScrubberProps {
  /** Map from date string (YYYY-MM-DD) to the DOM element ref for that date section */
  dateRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  /** Sorted array of date strings */
  dates: string[];
  /** Currently active/visible date */
  activeDate: string | null;
}

const DateScrubber: React.FC<DateScrubberProps> = ({ dateRefs, dates, activeDate }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const [hoverY, setHoverY] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only show after scrolling past 400px and if there are multiple dates
  useEffect(() => {
    if (dates.length <= 1) return;

    const handleScroll = () => {
      setIsVisible(window.scrollY > 400);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [dates.length]);

  const formatLabel = useCallback((dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    if (date.getFullYear() === today.getFullYear()) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }, []);

  const getDateFromY = useCallback(
    (clientY: number): string | null => {
      if (!trackRef.current || dates.length === 0) return null;
      const rect = trackRef.current.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const index = Math.round(fraction * (dates.length - 1));
      return dates[index] || null;
    },
    [dates]
  );

  const scrollToDate = useCallback(
    (dateStr: string) => {
      const el = dateRefs.current.get(dateStr);
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 120;
        window.scrollTo({ top: y, behavior: 'auto' });
      }
    },
    [dateRefs]
  );

  const handleInteraction = useCallback(
    (clientY: number) => {
      const date = getDateFromY(clientY);
      if (date) {
        setHoverLabel(formatLabel(date));
        if (trackRef.current) {
          const rect = trackRef.current.getBoundingClientRect();
          setHoverY(clientY - rect.top);
        }
        scrollToDate(date);
      }
    },
    [formatLabel, getDateFromY, scrollToDate]
  );

  // Mouse events
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      handleInteraction(e.clientY);
    },
    [handleInteraction]
  );

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      handleInteraction(e.clientY);
    };
    const onMouseUp = () => {
      setIsDragging(false);
      setHoverLabel(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, handleInteraction]);

  // Touch events
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      setIsDragging(true);
      handleInteraction(e.touches[0].clientY);
    },
    [handleInteraction]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      handleInteraction(e.touches[0].clientY);
    },
    [handleInteraction]
  );

  const onTouchEnd = useCallback(() => {
    setIsDragging(false);
    setHoverLabel(null);
  }, []);

  // Show on hover, hide after timeout
  const onMouseEnter = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const onMouseLeave = () => {
    if (!isDragging) {
      hideTimeoutRef.current = setTimeout(() => {
        setHoverLabel(null);
      }, 300);
    }
  };

  // Indicator position based on active date
  const activeIndex = activeDate ? dates.indexOf(activeDate) : -1;
  const activeFraction = dates.length > 1 && activeIndex >= 0 ? activeIndex / (dates.length - 1) : 0;

  if (!isVisible || dates.length <= 1) return null;

  return (
    <div
      className="fixed right-1 sm:right-2 z-30 flex items-center"
      style={{ top: '50%', transform: 'translateY(-50%)', height: '60vh' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Date label tooltip */}
      {(hoverLabel || isDragging) && (
        <div
          className="absolute right-8 sm:right-10 bg-gray-900/90 dark:bg-gray-100/90 text-white dark:text-gray-900 text-xs sm:text-sm font-medium px-3 py-1.5 rounded-lg whitespace-nowrap pointer-events-none shadow-lg"
          style={{ top: Math.max(0, Math.min(hoverY - 14, trackRef.current ? trackRef.current.clientHeight - 28 : 0)) }}
        >
          {hoverLabel}
        </div>
      )}

      {/* Scrubber track */}
      <div
        ref={trackRef}
        className={`relative w-5 sm:w-6 h-full cursor-grab active:cursor-grabbing touch-none select-none ${
          isDragging ? 'opacity-100' : 'opacity-40 hover:opacity-80'
        } transition-opacity`}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Track line */}
        <div className="absolute left-1/2 -translate-x-1/2 w-0.5 h-full bg-gray-400/50 dark:bg-gray-500/50 rounded-full" />

        {/* Date tick marks */}
        {dates.map((date, i) => {
          const top = dates.length > 1 ? `${(i / (dates.length - 1)) * 100}%` : '50%';
          const isActive = date === activeDate;
          return (
            <div
              key={date}
              className={`absolute left-1/2 -translate-x-1/2 rounded-full transition-all ${
                isActive
                  ? 'w-2.5 h-2.5 bg-blue-500'
                  : 'w-1.5 h-1.5 bg-gray-400 dark:bg-gray-500'
              }`}
              style={{ top, transform: 'translate(-50%, -50%)' }}
            />
          );
        })}

        {/* Active position indicator */}
        {activeIndex >= 0 && (
          <div
            className="absolute left-1/2 -translate-x-1/2 w-4 h-4 border-2 border-blue-500 bg-white dark:bg-gray-900 rounded-full shadow-md transition-all duration-200"
            style={{ top: `${activeFraction * 100}%`, transform: 'translate(-50%, -50%)' }}
          />
        )}
      </div>
    </div>
  );
};

export default DateScrubber;
