import React, { useEffect, useState, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface DateTimelineProps {
  dates: string[]; // Array of dates in YYYY-MM-DD format
  activeDate: string | null;
  onDateClick: (date: string) => void;
  topOffset?: number; // Offset from top when sticky (in pixels)
}

const DateTimeline: React.FC<DateTimelineProps> = ({ dates, activeDate, onDateClick, topOffset = 0 }) => {
  const [isSticky, setIsSticky] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScroll = () => {
      setIsSticky(window.scrollY > 200);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll active date into view
  useEffect(() => {
    if (activeDate && scrollContainerRef.current) {
      const activeButton = scrollContainerRef.current.querySelector(`[data-date="${activeDate}"]`);
      if (activeButton) {
        activeButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [activeDate]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const isToday = date.toDateString() === today.toDateString();
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) return 'Today';
    if (isYesterday) return 'Yesterday';

    const options: Intl.DateTimeFormatOptions = { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
    };
    return date.toLocaleDateString('en-US', options);
  };

  const formatDateLong = (dateStr: string) => {
    const date = new Date(dateStr);
    const options: Intl.DateTimeFormatOptions = { 
      weekday: 'long',
      year: 'numeric',
      month: 'long', 
      day: 'numeric'
    };
    return date.toLocaleDateString('en-US', options);
  };

  const scrollTimeline = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = 200;
      scrollContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  if (dates.length <= 1) {
    return null; // Don't show timeline if only one date
  }

  return (
    <div 
      className={`bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 transition-all duration-300 z-40 ${
        isSticky ? 'fixed left-0 right-0 shadow-md' : 'relative'
      }`}
      style={isSticky ? { top: `${topOffset}px` } : undefined}
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
        <div className={`flex items-center gap-2 ${isSticky ? 'py-1.5' : 'py-2'}`}>
          {/* Icon and label - hidden on very small screens */}
          <div className="hidden sm:flex items-center gap-2 text-gray-600 dark:text-gray-400 mr-2 flex-shrink-0">
            <Calendar className="w-5 h-5" />
            <span className="text-sm font-medium hidden md:inline">Timeline</span>
          </div>

          {/* Mobile: Just show icon */}
          <div className="flex sm:hidden items-center text-gray-600 dark:text-gray-400 mr-2 flex-shrink-0">
            <Calendar className="w-4 h-4" />
          </div>

          {/* Left scroll button - hidden on mobile */}
          <button
            onClick={() => scrollTimeline('left')}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition flex-shrink-0"
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>

          {/* Scrollable date buttons */}
          <div 
            ref={scrollContainerRef}
            className="flex-1 overflow-x-auto scrollbar-hide flex gap-2"
            style={{ 
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
          >
            {dates.map((date) => {
              const isActive = date === activeDate;
              return (
                <button
                  key={date}
                  data-date={date}
                  onClick={() => onDateClick(date)}
                  className={`
                    flex-shrink-0 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all
                    ${isActive 
                      ? 'bg-blue-600 text-white shadow-md scale-105' 
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 active:scale-95'
                    }
                  `}
                  title={formatDateLong(date)}
                >
                  {formatDate(date)}
                </button>
              );
            })}
          </div>

          {/* Right scroll button - hidden on mobile */}
          <button
            onClick={() => scrollTimeline('right')}
            className="hidden md:flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition flex-shrink-0"
            aria-label="Scroll right"
          >
            <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DateTimeline;
