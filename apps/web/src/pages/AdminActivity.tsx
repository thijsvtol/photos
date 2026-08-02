import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Heart, CalendarPlus, Images, Trash2 } from 'lucide-react';
import Navbar from '../components/Navbar';
import { getActivityFeed } from '../api';
import type { ActivityEntry } from '../api';

// Polling interval for the activity feed — deliberately NOT realtime
// (Durable Objects would require Cloudflare's paid Workers plan); a 20s
// refresh is more than good enough for an admin-facing activity log.
const POLL_INTERVAL_MS = 20_000;

const ACTION_ICONS: Record<ActivityEntry['action'], React.ReactNode> = {
  photo_favorite: <Heart className="w-4 h-4 text-pink-500" />,
  event_create: <CalendarPlus className="w-4 h-4 text-blue-500" />,
  album_create: <Images className="w-4 h-4 text-emerald-500" />,
  photo_trash: <Trash2 className="w-4 h-4 text-red-500" />,
};

function describeActivity(entry: ActivityEntry): string {
  const actor = entry.actor_email;
  switch (entry.action) {
    case 'photo_favorite':
      return `${actor} favorited a photo${entry.event_name ? ` in ${entry.event_name}` : ''}`;
    case 'event_create': {
      let name = entry.event_name;
      try {
        if (entry.metadata) name = JSON.parse(entry.metadata).name || name;
      } catch { /* ignore */ }
      return `${actor} created event "${name}"`;
    }
    case 'album_create': {
      let name = 'an album';
      try {
        if (entry.metadata) name = JSON.parse(entry.metadata).name || name;
      } catch { /* ignore */ }
      return `${actor} created album "${name}"`;
    }
    case 'photo_trash':
      return `${actor} moved a photo to Trash${entry.event_name ? ` in ${entry.event_name}` : ''}`;
    default:
      return `${actor} performed ${entry.action}`;
  }
}

function formatTimeAgo(isoDate: string): string {
  const date = new Date(isoDate.replace(' ', 'T') + 'Z');
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const AdminActivity: React.FC = () => {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const data = await getActivityFeed(100);
      setActivity(data);
      setError(null);
    } catch (err) {
      setError('Failed to load activity feed');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadData]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link to="/admin" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
          ← Back to Admin
        </Link>
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3 mb-2">
          <Activity className="w-8 h-8" /> Activity
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Recent activity across all events, refreshing every {POLL_INTERVAL_MS / 1000}s.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          </div>
        ) : activity.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400">No activity yet.</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow divide-y divide-gray-100 dark:divide-gray-700">
            {activity.map((entry) => (
              <div key={entry.id} className="p-4 flex items-start gap-3">
                <div className="mt-0.5">{ACTION_ICONS[entry.action]}</div>
                <div className="flex-1">
                  <p className="text-sm text-gray-900 dark:text-gray-100">{describeActivity(entry)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatTimeAgo(entry.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminActivity;
