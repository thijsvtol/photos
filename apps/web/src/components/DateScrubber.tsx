import React, { useCallback, useEffect, useRef, useState } from 'react';

interface DateScrubberProps {
  /** Map from date string (YYYY-MM-DD) to the DOM element ref for that date section */
  dateRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  /** Sorted array of date strings */
  dates: string[];
  /** Currently active/visible date */
  activeDate: string | null;
  /** Called when scrubbing to a date whose section is not yet rendered (e.g. lazy-loaded pages) */
  onScrollToDate?: (date: string) => void;
}

const DateScrubber: React.FC<DateScrubberProps> = ({ dateRefs, dates, activeDate, onScrollToDate }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const activePillRef = useRef<HTMLButtonElement>(null);

  // Only show after scrolling past 200px and if there are multiple dates
  useEffect(() => {
    if (dates.length <= 1) return;

    const handleScroll = () => {
      setIsVisible(window.scrollY > 200);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [dates.length]);

  // Auto-scroll the active pill into view
  useEffect(() => {
    if (activePillRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const pill = activePillRef.current;
      const pillLeft = pill.offsetLeft;
      const pillWidth = pill.offsetWidth;
      const containerWidth = container.clientWidth;
      const scrollLeft = container.scrollLeft;

      // Center the active pill in the container
      const targetScroll = pillLeft - containerWidth / 2 + pillWidth / 2;
      if (Math.abs(targetScroll - scrollLeft) > pillWidth) {
        container.scrollTo({ left: targetScroll, behavior: 'smooth' });
      }
    }
  }, [activeDate]);

  const formatLabel = useCallback((dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (dateStr === today.toISOString().slice(0, 10)) return 'Today';
    if (dateStr === yesterday.toISOString().slice(0, 10)) return 'Yesterday';

    if (date.getFullYear() === today.getFullYear()) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }, []);

  const scrollToDate = useCallback(
    (dateStr: string) => {
      const el = dateRefs.current.get(dateStr);
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 120;
        window.scrollTo({ top: y, behavior: 'smooth' });
      } else if (onScrollToDate) {
        onScrollToDate(dateStr);
      }
    },
    [dateRefs, onScrollToDate]
  );

  if (!isVisible || dates.length <= 1) return null;

  return (
    <div className="fixed top-16 left-0 right-0 z-40 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md border-b border-gray-200/70 dark:border-gray-700/70 shadow-sm">
      <div
        ref={scrollContainerRef}
        className="flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {dates.map((date) => {
          const isActive = date === activeDate;
          return (
            <button
              key={date}
              ref={isActive ? activePillRef : undefined}
              onClick={() => scrollToDate(date)}
              className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {formatLabel(date)}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default DateScrubber;
