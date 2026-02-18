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
    expect(screen.getAllByText('Admin')[0]).toBeInTheDocument();
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

  it('shows Admin link', () => {
    render(
      <BrowserRouter>
        <Navbar />
      </BrowserRouter>
    );
    
    // Use getAllByText because we have duplicate spans
    const adminLinks = screen.getAllByText(/Admin/i);
    expect(adminLinks[0]).toBeInTheDocument();
    expect(adminLinks[0].closest('a')).toHaveAttribute('href', '/admin');
  });

  it('hides Admin link when user is not admin', () => {
    authState.user = { id: '2', email: 'user@example.com', name: 'User', isAdmin: false };

    render(
      <BrowserRouter>
        <Navbar />
      </BrowserRouter>
    );

    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
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
