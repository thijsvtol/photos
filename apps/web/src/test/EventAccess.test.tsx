import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import EventGallery from '../pages/EventGallery';
import PhotoDetail from '../pages/PhotoDetail';
import * as api from '../api';

vi.mock('../api', () => ({
  getEvent: vi.fn(),
  getPhotos: vi.fn(),
  getPhoto: vi.fn(),
  loginToEvent: vi.fn(),
  getPreviewUrl: vi.fn(),
  downloadOriginal: vi.fn(),
  downloadSmall: vi.fn(),
  toggleFavorite: vi.fn(),
  getUserFavoriteIds: vi.fn(),
  requestZip: vi.fn(),
  downloadZip: vi.fn(),
  setPhotoFeatured: vi.fn(),
  getUserCollaborations: vi.fn(),
  getCollaborators: vi.fn(),
  getInviteLinks: vi.fn(),
  createInviteLink: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    login: vi.fn(),
    user: null,
  }),
}));

vi.mock('../contexts/RefreshContext', () => ({
  useRefresh: () => ({
    registerRefreshHandler: vi.fn(),
    unregisterRefreshHandler: vi.fn(),
  }),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showInfo: vi.fn(),
  }),
}));

vi.mock('../components/ConfirmDialog', () => ({
  useConfirm: () => ({
    confirm: vi.fn().mockResolvedValue(false),
    ConfirmDialog: null,
  }),
}));

vi.mock('../hooks/usePhotoSelection', () => ({
  usePhotoSelection: () => ({
    selectedPhotos: new Set(),
    togglePhotoSelection: vi.fn(),
    clearSelection: vi.fn(),
    toggleDateSelection: vi.fn(),
    isDateFullySelected: vi.fn(),
  }),
}));

vi.mock('../utils/haptics', () => ({
  haptics: {
    light: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

describe('Event access UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getEvent).mockResolvedValue({
      id: 1,
      slug: 'test-event',
      name: 'Test Event',
      requires_password: false,
      visibility: 'public',
      inferred_date: null,
      created_at: '2024-01-01',
      cities: [],
    } as any);
    vi.mocked(api.getPhotos).mockResolvedValue([]);
    vi.mocked(api.getUserFavoriteIds).mockResolvedValue([] as any);
    vi.mocked(api.getUserCollaborations).mockResolvedValue({ collaborations: [] } as any);
    vi.mocked(api.getCollaborators).mockResolvedValue({ collaborators: [] } as any);
    vi.mocked(api.getInviteLinks).mockResolvedValue([] as any);
    vi.mocked(api.createInviteLink).mockResolvedValue({} as any);
    vi.mocked(api.getPhoto).mockResolvedValue({
      id: 'photo-1',
      event_id: 1,
      original_filename: 'test.jpg',
      file_type: 'image/jpeg',
      capture_time: '2024-01-01T10:00:00Z',
      uploaded_at: '2024-01-01T10:00:00Z',
      uploaded_by: null,
      width: 1000,
      height: 800,
      iso: null,
      aperture: null,
      shutter_speed: null,
      focal_length: null,
      camera_make: null,
      camera_model: null,
      lens_model: null,
      latitude: null,
      longitude: null,
      favorites_count: 0,
      blur_placeholder: null,
      is_featured: 0,
    } as any);
  });

  it('shows an error when event load fails', async () => {
    vi.mocked(api.getEvent).mockRejectedValue(new Error('Access forbidden'));

    render(
      <MemoryRouter initialEntries={['/events/test-event']}>
        <Routes>
          <Route path="/events/:slug" element={<EventGallery />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load event')).toBeInTheDocument();
    });
  });

  it('shows an error when photo load fails', async () => {
    vi.mocked(api.getEvent).mockRejectedValue(new Error('Access forbidden'));

    render(
      <MemoryRouter initialEntries={['/p/test-event/photo-1']}>
        <Routes>
          <Route path="/p/:slug/:photoId" element={<PhotoDetail />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load photo')).toBeInTheDocument();
    });
  });
});
