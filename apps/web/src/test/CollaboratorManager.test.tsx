import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react'; 
import '@testing-library/jest-dom';
import CollaboratorManager from '../components/CollaboratorManager';
import * as api from '../api';

// Mock the API
vi.mock('../api');

describe('CollaboratorManager', () => {
  const mockEventSlug = 'test-event';
  const mockEventName = 'Test Event';
  
  const mockCollaborators = [
    {
      event_id: 1,
      user_email: 'user1@example.com',
      email: 'user1@example.com',
      name: 'User One',
      invited_by: 'admin1',
      invited_at: '2024-01-01T00:00:00Z',
      status: 'accepted' as const,
      role: 'editor' as const,
    },
    {
      event_id: 1,
      user_email: 'user2@example.com',
      email: 'user2@example.com',
      name: null,
      invited_by: 'admin1',
      invited_at: '2024-01-02T00:00:00Z',
      status: 'pending' as const,
      role: 'uploader' as const,
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getInviteLinks).mockResolvedValue([]);
    vi.mocked(api.searchUsers).mockResolvedValue([]);
    vi.mocked(api.createInviteLink).mockResolvedValue({
      id: 1,
      token: 'invite-token',
      event_id: 1,
      created_by: 'admin1',
      created_at: '2024-01-01T00:00:00Z',
      revoked_at: null,
      use_count: 0,
      last_used_at: null,
      role: 'uploader',
    });
    vi.mocked(api.revokeInviteLink).mockResolvedValue(undefined);
  });

  it('renders loading state initially', () => {
    vi.mocked(api.getCollaborators).mockReturnValue(new Promise(() => {}));
    
    render(<CollaboratorManager eventSlug={mockEventSlug} eventName={mockEventName} />);
    
    expect(screen.getByText('Loading collaborators...')).toBeInTheDocument();
  });

  it('displays collaborators list', async () => {
    vi.mocked(api.getCollaborators).mockResolvedValue(mockCollaborators);
    
    render(<CollaboratorManager eventSlug={mockEventSlug} eventName={mockEventName} />);
    
    await waitFor(() => {
      expect(screen.getByText('User One')).toBeInTheDocument();
      expect(screen.getByText('user1@example.com')).toBeInTheDocument();
      expect(screen.getByText('user2@example.com')).toBeInTheDocument();
    });
  });

  it('shows role badges for collaborators', async () => {
    vi.mocked(api.getCollaborators).mockResolvedValue(mockCollaborators);
    
    render(<CollaboratorManager eventSlug={mockEventSlug} eventName={mockEventName} />);
    
    await waitFor(() => {
      expect(screen.getByText('editor')).toBeInTheDocument();
      expect(screen.getByText('uploader')).toBeInTheDocument();
    });
  });

  it('displays empty state when no collaborators', async () => {
    vi.mocked(api.getCollaborators).mockResolvedValue([]);
    
    render(<CollaboratorManager eventSlug={mockEventSlug} eventName={mockEventName} />);
    
    await waitFor(() => {
      expect(screen.getByText('No collaborators yet')).toBeInTheDocument();
    });
  });

  it('allows inviting a new collaborator', async () => {
    vi.mocked(api.getCollaborators).mockResolvedValue([]);
    vi.mocked(api.inviteCollaborator).mockResolvedValue({ 
      message: 'Collaborator invited successfully',
      collaborator: {
        user_id: 'user3',
        email: 'newuser@example.com',
        name: null,
        status: 'pending',
        role: 'uploader'
      }
    });
    
    render(<CollaboratorManager eventSlug={mockEventSlug} eventName={mockEventName} />);
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText('collaborator@example.com')).toBeInTheDocument();
    });
    
    const emailInput = screen.getByPlaceholderText('collaborator@example.com');
    const inviteButton = screen.getByText('Invite');
    
    fireEvent.change(emailInput, { target: { value: 'newuser@example.com' } });
    fireEvent.click(inviteButton);
    
    await waitFor(() => {
      expect(api.inviteCollaborator).toHaveBeenCalledWith(mockEventSlug, 'newuser@example.com', 'uploader');
      expect(screen.getByText(/Invitation sent to/)).toBeInTheDocument();
    });
  });

  it('validates email before inviting', async () => {
    vi.mocked(api.getCollaborators).mockResolvedValue([]);
    
    render(<CollaboratorManager eventSlug={mockEventSlug} eventName={mockEventName} />);
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText('collaborator@example.com')).toBeInTheDocument();
    });
    
    const emailInput = screen.getByPlaceholderText('collaborator@example.com');
    const inviteButton = screen.getByText('Invite');
    
    // Try with invalid email
    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    fireEvent.click(inviteButton);
    
    await waitFor(() => {
      expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
    });
    
    expect(api.inviteCollaborator).not.toHaveBeenCalled();
  });

  it('allows removing a collaborator', async () => {
    vi.mocked(api.getCollaborators).mockResolvedValue(mockCollaborators);
    vi.mocked(api.removeCollaborator).mockResolvedValue(undefined);
    global.confirm = vi.fn(() => true);
    
    render(<CollaboratorManager eventSlug={mockEventSlug} eventName={mockEventName} />);
    
    await waitFor(() => {
      expect(screen.getByText('User One')).toBeInTheDocument();
    });
    
    const removeButtons = screen.getAllByTitle('Remove collaborator');
    fireEvent.click(removeButtons[0]);
    
    await waitFor(() => {
      expect(api.removeCollaborator).toHaveBeenCalledWith(mockEventSlug, 'user1@example.com');
    });
  });

  it('displays error message when invite fails', async () => {
    vi.mocked(api.getCollaborators).mockResolvedValue([]);
    vi.mocked(api.inviteCollaborator).mockRejectedValue(
      { response: { data: { error: 'User is already a collaborator' } } }
    );
    
    render(<CollaboratorManager eventSlug={mockEventSlug} eventName={mockEventName} />);
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText('collaborator@example.com')).toBeInTheDocument();
    });
    
    const emailInput = screen.getByPlaceholderText('collaborator@example.com');
    const inviteButton = screen.getByText('Invite');
    
    fireEvent.change(emailInput, { target: { value: 'existing@example.com' } });
    fireEvent.click(inviteButton);
    
    await waitFor(() => {
      expect(screen.getByText('User is already a collaborator')).toBeInTheDocument();
    });
  });
});
