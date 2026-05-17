import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ModalOverlay from '../components/ModalOverlay';

describe('ModalOverlay', () => {
  it('renders children with proper ARIA attributes', () => {
    render(
      <ModalOverlay onClose={() => {}} label="Test dialog">
        <p>Modal content</p>
      </ModalOverlay>
    );
    
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Test dialog');
    expect(screen.getByText('Modal content')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <ModalOverlay onClose={onClose} label="Test dialog">
        <p>Content</p>
      </ModalOverlay>
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sets body overflow to hidden while open', () => {
    const { unmount } = render(
      <ModalOverlay onClose={() => {}} label="Test dialog">
        <p>Content</p>
      </ModalOverlay>
    );

    expect(document.body.style.overflow).toBe('hidden');
    unmount();
  });

  it('applies custom className', () => {
    render(
      <ModalOverlay onClose={() => {}} label="Test" className="z-[9999]">
        <p>Content</p>
      </ModalOverlay>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('z-[9999]');
  });
});
