import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Navbar from '../components/Navbar';

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

  it('does not show logout button when not admin', () => {
    render(
      <BrowserRouter>
        <Navbar />
      </BrowserRouter>
    );
    
    expect(screen.queryByText('Logout')).not.toBeInTheDocument();
  });

  it('shows logout button when isAdmin is true', () => {
    localStorage.setItem('isAdmin', 'true');
    
    render(
      <BrowserRouter>
        <Navbar />
      </BrowserRouter>
    );
    
    // Use getAllByText because we have duplicate spans
    expect(screen.getAllByText('Logout')[0]).toBeInTheDocument();
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
