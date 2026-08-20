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

describe('selectionBarOnly mode (Timeline)', () => {
  it('hides the sort/filter card but still shows the selection action bar when photos are selected', () => {
    render(
      <GallerySortFilter
        {...baseProps}
        selectionBarOnly
        selectedCount={3}
        onMediaTypeFilterChange={vi.fn()}
        mediaTypeFilter="all"
        onClearSelection={vi.fn()}
      />
    );
    // Sort/filter card is skipped...
    expect(screen.queryByLabelText('Sort by')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Show photos only')).not.toBeInTheDocument();
    // ...but the selection action bar renders (Download is always available).
    expect(screen.getByText('3 photos')).toBeInTheDocument();
    expect(screen.getByTitle('Download as ZIP')).toBeInTheDocument();
  });

  it('still renders the sort/filter card normally when selectionBarOnly is not set', () => {
    render(<GallerySortFilter {...baseProps} />);
    expect(screen.getByLabelText('Sort by')).toBeInTheDocument();
  });
});
