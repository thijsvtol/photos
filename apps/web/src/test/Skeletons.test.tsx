import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EventCardSkeleton, EventListSkeleton, GalleryRowSkeleton, GallerySkeleton, TimelineSkeleton } from '../components/Skeletons';

describe('Skeleton components', () => {
  it('renders EventCardSkeleton', () => {
    const { container } = render(<EventCardSkeleton />);
    // Should have multiple animated shimmer elements
    const pulseElements = container.querySelectorAll('.animate-shimmer');
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  it('renders EventListSkeleton with 6 cards', () => {
    const { container } = render(<EventListSkeleton />);
    // 6 cards, each with multiple shimmer elements
    const pulseElements = container.querySelectorAll('.animate-shimmer');
    expect(pulseElements.length).toBeGreaterThanOrEqual(6);
  });

  it('renders GalleryRowSkeleton with rows', () => {
    const { container } = render(<GalleryRowSkeleton />);
    const pulseElements = container.querySelectorAll('.animate-shimmer');
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  it('renders GallerySkeleton', () => {
    const { container } = render(<GallerySkeleton />);
    const pulseElements = container.querySelectorAll('.animate-shimmer');
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  it('renders TimelineSkeleton', () => {
    const { container } = render(<TimelineSkeleton />);
    const pulseElements = container.querySelectorAll('.animate-shimmer');
    expect(pulseElements.length).toBeGreaterThan(0);
  });
});
