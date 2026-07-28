import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAndroidBackButton } from '../hooks/useAndroidBackButton';

const mockNavigate = vi.fn();
let backButtonHandler: ((info: { canGoBack: boolean }) => void) | null = null;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn((_event: string, handler: (info: { canGoBack: boolean }) => void) => {
      backButtonHandler = handler;
      return Promise.resolve({ remove: vi.fn() });
    }),
    minimizeApp: vi.fn(),
  },
}));

function renderAt(path: string, state?: unknown) {
  return renderHook(() => useAndroidBackButton(), {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[{ pathname: path, state }]}>{children}</MemoryRouter>
    ),
  });
}

describe('useAndroidBackButton', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    backButtonHandler = null;
  });

  it('pops history (navigate(-1)) from photo detail back to gallery when history is available', () => {
    renderAt('/p/my-event/photo123');
    expect(backButtonHandler).not.toBeNull();

    backButtonHandler!({ canGoBack: true });

    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('falls back to pushing the event gallery route when there is no history to pop', () => {
    renderAt('/p/my-event/photo123');
    backButtonHandler!({ canGoBack: false });

    expect(mockNavigate).toHaveBeenCalledWith('/events/my-event');
  });

  it('falls back to favorites when there is no history and state.fromFavorites is set', () => {
    renderAt('/p/my-event/photo123', { fromFavorites: true });
    backButtonHandler!({ canGoBack: false });

    expect(mockNavigate).toHaveBeenCalledWith('/favorites');
  });

  it('navigates to /events from a top-level gallery view', () => {
    renderAt('/events/my-event');
    backButtonHandler!({ canGoBack: true });

    expect(mockNavigate).toHaveBeenCalledWith('/events');
  });
});
