import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Navbar from '../components/Navbar';

const authState = {
  user: { id: '1', email: 'admin@example.com', name: 'Admin', isAdmin: true },
  isAuthenticated: true,
  login: vi.fn(),
  logout: vi.fn(),
};

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../components/UserSettings', () => ({
  default: () => null,
}));

// Mock the api module
vi.mock('../api', () => ({
  adminLogout: vi.fn(),
}));

vi.mock('../contexts/UploadContext', () => ({
  useUploadContext: () => ({
    queueItems: [],
    getItemsForSlug: () => [],
    addFiles: vi.fn(),
    retryUpload: vi.fn(),
    retryAllFailed: vi.fn(),
    clearCompleted: vi.fn(),
    cancelUpload: vi.fn(),
    cancelAll: vi.fn(),
    hasActiveUploads: false,
    hasFailedUploads: false,
    completedCount: 0,
    totalCount: 0,
    overallProgress: 0,
  }),
}));

describe('Navbar Component', () => {
  it('renders all navigation links', () => {
    render(
      <BrowserRouter>
        <Navbar />
      </BrowserRouter>
    );
    
    // Use getAllByText because we have duplicate spans (one visible, one sr-only)
    expect(screen.getAllByText('Events')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Favorites')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Map')[0]).toBeInTheDocument();
  });

  it('renders logo with correct link', () => {
    render(
      <BrowserRouter>
        <Navbar />
      </BrowserRouter>
    );
    
    const logoLink = screen.getByAltText('Logo').closest('a');
    expect(logoLink).toHaveAttribute('href', '/');
  });



  it('shows user menu trigger when authenticated', () => {
    authState.user = { id: '1', email: 'admin@example.com', name: 'Admin', isAdmin: true };

    render(
      <BrowserRouter>
        <Navbar />
      </BrowserRouter>
    );

    expect(screen.getByLabelText('User menu')).toBeInTheDocument();
  });

  it('has proper semantic HTML structure', () => {
    const { container } = render(
      <BrowserRouter>
        <Navbar />
      </BrowserRouter>
    );
    
    const nav = container.querySelector('nav');
    expect(nav).toBeInTheDocument();
  });
});
