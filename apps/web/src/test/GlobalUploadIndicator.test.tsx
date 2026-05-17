import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import GlobalUploadIndicator from '../components/GlobalUploadIndicator';

// Mock the UploadContext
const mockCancelUpload = vi.fn();
const mockCancelAll = vi.fn();
const mockRetryUpload = vi.fn();
const mockRetryAllFailed = vi.fn();
const mockClearCompleted = vi.fn();

let mockContextValue = {
  queueItems: [] as any[],
  getItemsForSlug: () => [],
  addFiles: vi.fn(),
  retryUpload: mockRetryUpload,
  retryAllFailed: mockRetryAllFailed,
  clearCompleted: mockClearCompleted,
  cancelUpload: mockCancelUpload,
  cancelAll: mockCancelAll,
  hasActiveUploads: false,
  hasFailedUploads: false,
  completedCount: 0,
  totalCount: 0,
  overallProgress: 0,
};

vi.mock('../contexts/UploadContext', () => ({
  useUploadContext: () => mockContextValue,
}));

const renderIndicator = () =>
  render(
    <BrowserRouter>
      <GlobalUploadIndicator />
    </BrowserRouter>
  );

describe('GlobalUploadIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when queue is empty', () => {
    mockContextValue = {
      ...mockContextValue,
      queueItems: [],
      totalCount: 0,
    };
    const { container } = renderIndicator();
    expect(container.innerHTML).toBe('');
  });

  it('shows cancel button on uploading items in expanded view', () => {
    const uploadingItem = {
      id: 'test-1',
      eventSlug: 'event1',
      photoId: 'photo1',
      file: { name: 'test.jpg' },
      fileType: 'image/jpeg',
      status: 'uploading',
      progress: 50,
      retries: 0,
    };

    mockContextValue = {
      ...mockContextValue,
      queueItems: [uploadingItem],
      hasActiveUploads: true,
      totalCount: 1,
      overallProgress: 50,
    };

    renderIndicator();

    // Click to expand
    fireEvent.click(screen.getByText(/Uploading 1 item/));

    // Should show cancel button
    const cancelBtn = screen.getByTitle('Cancel');
    expect(cancelBtn).toBeInTheDocument();

    // Click cancel
    fireEvent.click(cancelBtn);
    expect(mockCancelUpload).toHaveBeenCalledWith('test-1');
  });

  it('shows Cancel All button when uploads are active', () => {
    const items = [
      { id: '1', eventSlug: 'e1', photoId: 'p1', file: { name: 'a.jpg' }, fileType: 'image/jpeg', status: 'uploading', progress: 30, retries: 0 },
      { id: '2', eventSlug: 'e1', photoId: 'p2', file: { name: 'b.jpg' }, fileType: 'image/jpeg', status: 'pending', progress: 0, retries: 0 },
    ];

    mockContextValue = {
      ...mockContextValue,
      queueItems: items,
      hasActiveUploads: true,
      totalCount: 2,
      overallProgress: 15,
    };

    renderIndicator();

    // Click to expand
    fireEvent.click(screen.getByText(/Uploading 2 items/));

    // Should show Cancel All
    const cancelAllBtn = screen.getByText('Cancel All');
    expect(cancelAllBtn).toBeInTheDocument();

    fireEvent.click(cancelAllBtn);
    expect(mockCancelAll).toHaveBeenCalledTimes(1);
  });

  it('does not show cancel button on completed items', () => {
    const completedItem = {
      id: 'done-1',
      eventSlug: 'e1',
      photoId: 'p1',
      file: { name: 'done.jpg' },
      fileType: 'image/jpeg',
      status: 'completed',
      progress: 100,
      retries: 0,
    };

    mockContextValue = {
      ...mockContextValue,
      queueItems: [completedItem],
      hasActiveUploads: false,
      completedCount: 1,
      totalCount: 1,
      overallProgress: 100,
    };

    renderIndicator();
    fireEvent.click(screen.getByText(/1 upload complete/));

    expect(screen.queryByTitle('Cancel')).not.toBeInTheDocument();
  });
});
