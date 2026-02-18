import React, { useState, useEffect } from 'react';
import { Clock, UserPlus, UserMinus, Upload, AlertCircle } from 'lucide-react';
import { getCollaborationHistory } from '../api';

interface CollaborationHistoryProps {
  eventSlug: string;
}

interface HistoryEntry {
  id: number;
  event_id: number;
  user_id: string;
  user_name: string | null;
  user_email: string;
  action_type: 'invite' | 'accept' | 'decline' | 'remove' | 'upload';
  target_user_id: string | null;
  target_user_name: string | null;
  target_user_email: string | null;
  metadata: any;
  created_at: string;
}

const CollaborationHistory: React.FC<CollaborationHistoryProps> = ({ eventSlug }) => {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, [eventSlug]);

  const loadHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getCollaborationHistory(eventSlug);
      setHistory(data);
    } catch (err: any) {
      console.error('Failed to load collaboration history:', err);
      setError(err.response?.data?.error || 'Failed to load history');
    } finally {
      setLoading(false);
    }
  };

  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case 'invite':
        return <UserPlus className="w-4 h-4" />;
      case 'remove':
        return <UserMinus className="w-4 h-4" />;
      case 'upload':
        return <Upload className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getActionColor = (actionType: string) => {
    switch (actionType) {
      case 'invite':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'remove':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'upload':
        return 'bg-green-500/10 text-green-400 border-green-500/20';
      default:
        return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    }
  };

  const formatActionDescription = (entry: HistoryEntry) => {
    const userName = entry.user_name || entry.user_email;
    const targetName = entry.target_user_name || entry.target_user_email || 'Unknown';

    switch (entry.action_type) {
      case 'invite':
        return (
          <>
            <strong>{userName}</strong> invited <strong>{targetName}</strong> to collaborate
          </>
        );
      case 'remove':
        return (
          <>
            <strong>{userName}</strong> removed <strong>{targetName}</strong> from collaborators
          </>
        );
      case 'upload':
        return (
          <>
            <strong>{userName}</strong> uploaded a photo
          </>
        );
      default:
        return (
          <>
            <strong>{userName}</strong> performed {entry.action_type}
          </>
        );
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Collaboration History
        </h3>
        <div className="text-gray-400 text-center py-8">Loading history...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Collaboration History
        </h3>
        <div className="text-red-400 flex items-center gap-2 justify-center py-8">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <Clock className="w-5 h-5" />
        Collaboration History
      </h3>

      {history.length === 0 ? (
        <div className="text-gray-400 text-center py-8">
          No collaboration activity yet
        </div>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {history.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-3 p-3 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors"
            >
              <div className={`flex items-center justify-center w-8 h-8 rounded-full border ${getActionColor(entry.action_type)}`}>
                {getActionIcon(entry.action_type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200">
                  {formatActionDescription(entry)}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {formatTimestamp(entry.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CollaborationHistory;
