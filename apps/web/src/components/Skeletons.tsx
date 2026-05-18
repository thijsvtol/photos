import React from 'react';

/** Animated shimmer block with gradient sweep */
const Shimmer: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className = '', style }) => (
  <div
    className={`animate-shimmer rounded bg-gray-200 dark:bg-gray-700/60 ${className}`}
    style={{
      backgroundImage: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)',
      backgroundSize: '200% 100%',
      ...style,
    }}
  />
);

/** Skeleton for an event card in EventList */
export const EventCardSkeleton: React.FC = () => (
  <div className="bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow-sm border border-gray-200 dark:border-gray-700">
    <Shimmer className="w-full aspect-[16/10] rounded-none" />
    <div className="p-4 space-y-3">
      <Shimmer className="h-5 w-3/4" />
      <Shimmer className="h-4 w-1/2" />
      <div className="flex gap-2 pt-1">
        <Shimmer className="h-6 w-16 rounded-full" />
        <Shimmer className="h-6 w-20 rounded-full" />
      </div>
    </div>
  </div>
);

/** Skeleton grid for EventList page */
export const EventListSkeleton: React.FC = () => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
    {Array.from({ length: 6 }).map((_, i) => (
      <EventCardSkeleton key={i} />
    ))}
  </div>
);

/** Skeleton for a justified photo grid row */
export const GalleryRowSkeleton: React.FC = () => {
  const rows = [
    [{ flex: 1.5, aspect: '4/3' }, { flex: 1, aspect: '3/4' }, { flex: 1.8, aspect: '16/9' }, { flex: 1.2, aspect: '4/3' }],
    [{ flex: 1.3, aspect: '3/2' }, { flex: 1.6, aspect: '16/9' }, { flex: 1, aspect: '1/1' }],
    [{ flex: 1, aspect: '3/4' }, { flex: 1.4, aspect: '4/3' }, { flex: 1.7, aspect: '16/9' }, { flex: 1.1, aspect: '3/2' }],
  ];
  return (
    <div className="space-y-1">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1" style={{ height: '150px' }}>
          {row.map((item, j) => (
            <Shimmer
              key={j}
              className="rounded-sm"
              style={{ flex: item.flex } as React.CSSProperties}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

/** Skeleton for a gallery page with date header + grid */
export const GallerySkeleton: React.FC = () => (
  <div className="space-y-6">
    {/* Fake date header */}
    <div className="space-y-3">
      <Shimmer className="h-7 w-48" />
      <Shimmer className="h-4 w-24" />
    </div>
    <GalleryRowSkeleton />
    <div className="space-y-3 mt-8">
      <Shimmer className="h-7 w-56" />
      <Shimmer className="h-4 w-20" />
    </div>
    <GalleryRowSkeleton />
  </div>
);

/** Skeleton for Timeline page */
export const TimelineSkeleton: React.FC = () => (
  <div className="space-y-8">
    {Array.from({ length: 3 }).map((_, i) => (
      <div key={i} className="space-y-3">
        <Shimmer className="h-6 w-40" />
        <GalleryRowSkeleton />
      </div>
    ))}
  </div>
);
