import React, { useState, useEffect, useRef } from 'react';
import { UserPlus, X, Mail, Check, Clock, XCircle } from 'lucide-react';
import { getCollaborators, inviteCollaborator, removeCollaborator, searchUsers } from '../api';
import type { Collaborator } from '../types';

interface CollaboratorManagerProps {
  eventSlug: string;
  eventName: string;
}

const CollaboratorManager: React.FC<CollaboratorManagerProps> = ({ eventSlug, eventName }) => {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ id: string; email: string; name: string | null }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadCollaborators();
  }, [eventSlug]);

  useEffect(() => {
    // Close suggestions when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleEmailChange = (value: string) => {
    setInviteEmail(value);
    
    // Clear previous timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    
    // Don't search if input is too short
    if (value.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    
    // Debounce search
    const timeout = setTimeout(async () => {
      try {
        const users = await searchUsers(value);
        setSuggestions(users);
        setShowSuggestions(users.length > 0);
      } catch (err) {
        console.error('Failed to search users:', err);
      }
    }, 300);
    
    setSearchTimeout(timeout);
  };

  const selectSuggestion = (email: string) => {
    setInviteEmail(email);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const loadCollaborators = async () => {
    try {
      setLoading(true);
      const data = await getCollaborators(eventSlug);
      setCollaborators(data);
      setError(null);
    } catch (err) {
      console.error('Failed to load collaborators:', err);
      setError('Failed to load collaborators');
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    
    console.log('[CollaboratorManager] Starting invite for:', inviteEmail);
    
    if (!inviteEmail || !inviteEmail.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    try {
      setInviting(true);
      setError(null);
      setSuccess(null);
      
      console.log('[CollaboratorManager] Calling inviteCollaborator API...');
      const result = await inviteCollaborator(eventSlug, inviteEmail);
      console.log('[CollaboratorManager] Invite successful:', result);
      
      setSuccess(`Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
      
      // Reload collaborators list
      console.log('[CollaboratorManager] Reloading collaborators list...');
      await loadCollaborators();
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('[CollaboratorManager] Failed to invite collaborator:', err);
      console.error('[CollaboratorManager] Error details:', {
        message: err.message,
        response: err.response,
        status: err.response?.status,
        data: err.response?.data
      });
      setError(err.response?.data?.error || err.message || 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (userId: string, email: string) => {
    if (!confirm(`Remove ${email} as a collaborator? They will no longer be able to upload photos to this event.`)) {
      return;
    }

    try {
      await removeCollaborator(eventSlug, userId);
      setSuccess(`Removed ${email} from collaborators`);
      await loadCollaborators();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to remove collaborator:', err);
      setError('Failed to remove collaborator');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'accepted':
        return <Check className="w-4 h-4 text-green-600" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'declined':
        return <XCircle className="w-4 h-4 text-red-600" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'accepted':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'pending':
        return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      case 'declined':
        return 'bg-red-50 text-red-700 border-red-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Manage Collaborators</h2>
        <p className="text-gray-600 text-sm">
          Invite users to upload photos and videos to "{eventName}"
</p>
      </div>

      {/* Invite Form */}
      <div className="mb-6">
        <label htmlFor="invite-email" className="block text-sm font-medium text-gray-700 mb-2">
          Invite by Email
        </label>
        <div className="flex gap-2">
          <div className="flex-1 relative" ref={suggestionsRef}>
            <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 z-10" />
            <input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => handleEmailChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleInvite(e);
                } else if (e.key === 'Escape') {
                  setShowSuggestions(false);
                }
              }}
              onFocus={() => {
                if (suggestions.length > 0) {
                  setShowSuggestions(true);
                }
              }}
              placeholder="collaborator@example.com"
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={inviting}
              autoComplete="off"
            />
            
            {/* Autocomplete Suggestions */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {suggestions.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => selectSuggestion(user.email)}
                    className="w-full px-4 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-gray-400" />
                      <div>
                        <div className="text-sm font-medium text-gray-900">{user.email}</div>
                        {user.name && <div className="text-xs text-gray-500">{user.name}</div>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleInvite}
            disabled={inviting || !inviteEmail}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            {inviting ? 'Sending...' : 'Invite'}
          </button>
        </div>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}
      
      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          {success}
        </div>
      )}

      {/* Collaborators List */}
      {loading ? (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          <p className="mt-2 text-gray-600 text-sm">Loading collaborators...</p>
        </div>
      ) : collaborators.length === 0 ? (
        <div className="text-center py-8 bg-gray-50 rounded-lg">
          <UserPlus className="w-12 h-12 text-gray-400 mx-auto mb-2" />
          <p className="text-gray-600 text-sm">No collaborators yet</p>
          <p className="text-gray-500 text-xs mt-1">Invite users via email to get started</p>
        </div>
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Collaborators ({collaborators.length})
          </h3>
          {collaborators.map((collaborator) => (
            <div
              key={collaborator.id}
              className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 truncate">
                    {collaborator.name || collaborator.email}
                  </p>
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(collaborator.status)}`}>
                    {getStatusIcon(collaborator.status)}
                    {collaborator.status}
                  </span>
                </div>
                {collaborator.name && (
                  <p className="text-sm text-gray-500 truncate">{collaborator.email}</p>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  Invited {new Date(collaborator.invited_at).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => handleRemove(collaborator.user_id, collaborator.email)}
                className="ml-3 p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Remove collaborator"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CollaboratorManager;
