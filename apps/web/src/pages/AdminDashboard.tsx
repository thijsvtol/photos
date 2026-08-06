import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Eye, Settings, Camera, Calendar, Heart, HardDrive, Globe, Lock, Loader2,
  Tag, AlertCircle, X, Activity, Users, Trash2, Copy,
} from 'lucide-react';
import Navbar from '../components/Navbar';
import EventFormModal from '../components/EventFormModal';
import { getEvents, getAdminStats } from '../api';
import type { Event, AdminStats } from '../types';

// Admin tool pages linked from the header. Kept as data so the row stays
// readable and wraps cleanly on narrow screens instead of overflowing.
const TOOL_LINKS = [
  { to: '/admin/activity', label: 'Activity', icon: Activity, color: 'bg-indigo-600 hover:bg-indigo-700' },
  { to: '/admin/people', label: 'People', icon: Users, color: 'bg-pink-600 hover:bg-pink-700' },
  { to: '/admin/duplicates', label: 'Duplicates', icon: Copy, color: 'bg-teal-600 hover:bg-teal-700' },
  { to: '/admin/trash', label: 'Trash', icon: Trash2, color: 'bg-gray-600 hover:bg-gray-700' },
  { to: '/admin/tags', label: 'Manage Tags', icon: Tag, color: 'bg-purple-600 hover:bg-purple-700' },
];

/**
 * Admin index: site-wide stats, the event list, and links to the admin tool
 * pages.
 *
 * Event creation and editing both go through EventFormModal — the same modal
 * the gallery's Settings button opens. This page used to carry its own inline
 * create form plus separate edit and delete modals, which had drifted into a
 * strictly worse duplicate (no location picker, folder sync, thumbnail
 * regeneration, geocoding or collaboration history, and no dark-mode styles).
 */
const AdminDashboard: React.FC = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // undefined = modal closed, null = create mode, Event = edit mode.
  // Matches EventFormModal's own `event` prop convention.
  const [formEvent, setFormEvent] = useState<Event | null | undefined>(undefined);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [eventsData, statsData] = await Promise.all([
        getEvents(),
        getAdminStats(),
      ]);
      setEvents(eventsData);
      setStats(statsData);
      setError(null);
    } catch (err) {
      setError('Failed to load data');
      console.error('[AdminDashboard] Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number | undefined): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const visibilityBadge = (event: Event) => {
    if (event.requires_password) {
      return (
        <span className="ml-2 px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-full whitespace-nowrap flex items-center gap-1">
          <Lock className="w-3 h-3" />
          Password
        </span>
      );
    }
    if (event.visibility === 'public') {
      return (
        <span className="ml-2 px-2 py-1 text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded-full whitespace-nowrap flex items-center gap-1">
          <Globe className="w-3 h-3" />
          Public
        </span>
      );
    }
    if (event.visibility === 'collaborators_only') {
      return (
        <span className="ml-2 px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded-full whitespace-nowrap flex items-center gap-1">
          <Globe className="w-3 h-3" />
          Invite Only
        </span>
      );
    }
    return (
      <span className="ml-2 px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 rounded-full whitespace-nowrap flex items-center gap-1">
        <Lock className="w-3 h-3" />
        Private
      </span>
    );
  };

  const statCards = stats
    ? [
        { icon: Calendar, tint: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400', value: stats.totalEvents || 0, label: 'Total Events' },
        { icon: Camera, tint: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400', value: stats.totalPhotos || 0, label: 'Total Photos' },
        { icon: Heart, tint: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400', value: stats.totalFavorites || 0, label: 'Total Favorites' },
        { icon: HardDrive, tint: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400', value: formatBytes(stats.storageBytes), label: 'Storage (est.)' },
        { icon: Globe, tint: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400', value: stats.publicEvents || 0, label: 'Public Events' },
        { icon: Lock, tint: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400', value: stats.privateEvents || 0, label: 'Private Events' },
      ]
    : [];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <Link to="/events" className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 mb-3 sm:mb-4 inline-flex items-center gap-1 text-sm sm:text-base transition">
            ← Back to Public View
          </Link>
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mt-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
              <p className="text-gray-600 dark:text-gray-400 mt-2 text-sm sm:text-base">Manage events and view statistics</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {TOOL_LINKS.map(({ to, label, icon: Icon, color }) => (
                <Link
                  key={to}
                  to={to}
                  className={`px-4 py-2 ${color} text-white rounded-lg transition text-sm flex items-center gap-2 shadow-sm hover:shadow`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg mb-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6 sm:mb-8">
            {statCards.map(({ icon: Icon, tint, value, label }) => (
              <div key={label} className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition p-3 sm:p-4">
                <div className={`flex items-center justify-center w-10 h-10 rounded-lg mb-2 ${tint}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
                <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">{label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between items-center gap-4 mb-4">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">Events</h2>
          <button
            onClick={() => setFormEvent(null)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm sm:text-base flex items-center justify-center gap-2 shadow-sm hover:shadow"
          >
            <Plus className="w-4 h-4" />
            Create Event
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-12 h-12 animate-spin text-blue-600 dark:text-blue-400 mb-4" />
            <p className="text-gray-600 dark:text-gray-400">Loading events...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {events.map((event) => (
              <div key={event.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition p-4 sm:p-6">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">{event.name}</h3>
                  {visibilityBadge(event)}
                </div>
                <p className="text-gray-600 dark:text-gray-400 mb-2 text-sm">
                  Slug: <code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-xs">{event.slug}</code>
                </p>
                <p className="text-gray-600 dark:text-gray-400 mb-2 text-sm flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {event.inferred_date || 'Not set'}
                </p>
                {event.description && (
                  <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm italic">{event.description}</p>
                )}
                <div className="flex gap-2 mt-4">
                  <Link
                    to={`/events/${event.slug}`}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm shadow-sm hover:shadow"
                  >
                    <Eye className="w-4 h-4" />
                    View Gallery
                  </Link>
                  <Link
                    to={`/admin/events/${event.slug}/photos`}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm shadow-sm hover:shadow"
                  >
                    <Camera className="w-4 h-4" />
                    Photos
                  </Link>
                  <button
                    onClick={() => setFormEvent(event)}
                    title="Event settings"
                    aria-label={`Settings for ${event.name}`}
                    className="px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition text-sm flex items-center justify-center shadow-sm hover:shadow"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {formEvent !== undefined && (
          <EventFormModal
            isOpen
            onClose={() => setFormEvent(undefined)}
            event={formEvent}
            onSuccess={() => {
              setFormEvent(undefined);
              loadData();
            }}
          />
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
