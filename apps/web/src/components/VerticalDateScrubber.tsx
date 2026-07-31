import React, { useCallback, useMemo, useRef, useState } from 'react';

interface VerticalDateScrubberProps {
  /** Sorted date strings (YYYY-MM-DD), newest first — same convention used by
   *  every call site (Timeline, MyFavorites, EventGallery multi-day view). */
  dates: string[];
  activeDate: string | null;
  /** Navigate/scroll to the given date. Called continuously while dragging
   *  (throttled to animation frames) and on a plain tap/click/keyboard move. */
  onSelectDate: (date: string) => void;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatBubbleLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Google-Photos-style vertical fast-scroll scrubber: a slim strip fixed to
 * the right edge of the viewport. Dates are distributed evenly along its
 * height (by index, not by photo count — simpler and predictable), with
 * month/year tick labels shown at the point where the month changes.
 * Dragging (mouse or touch, via Pointer Events) shows a floating bubble with
 * the full month/year and calls `onSelectDate` continuously; a plain tap
 * jumps directly to that date. Arrow keys move one date at a time when the
 * strip has focus, for keyboard/accessibility support.
 *
 * Replaces the previous horizontal pill-bar scrubbers (DateScrubber.tsx,
 * DateTimeline.tsx) which took up a full-width band above the content and
 * only showed a handful of dates without scrolling; this shows the entire
 * date range at a glance and lets a 10,000+ photo library be navigated in a
 * single gesture, matching the requested Google-Photos-like navigation.
 */
const VerticalDateScrubber: React.FC<VerticalDateScrubberProps> = ({ dates, activeDate, onSelectDate }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [dragTop, setDragTop] = useState(0);
  const rafRef = useRef<number | null>(null);
  const pendingClientYRef = useRef<number | null>(null);

  // Ticks: show a label at the start of each month (based on index position),
  // capped so labels don't overlap on long ranges.
  const ticks = useMemo(() => {
    const result: { index: number; label: string }[] = [];
    let lastMonthKey = '';
    dates.forEach((date, index) => {
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) return;
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
      if (monthKey !== lastMonthKey) {
        result.push({ index, label: `${MONTH_LABELS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` '${String(d.getFullYear()).slice(2)}` : ''}` });
        lastMonthKey = monthKey;
      }
    });
    // Avoid overcrowding: if there are many more ticks than reasonably fit,
    // thin them out to roughly one per ~28px assuming a ~600px track.
    const maxTicks = 18;
    if (result.length > maxTicks) {
      const step = Math.ceil(result.length / maxTicks);
      return result.filter((_, i) => i % step === 0);
    }
    return result;
  }, [dates]);

  const activeIndex = activeDate ? dates.indexOf(activeDate) : -1;

  const dateForClientY = useCallback((clientY: number): { date: string; ratio: number } | null => {
    const track = trackRef.current;
    if (!track || dates.length === 0) return null;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const index = Math.min(dates.length - 1, Math.round(ratio * (dates.length - 1)));
    return { date: dates[index], ratio };
  }, [dates]);

  const applyClientY = useCallback((clientY: number) => {
    const result = dateForClientY(clientY);
    if (!result) return;
    setDragLabel(formatBubbleLabel(result.date));
    setDragTop(result.ratio * (trackRef.current?.clientHeight || 0));
    onSelectDate(result.date);
  }, [dateForClientY, onSelectDate]);

  const scheduleApply = useCallback((clientY: number) => {
    pendingClientYRef.current = clientY;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (pendingClientYRef.current !== null) {
        applyClientY(pendingClientYRef.current);
      }
    });
  }, [applyClientY]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    scheduleApply(e.clientY);
  }, [scheduleApply]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    scheduleApply(e.clientY);
  }, [dragging, scheduleApply]);

  const endDrag = useCallback(() => {
    setDragging(false);
    setDragLabel(null);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (dates.length === 0) return;
    const currentIndex = activeIndex >= 0 ? activeIndex : 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      onSelectDate(dates[Math.min(dates.length - 1, currentIndex + 1)]);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onSelectDate(dates[Math.max(0, currentIndex - 1)]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSelectDate(dates[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSelectDate(dates[dates.length - 1]);
    }
  }, [dates, activeIndex, onSelectDate]);

  if (dates.length <= 1) return null;

  const activeRatio = activeIndex >= 0 ? activeIndex / Math.max(1, dates.length - 1) : 0;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Jump to date"
      aria-valuemin={0}
      aria-valuemax={dates.length - 1}
      aria-valuenow={activeIndex >= 0 ? activeIndex : 0}
      aria-valuetext={activeDate ? formatBubbleLabel(activeDate) : undefined}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="fixed right-0 top-24 bottom-16 w-6 sm:w-7 z-40 flex flex-col items-center cursor-pointer touch-none select-none"
    >
      {/* Track background */}
      <div className="absolute inset-y-0 right-1 w-1 rounded-full bg-gray-300/60 dark:bg-gray-600/50" />

      {/* Month/year tick labels */}
      {ticks.map(({ index, label }) => (
        <span
          key={index}
          className="absolute right-2.5 -translate-y-1/2 text-[9px] font-medium text-gray-500 dark:text-gray-400 pointer-events-none whitespace-nowrap"
          style={{ top: `${(index / Math.max(1, dates.length - 1)) * 100}%` }}
        >
          {label}
        </span>
      ))}

      {/* Active position indicator */}
      {activeIndex >= 0 && (
        <div
          className="absolute right-0.5 w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-500 shadow pointer-events-none -translate-y-1/2"
          style={{ top: `${activeRatio * 100}%` }}
        />
      )}

      {/* Floating date bubble while dragging */}
      {dragging && dragLabel && (
        <div
          className="absolute right-8 -translate-y-1/2 px-3 py-1.5 rounded-full bg-blue-600 text-white text-sm font-semibold shadow-lg whitespace-nowrap pointer-events-none animate-in fade-in zoom-in-95 duration-100"
          style={{ top: dragTop }}
        >
          {dragLabel}
        </div>
      )}
    </div>
  );
};

export default VerticalDateScrubber;
