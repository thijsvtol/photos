import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, AlertCircle, Loader2, UserPlus } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { acceptInvite } from '../api';
import { useAuth } from '../contexts/AuthContext';

const InviteAccept: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'already-member' | 'error' | 'auth-required'>('loading');
  const [error, setError] = useState<string>('');
  const [eventName, setEventName] = useState<string>('');

  // If opened in a mobile browser (not inside the native app), try to hand
  // off to the app first via its custom URL scheme. If the app isn't
  // installed this is a silent no-op and the web flow below continues as
  // the fallback.
  useEffect(() => {
    if (!token || Capacitor.isNativePlatform()) return;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) return;
    try {
      window.location.href = `photos://invite/${token}`;
    } catch (err) {
      // Defensive: some older WebViews/browsers can throw synchronously when
      // navigating to an unregistered custom scheme instead of silently
      // ignoring it. Swallow it either way and let the normal web flow
      // below proceed as the fallback.
      console.debug('[InviteAccept] App deep-link attempt failed, continuing on web:', err);
    }
  }, [token]);

  useEffect(() => {
    if (authLoading) {
      return; // Wait for auth to load
    }

    if (!user) {
      setStatus('auth-required');
      return;
    }

    if (!token) {
      setStatus('error');
      setError('Invalid invite link');
      return;
    }

    // Clear any stored redirect after successful auth
    sessionStorage.removeItem('inviteRedirect');
    
    handleAcceptInvite();
  }, [token, user, authLoading]);

  const handleAcceptInvite = async () => {
    if (!token) return;

    try {
      setStatus('loading');
      const result = await acceptInvite(token);
      setEventName(result.eventName);
      setStatus('success');
      
      // Redirect to event after 3 seconds
      setTimeout(() => {
        navigate(`/events/${result.eventSlug}`);
      }, 3000);
    } catch (err: any) {
      console.error('Failed to accept invite:', err);
      const eventSlug = err.response?.data?.eventSlug;

      // Already a collaborator on this event — this isn't really an error
      // from the user's point of view, so skip the "unable to accept" error
      // screen entirely and go straight to the event.
      if (eventSlug) {
        setStatus('already-member');
        navigate(`/events/${eventSlug}`, { replace: true });
        return;
      }

      setError(err.response?.data?.error || 'Failed to accept invitation');
      setStatus('error');
    }
  };

  const handleLogin = () => {
    // Store invite URL in sessionStorage as backup
    sessionStorage.setItem('inviteRedirect', window.location.pathname);
    // Redirect to login with current path as return destination
    const currentPath = window.location.pathname;
    window.location.href = `/api/auth/login?return_to=${encodeURIComponent(currentPath)}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {status === 'loading' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Processing Invitation
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Please wait while we add you as a collaborator...
            </p>
          </div>
        )}

        {status === 'auth-required' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <UserPlus className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Login Required
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              You need to be logged in to accept this collaboration invitation.
            </p>
            <button
              onClick={handleLogin}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition font-medium flex items-center justify-center gap-2"
            >
              <UserPlus className="w-5 h-5" />
              Login to Continue
            </button>
          </div>
        )}

        {status === 'success' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Welcome!
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              You are now a collaborator on <strong className="text-gray-900 dark:text-white">{eventName}</strong>.
              You can now upload photos and videos to this event.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Redirecting to event gallery...
            </p>
          </div>
        )}

        {status === 'already-member' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              You're already in!
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Taking you to the event gallery...
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Unable to Accept Invitation
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {error}
            </p>
            <button
              onClick={() => {
                // Store invite URL in sessionStorage as backup
                sessionStorage.setItem('inviteRedirect', window.location.pathname);
                const currentPath = window.location.pathname;
                window.location.href = `/api/auth/login?return_to=${encodeURIComponent(currentPath)}`;
              }}
              className="w-full px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 active:bg-gray-800 transition font-medium"
            >
              Login to Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default InviteAccept;
