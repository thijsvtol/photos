import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import TagManager from '../components/TagManager';
import { getEvents, createEvent, getAdminStats, updateEvent, deleteEvent, setEventTags } from '../api';
import type { Event, AdminStats, UpdateEventRequest } from '../types';

const AdminDashboard: React.FC = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [newEventPassword, setNewEventPassword] = useState('');
  const [newEventDescription, setNewEventDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Edit modal state
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTagIds, setEditTagIds] = useState<number[]>([]);
  const [changePassword, setChangePassword] = useState(false);
  
  // Delete modal state
  const [deletingEvent, setDeletingEvent] = useState<Event | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

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
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newEventName) {
      setError('Name is required');
      return;
    }

    try {
      await createEvent({
        name: newEventName,
        password: newEventPassword || undefined,
      });
      
      setSuccess('Event created successfully!');
      setNewEventName('');
      setNewEventPassword('');
      setNewEventDescription('');
      setShowCreateForm(false);
      await loadData();
      
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to create event');
      console.error(err);
    }
  };

  const openEditModal = (event: Event) => {
    setEditingEvent(event);
    setEditName(event.name);
    setEditTagIds(event.tags?.map(t => t.id) || []);
    setEditDescription(event.description || '');
    setEditPassword('');
    setChangePassword(false);
  };

  const handleUpdateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEvent) return;

    try {
      const updates: UpdateEventRequest = {};
      
      if (editName !== editingEvent.name) {
        updates.name = editName;
      }
      
      if (editDescription !== (editingEvent.description || '')) {
        updates.description = editDescription;
      }
      
      if (changePassword) {
        updates.password = editPassword; // Empty string to remove password
      }

      // Update tags separately
      const currentTagIds = editingEvent.tags?.map(t => t.id) || [];
      const tagsChanged = JSON.stringify(editTagIds.sort()) !== JSON.stringify(currentTagIds.sort());
      if (tagsChanged) {
        await setEventTags(editingEvent.slug, editTagIds);
      }
      
      await updateEvent(editingEvent.slug, updates);
      
      setSuccess('Event updated successfully!');
      setEditingEvent(null);
      await loadData();
      
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to update event');
      console.error(err);
    }
  };

  const openDeleteModal = (event: Event) => {
    setDeletingEvent(event);
    setDeleteConfirmText('');
  };

  const handleDeleteEvent = async () => {
    if (!deletingEvent || deleteConfirmText !== deletingEvent.slug) {
      return;
    }

    try {
      const result = await deleteEvent(deletingEvent.slug);
      setSuccess(`Event deleted successfully! Removed ${result.deletedPhotos} photos.`);
      setDeletingEvent(null);
      setDeleteConfirmText('');
      await loadData();
      
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to delete event');
      console.error(err);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <Link to="/events" className="text-blue-600 hover:text-blue-700 mb-3 sm:mb-4 inline-block text-sm sm:text-base">
            ← Back to Public View
          </Link>
          <div className="flex justify-between items-center">
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">Admin Dashboard</h1>
            <Link
              to="/admin/tags"
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition text-sm"
            >
              🏷️ Manage Tags
            </Link>
          </div>
        </div>

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
            {success}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-3xl mb-2">📅</div>
              <div className="text-2xl font-bold text-gray-900">{stats.totalEvents}</div>
              <div className="text-sm text-gray-600">Total Events</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-3xl mb-2">📷</div>
              <div className="text-2xl font-bold text-gray-900">{stats.totalPhotos}</div>
              <div className="text-sm text-gray-600">Total Photos</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-3xl mb-2">⭐</div>
              <div className="text-2xl font-bold text-gray-900">{stats.totalFavorites}</div>
              <div className="text-sm text-gray-600">Total Favorites</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-3xl mb-2">💾</div>
              <div className="text-2xl font-bold text-gray-900">{formatBytes(stats.storageBytes)}</div>
              <div className="text-sm text-gray-600">Storage (est.)</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-3xl mb-2">🌍</div>
              <div className="text-2xl font-bold text-gray-900">{stats.publicEvents}</div>
              <div className="text-sm text-gray-600">Public Events</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-3xl mb-2">🔒</div>
              <div className="text-2xl font-bold text-gray-900">{stats.privateEvents}</div>
              <div className="text-sm text-gray-600">Private Events</div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-4 sm:p-6 mb-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-4">
            <h2 className="text-xl sm:text-2xl font-semibold">Events</h2>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm sm:text-base"
            >
              {showCreateForm ? 'Cancel' : '+ Create Event'}
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreateEvent} className="border-t pt-4 mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Event Name *
                  </label>
                  <input
                    type="text"
                    value={newEventName}
                    onChange={(e) => setNewEventName(e.target.value)}
                    placeholder="e.g., Wedding 2024"
                    className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg text-sm sm:text-base"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Password (optional)
                  </label>
                  <input
                    type="password"
                    value={newEventPassword}
                    onChange={(e) => setNewEventPassword(e.target.value)}
                    placeholder="Leave empty for public event"
                    className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg text-sm sm:text-base"
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={newEventDescription}
                  onChange={(e) => setNewEventDescription(e.target.value)}
                  placeholder="Event description..."
                  className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg text-sm sm:text-base"
                  rows={3}
                />
              </div>
              <button
                type="submit"
                className="w-full sm:w-auto px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 active:bg-green-800 transition text-sm sm:text-base font-medium"
              >
                Create Event
              </button>
            </form>
          )}
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            <p className="mt-4 text-gray-600">Loading events...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {events.map((event) => (
              <div key={event.id} className="bg-white rounded-lg shadow-md p-4 sm:p-6">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-lg sm:text-xl font-semibold text-gray-900">{event.name}</h3>
                  {!event.requires_password && (
                    <span className="ml-2 px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full whitespace-nowrap">
                      Public
                    </span>
                  )}
                </div>
                <p className="text-gray-600 mb-2 text-sm">
                  Slug: <code className="bg-gray-100 px-2 py-1 rounded text-xs">{event.slug}</code>
                </p>
                <p className="text-gray-600 mb-2 text-sm">
                  Date: {event.inferred_date || 'Not set'}
                </p>
                {event.description && (
                  <p className="text-gray-600 mb-4 text-sm italic">{event.description}</p>
                )}
                <div className="flex flex-col gap-2">
                  <Link
                    to={`/admin/events/${event.slug}/upload`}
                    className="inline-block w-full text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
                  >
                    📷 Upload Photos
                  </Link>
                  <Link
                    to={`/events/${event.slug}`}
                    className="inline-block w-full text-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition text-sm"
                  >
                    👁️ View Gallery
                  </Link>
                  <button
                    onClick={() => openEditModal(event)}
                    className="w-full px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition text-sm"
                  >
                    ✏️ Edit Event
                  </button>
                  <button
                    onClick={() => openDeleteModal(event)}
                    className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm"
                  >
                    🗑️ Delete Event
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit Event Modal */}
        {editingEvent && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4">Edit Event: {editingEvent.name}</h2>
                <form onSubmit={handleUpdateEvent}>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Event Name
                      </label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                        required
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description
                      </label>
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                        rows={3}
                        placeholder="Event description..."
                      />
                    </div>
                    
                    <div>
                      <label className="flex items-center gap-2 mb-2">
                        <input
                          type="checkbox"
                          checked={changePassword}
                          onChange={(e) => setChangePassword(e.target.checked)}
                          className="rounded"
                        />
                        <span className="text-sm font-medium text-gray-700">
                          Change Password
                        </span>
                      </label>
                      
                      {changePassword && (
                        <div>
                          <input
                            type="password"
                            value={editPassword}
                            onChange={(e) => setEditPassword(e.target.value)}
                            placeholder="New password (leave empty to remove password)"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            Leave empty to remove password protection
                          </p>
                        </div>
                      )}
                    </div>
                    
                    {/* Event Tags */}
                    <div>
                      <TagManager 
                        eventSlug={editingEvent.slug} 
                        initialTags={editingEvent.tags}
                        onChange={setEditTagIds}
                      />
                    </div>
                  </div>
                  
                  <div className="flex gap-3 mt-6">
                    <button
                      type="submit"
                      className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                    >
                      Save Changes
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingEvent(null)}
                      className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Delete Event Modal */}
        {deletingEvent && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4 text-red-600">⚠️ Delete Event</h2>
                <p className="mb-4 text-gray-700">
                  You are about to delete <strong>{deletingEvent.name}</strong> and all its photos.
                  This action cannot be undone!
                </p>
                <p className="mb-4 text-sm text-gray-600">
                  Type <code className="bg-gray-100 px-2 py-1 rounded font-mono">{deletingEvent.slug}</code> to confirm:
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={`Type "${deletingEvent.slug}" to confirm`}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg mb-4"
                />
                <div className="flex gap-3">
                  <button
                    onClick={handleDeleteEvent}
                    disabled={deleteConfirmText !== deletingEvent.slug}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete Permanently
                  </button>
                  <button
                    onClick={() => {
                      setDeletingEvent(null);
                      setDeleteConfirmText('');
                    }}
                    className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
