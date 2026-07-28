import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GallerySortFilter } from '../components/GallerySortFilter';

const baseProps = {
  sortBy: 'date_desc',
  onSortChange: vi.fn(),
  searchQuery: '',
  onSearchChange: vi.fn(),
  selectedCount: 0,
  onDownloadSelected: vi.fn(),
};

describe('media type filter', () => {
  it('does not render the filter when onMediaTypeFilterChange is not provided', () => {
    render(<GallerySortFilter {...baseProps} />);
    expect(screen.queryByLabelText('Show photos only')).not.toBeInTheDocument();
  });

  it('renders All/Photos/Videos controls and reports the active one', () => {
    render(<GallerySortFilter {...baseProps} mediaTypeFilter="all" onMediaTypeFilterChange={vi.fn()} />);
    expect(screen.getByLabelText('Show all media')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Show photos only')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Show videos only')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onMediaTypeFilterChange with "photos" when the Photos button is clicked', () => {
    const onChange = vi.fn();
    render(<GallerySortFilter {...baseProps} mediaTypeFilter="all" onMediaTypeFilterChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Show photos only'));
    expect(onChange).toHaveBeenCalledWith('photos');
  });

  it('calls onMediaTypeFilterChange with "videos" when the Videos button is clicked', () => {
    const onChange = vi.fn();
    render(<GallerySortFilter {...baseProps} mediaTypeFilter="all" onMediaTypeFilterChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Show videos only'));
    expect(onChange).toHaveBeenCalledWith('videos');
  });
});
