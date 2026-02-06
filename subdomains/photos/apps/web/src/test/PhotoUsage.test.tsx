import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import PhotoUsage from '../pages/PhotoUsage';

describe('PhotoUsage Page', () => {
  it('renders main heading', () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <PhotoUsage />
        </MemoryRouter>
      </HelmetProvider>
    );
    
    expect(screen.getByRole('heading', { name: /Photo Usage Rights/i, level: 1 })).toBeInTheDocument();
  });

  it('displays personal use section', () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <PhotoUsage />
        </MemoryRouter>
      </HelmetProvider>
    );
    
    expect(screen.getByRole('heading', { name: /Personal Use/i })).toBeInTheDocument();
    expect(screen.getByText(/personal social media posts/i)).toBeInTheDocument();
  });

  it('displays required attribution section', () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <PhotoUsage />
        </MemoryRouter>
      </HelmetProvider>
    );
    
    expect(screen.getByRole('heading', { name: /Required Attribution/i })).toBeInTheDocument();
    expect(screen.getByText(/📷 Photo by/)).toBeInTheDocument();
    expect(screen.getByText(/photos.thijsvtol.nl/)).toBeInTheDocument();
  });

  it('displays commercial use section', () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <PhotoUsage />
        </MemoryRouter>
      </HelmetProvider>
    );
    
    expect(screen.getByRole('heading', { name: /Commercial Use/i })).toBeInTheDocument();
  });

  it('displays contact section with link to contact form', () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <PhotoUsage />
        </MemoryRouter>
      </HelmetProvider>
    );
    
    const contactButton = screen.getByRole('link', { name: /Contact via Form/i });
    expect(contactButton).toBeInTheDocument();
    expect(contactButton).toHaveAttribute('href', 'https://photos.thijsvtol.nl/#contact');
  });

  it('displays copyright notice with current year', () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <PhotoUsage />
        </MemoryRouter>
      </HelmetProvider>
    );
    
    const currentYear = new Date().getFullYear();
    expect(screen.getByText(/Copyright Notice:/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`All photos on this website are © ${currentYear} Thijs van Tol`))).toBeInTheDocument();
  });

  it('has proper semantic heading hierarchy', () => {
    const { container } = render(
      <HelmetProvider>
        <MemoryRouter>
          <PhotoUsage />
        </MemoryRouter>
      </HelmetProvider>
    );
    
    const h1 = container.querySelectorAll('h1');
    const h2 = container.querySelectorAll('h2');
    
    expect(h1).toHaveLength(1);
    expect(h2.length).toBeGreaterThan(0);
  });
});
