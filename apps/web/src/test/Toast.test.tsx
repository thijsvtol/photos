import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../components/Toast';

const TestTrigger: React.FC = () => {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.showSuccess('Success!')}>Show Success</button>
      <button onClick={() => toast.showError('Error!')}>Show Error</button>
      <button onClick={() => toast.showInfo('Info!')}>Show Info</button>
    </div>
  );
};

describe('Toast accessibility', () => {
  it('renders success toast with role="status"', async () => {
    render(
      <ToastProvider>
        <TestTrigger />
      </ToastProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Show Success'));
    });

    const toast = screen.getByText('Success!').closest('[role="status"]');
    expect(toast).toBeInTheDocument();
  });

  it('renders error toast with role="alert"', async () => {
    render(
      <ToastProvider>
        <TestTrigger />
      </ToastProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Show Error'));
    });

    const toast = screen.getByText('Error!').closest('[role="alert"]');
    expect(toast).toBeInTheDocument();
  });

  it('renders info toast with role="status"', async () => {
    render(
      <ToastProvider>
        <TestTrigger />
      </ToastProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Show Info'));
    });

    const toast = screen.getByText('Info!').closest('[role="status"]');
    expect(toast).toBeInTheDocument();
  });

  it('toast container has aria-live attribute', async () => {
    const { baseElement } = render(
      <ToastProvider>
        <TestTrigger />
      </ToastProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Show Success'));
    });

    const container = baseElement.querySelector('[aria-live="polite"]');
    expect(container).toBeInTheDocument();
  });
});
