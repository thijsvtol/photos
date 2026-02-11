import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Upload, Eye, Edit2, Trash2, Calendar, Camera, Heart, HardDrive, Globe, Lock, Loader2, Tag, AlertCircle, CheckCircle, X } from 'lucide-react';
import Navbar from '../components/Navbar';
import TagManager from '../components/TagManager';
import CollaboratorManager from '../components/CollaboratorManager';
import CollaborationHistory from '../components/CollaborationHistory';
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
  const [newEventVisibility, setNewEventVisibility] = useState<'public' | 'private' | 'collaborators_only'>('public');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Edit modal state
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editVisibility, setEditVisibility] = useState<'public' | 'private' | 'collaborators_only'>('public');
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
        visibility: newEventVisibility,
      });
      
      setSuccess('Event created successfully!');
      setNewEventName('');
      setNewEventPassword('');
      setNewEventDescription('');
      setNewEventVisibility('public');
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
    setEditVisibility(event.visibility || 'public');
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
      
      if (editVisibility !== (editingEvent.visibility || 'public')) {
        updates.visibility = editVisibility;
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
            <Link
              to="/admin/tags"
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition text-sm flex items-center gap-2 shadow-sm hover:shadow"
            >
              <Tag className="w-4 h-4" />
              <span>Manage Tags</span>
            </Link>
          </div>
        </div>

        {success && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg mb-4 flex items-start gap-3 animate-in slide-in-from-top-2">
            <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="flex-1">{success}</span>
            <button onClick={() => setSuccess(null)} className="text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg mb-4 flex items-start gap-3 animate-in slide-in-from-top-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6 sm:mb-8">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition p-3 sm:p-4">
              <div className="flex items-center justify-center w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg mb-2">
                <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalEvents}</div>
              <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Total Events</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition p-3 sm:p-4">
              <div className="flex items-center justify-center w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg mb-2">
                <Camera className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalPhotos}</div>
              <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Total Photos</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition p-3 sm:p-4">
              <div className="flex items-center justify-center w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-lg mb-2">
                <Heart className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalFavorites}</div>
              <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Total Favorites</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition p-3 sm:p-4">
              <div className="flex items-center justify-center w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-lg mb-2">
                <HardDrive className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatBytes(stats.storageBytes)}</div>
              <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Storage (est.)</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition p-3 sm:p-4">
              <div className="flex items-center justify-center w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg mb-2">
                <Globe className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.publicEvents}</div>
              <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Public Events</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition p-3 sm:p-4">
              <div className="flex items-center justify-center w-10 h-10 bg-amber-100 dark:bg-amber-900/30 rounded-lg mb-2">
                <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.privateEvents}</div>
              <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Private Events</div>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition p-4 sm:p-6 mb-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-4">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">Events</h2>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm sm:text-base flex items-center justify-center gap-2 shadow-sm hover:shadow"
            >
              {showCreateForm ? (
                <>
                  <X className="w-4 h-4" />
                  Cancel
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Create Event
                </>
              )}
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreateEvent} className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
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
                  Who can view this event?
                </label>
                <select
                  value={newEventVisibility}
                  onChange={(e) => setNewEventVisibility(e.target.value as 'public' | 'private' | 'collaborators_only')}
                  className="w-full px-3 sm:px-4 py-2 border border-gray-300 rounded-lg text-sm sm:text-base"
                >
                  <option value="public">Everyone (Public)</option>
                  <option value="collaborators_only">Only Collaborators</option>
                  <option value="private">Only Me (Private)</option>
                </select>
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
                className="w-full sm:w-auto px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 active:bg-green-800 transition text-sm sm:text-base font-medium flex items-center justify-center gap-2 shadow-sm hover:shadow"
              >
                <Plus className="w-4 h-4" />
                Create Event
              </button>
            </form>
          )}
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
                  {event.requires_password ? (
                    <span className="ml-2 px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-full whitespace-nowrap flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      Password
                    </span>
                  ) : event.visibility === 'public' ? (
                    <span className="ml-2 px-2 py-1 text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded-full whitespace-nowrap flex items-center gap-1">
                      <Globe className="w-3 h-3" />
                      Public
                    </span>
                  ) : event.visibility === 'collaborators_only' ? (
                    <span className="ml-2 px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded-full whitespace-nowrap flex items-center gap-1">
                      <Globe className="w-3 h-3" />
                      Invite Only
                    </span>
                  ) : (
                    <span className="ml-2 px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 rounded-full whitespace-nowrap flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      Private
                    </span>
                  )}
                </div>
                <p className="text-gray-600 dark:text-gray-400 mb-2 text-sm">
                  Slug: <code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-xs">{event.slug}</code>
                </p>
                <p className="text-gray-600 dark:text-gray-400 mb-2 text-sm flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {event.inferred_date || 'Not set'}
                </p>
                {event.description && (
                  <p className="text-gray-600 mb-4 text-sm italic">{event.description}</p>
                )}
                <div className="flex flex-col gap-2">
                  <Link
                    to={`/admin/events/${event.slug}/upload`}
                    className="inline-flex items-center justify-center gap-2 w-full text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm shadow-sm hover:shadow"
                  >
                    <Upload className="w-4 h-4" />
                    Upload Photos
                  </Link>
                  <Link
                    to={`/events/${event.slug}`}
                    className="inline-flex items-center justify-center gap-2 w-full text-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition text-sm shadow-sm hover:shadow"
                  >
                    <Eye className="w-4 h-4" />
                    View Gallery
                  </Link>
                  <button
                    onClick={() => openEditModal(event)}
                    className="w-full px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition text-sm flex items-center justify-center gap-2 shadow-sm hover:shadow"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit Event
                  </button>
                  <button
                    onClick={() => openDeleteModal(event)}
                    className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm flex items-center justify-center gap-2 shadow-sm hover:shadow"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Event
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
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Who can view this event?
                      </label>
                      <select
                        value={editVisibility}
                        onChange={(e) => setEditVisibility(e.target.value as 'public' | 'private' | 'collaborators_only')}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="public">Everyone (Public)</option>
                        <option value="collaborators_only">Only Collaborators</option>
                        <option value="private">Only Me (Private)</option>
                      </select>
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
                    
                    {/* Event Collaborators */}
                    <div>
                      <CollaboratorManager 
                        eventSlug={editingEvent.slug}
                        eventName={editingEvent.name}
                      />
                    </div>
                    
                    {/* Collaboration History */}
                    <div>
                      <CollaborationHistory 
                        eventSlug={editingEvent.slug}
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
