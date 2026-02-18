import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Footer from '../components/Footer';
import { getConfig } from '../config';

describe('Footer Component', () => {
  it('renders copyright text with current year', () => {
    render(
      <BrowserRouter>
        <Footer />
      </BrowserRouter>
    );
    
    const currentYear = new Date().getFullYear();
    const config = getConfig();
    expect(screen.getByText(new RegExp(`© ${currentYear} ${config.copyrightHolder}`))).toBeInTheDocument();
  });

  it('renders photo usage rights link', () => {
    render(
      <BrowserRouter>
        <Footer />
      </BrowserRouter>
    );
    
    const link = screen.getByText('Photo Usage Rights');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/usage');
  });

  it('has proper accessibility structure', () => {
    const { container } = render(
      <BrowserRouter>
        <Footer />
      </BrowserRouter>
    );
    
    const footer = container.querySelector('footer');
    expect(footer).toBeInTheDocument();
    expect(footer).toHaveClass('bg-gray-900');
  });
});
