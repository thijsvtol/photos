import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { updateUserProfile } from '../api';

/**
 * Blocks the app behind a full-screen, non-dismissable modal until a logged-in user has set a
 * full name — Cloudflare Access/Google OAuth doesn't always provide one (e.g. some SSO
 * providers/email-only logins never send a `name` claim), and a nameless account shows up
 * badly everywhere a display name is expected: the People admin's "Linked account" section,
 * collaborator avatars (UserAvatar.tsx falls back to a generic "Collaborator" rather than ever
 * showing the raw email), the "Uploaded by" field, etc.
 *
 * Deliberately excluded on /logout — forcing a name entry while a user is actively trying to
 * log out would trap them in a dead end.
 */
const RequireProfileName: React.FC = () => {
  const { user, isAuthenticated, updateUser } = useAuth();
  const location = useLocation();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isAuthenticated || !user || user.name?.trim() || location.pathname === '/logout') {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !trimmed.includes(' ')) {
      setError('Please enter your full name (first and last).');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updatedUser = await updateUserProfile({ name: trimmed });
      updateUser(updatedUser);
    } catch (err) {
      console.error('Failed to save name:', err);
      setError('Failed to save your name. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">One more step</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Please enter your full name so people can recognize you as a collaborator and see who
          uploaded a photo.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name (e.g. Jane Doe)"
            autoFocus
            disabled={saving}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default RequireProfileName;
