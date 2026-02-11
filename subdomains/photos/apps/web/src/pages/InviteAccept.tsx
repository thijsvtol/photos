import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, AlertCircle, Loader2, UserPlus } from 'lucide-react';
import { acceptInvite } from '../api';
import { useAuth } from '../contexts/AuthContext';

const InviteAccept: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'auth-required'>('loading');
  const [error, setError] = useState<string>('');
  const [eventName, setEventName] = useState<string>('');

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
      setError(err.response?.data?.error || 'Failed to accept invitation');
      setStatus('error');
      
      // If already a collaborator, redirect to event
      if (err.response?.data?.eventSlug) {
        setTimeout(() => {
          navigate(`/events/${err.response.data.eventSlug}`);
        }, 3000);
      }
    }
  };

  const handleLogin = () => {
    // Store the current URL to redirect back after login
    sessionStorage.setItem('redirectAfterLogin', window.location.pathname);
    // In a Cloudflare Access setup, redirecting to any protected resource will trigger login
    window.location.href = '/';
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
              onClick={() => navigate('/events')}
              className="w-full px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 active:bg-gray-800 transition font-medium"
            >
              Go to Events
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default InviteAccept;
