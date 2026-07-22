import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import InviteAccept from '../pages/InviteAccept';

const mockAcceptInvite = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../api', () => ({
  acceptInvite: (...args: any[]) => mockAcceptInvite(...args),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

let mockUser: any = { id: 'user1', email: 'user@example.com' };
let mockAuthLoading = false;

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, loading: mockAuthLoading }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

const renderInvite = (token = 'abc123') =>
  render(
    <MemoryRouter initialEntries={[`/invite/${token}`]}>
      <Routes>
        <Route path="/invite/:token" element={<InviteAccept />} />
      </Routes>
    </MemoryRouter>
  );

describe('InviteAccept', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 'user1', email: 'user@example.com' };
    mockAuthLoading = false;
  });

  it('shows success and redirects when the invite is accepted', async () => {
    mockAcceptInvite.mockResolvedValue({ eventSlug: 'my-event', eventName: 'My Event', success: true });

    renderInvite();

    await waitFor(() => expect(screen.getByText('Welcome!')).toBeInTheDocument());
  });

  it('redirects immediately to the event (no error screen) when already a collaborator', async () => {
    mockAcceptInvite.mockRejectedValue({
      response: { data: { error: 'Already a collaborator', eventSlug: 'existing-event' } },
    });

    renderInvite();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/events/existing-event', { replace: true }));

    // Should not show the generic "unable to accept" error UI
    expect(screen.queryByText('Unable to Accept Invitation')).not.toBeInTheDocument();
  });

  it('shows the error screen for real failures without an eventSlug', async () => {
    mockAcceptInvite.mockRejectedValue({
      response: { data: { error: 'Invite expired' } },
    });

    renderInvite();

    await waitFor(() => expect(screen.getByText('Unable to Accept Invitation')).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
