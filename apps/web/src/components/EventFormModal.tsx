import React, { useState, useEffect } from 'react';
import { X, MapPin, RefreshCw, Globe, Loader2 } from 'lucide-react';
import ModalOverlay from './ModalOverlay';
import TagManager from './TagManager';
import CollaboratorManager from './CollaboratorManager';
import CollaborationHistory from './CollaborationHistory';
import EventLocationPicker from './EventLocationPicker';
import { createEvent, updateEvent, deleteEvent, setEventTags, setEventLocation, regenerateThumbnails, geocodeEventPhotos } from '../api';
import type { Event, UpdateEventRequest } from '../types';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { haptics } from '../utils/haptics';

interface EventFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  event?: Event | null; // null = create mode, Event = edit mode
  onSuccess: () => void;
  onCreated?: (slug: string) => void;
}

const EventFormModal: React.FC<EventFormModalProps> = ({ isOpen, onClose, event, onSuccess, onCreated }) => {
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const isEdit = !!event;

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private' | 'collaborators_only'>('public');
  const [password, setPassword] = useState('');
  const [changePassword, setChangePassword] = useState(false);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  // Delete state
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Admin tools state
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);

  // Reset form when opening
  useEffect(() => {
    if (isOpen) {
      if (event) {
        setName(event.name);
        setDescription(event.description || '');
        setVisibility(event.visibility || 'public');
        setTagIds(event.tags?.map(t => t.id) || []);
        setPassword('');
        setChangePassword(false);
      } else {
        setName('');
        setDescription('');
        setVisibility('public');
        setPassword('');
        setChangePassword(false);
        setTagIds([]);
      }
      setShowDelete(false);
      setDeleteConfirmText('');
    }
  }, [isOpen, event]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.showError('Name is required');
      return;
    }

    setSaving(true);
    try {
      if (isEdit && event) {
        // Update event
        const updates: UpdateEventRequest = {};
        if (name !== event.name) updates.name = name;
        if (description !== (event.description || '')) updates.description = description;
        if (visibility !== (event.visibility || 'public')) updates.visibility = visibility;
        if (changePassword) updates.password = password;

        // Update tags separately
        const currentTagIds = event.tags?.map(t => t.id) || [];
        const tagsChanged = JSON.stringify(tagIds.sort()) !== JSON.stringify([...currentTagIds].sort());
        if (tagsChanged) await setEventTags(event.slug, tagIds);
        if (Object.keys(updates).length > 0) await updateEvent(event.slug, updates);

        await haptics.success();
        toast.showSuccess('Event updated');
      } else {
        // Create event
        const newEvent = await createEvent({
          name,
          password: password || undefined,
          visibility,
        });
        // Set tags if any were selected
        if (tagIds.length > 0) {
          await setEventTags(newEvent.slug, tagIds);
        }
        await haptics.success();
        toast.showSuccess('Event created');
        onCreated?.(newEvent.slug);
      }

      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to save event:', err);
      toast.showError(isEdit ? 'Failed to update event' : 'Failed to create event');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!event || deleteConfirmText !== event.slug) return;

    setDeleting(true);
    try {
      const result = await deleteEvent(event.slug);
      await haptics.success();
      toast.showSuccess(`Event deleted. Removed ${result.deletedPhotos} photos.`);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to delete event:', err);
      toast.showError('Failed to delete event');
    } finally {
      setDeleting(false);
    }
  };

  const handleSetLocation = async (lat: number, lng: number) => {
    if (!event) return;
    try {
      const result = await setEventLocation(event.slug, lat, lng);
      await haptics.success();
      toast.showSuccess(`Set GPS location for ${result.updated_count} photos`);
      setShowLocationPicker(false);
    } catch {
      toast.showError('Failed to set event location');
    }
  };

  const handleRegenerate = async () => {
    if (!event) return;
    setIsRegenerating(true);
    try {
      const result = await regenerateThumbnails(event.slug);
      await haptics.success();
      toast.showSuccess(`Regenerating thumbnails for ${result.count} photos`);
    } catch {
      toast.showError('Failed to regenerate thumbnails');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleGeocode = async () => {
    if (!event) return;
    const confirmed = await confirm('Geocode Photos', 'This will fetch city names for all photos with GPS coordinates. Continue?');
    if (!confirmed) return;
    setIsGeocoding(true);
    try {
      const result = await geocodeEventPhotos(event.slug);
      if (result.updated === 0) {
        toast.showInfo('All photos with GPS already have city names');
      } else {
        await haptics.success();
        toast.showSuccess(`Geocoded ${result.updated} of ${result.total} photos`);
      }
    } catch {
      toast.showError('Failed to geocode photos');
    } finally {
      setIsGeocoding(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {ConfirmDialog}
      <ModalOverlay onClose={onClose} label={isEdit ? 'Edit event' : 'Create new album'}>
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
        <div
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 fade-in duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 z-10 rounded-t-2xl">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {isEdit ? 'Event Settings' : 'New Album'}
            </h2>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition">
              <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Wedding 2024"
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={2}
              />
            </div>

            {/* Visibility */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Visibility</label>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'public' | 'private' | 'collaborators_only')}
                className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="public">Everyone (Public)</option>
                <option value="collaborators_only">Only Collaborators</option>
                <option value="private">Only Me (Private)</option>
              </select>
            </div>

            {/* Password */}
            {isEdit ? (
              <div>
                <label className="flex items-center gap-2 mb-2">
                  <input
                    type="checkbox"
                    checked={changePassword}
                    onChange={(e) => setChangePassword(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Change Password</span>
                </label>
                {changePassword && (
                  <div>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="New password (leave empty to remove)"
                      className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Leave empty to remove password protection</p>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password (optional)</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave empty for no password"
                  className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            )}

            {/* Tags */}
            <div>
              <TagManager
                eventSlug={isEdit && event ? event.slug : ''}
                initialTags={isEdit && event ? event.tags : []}
                onChange={setTagIds}
              />
            </div>

            {/* Collaborators (edit mode only) */}
            {isEdit && event && (
              <div>
                <CollaboratorManager
                  eventSlug={event.slug}
                  eventName={event.name}
                />
              </div>
            )}

            {/* Collaboration History (edit mode only) */}
            {isEdit && event && (
              <div>
                <CollaborationHistory eventSlug={event.slug} />
              </div>
            )}

            {/* Admin tools (edit mode only) */}
            {isEdit && event && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Tools</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowLocationPicker(true)}
                    className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm flex items-center gap-2"
                  >
                    <MapPin className="w-4 h-4" />
                    Set GPS
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    disabled={isRegenerating}
                    className="px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:bg-gray-400 text-sm flex items-center gap-2"
                  >
                    {isRegenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    {isRegenerating ? 'Regenerating...' : 'Regenerate Thumbnails'}
                  </button>
                  <button
                    type="button"
                    onClick={handleGeocode}
                    disabled={isGeocoding}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:bg-gray-400 text-sm flex items-center gap-2"
                  >
                    {isGeocoding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                    {isGeocoding ? 'Geocoding...' : 'Geocode Cities'}
                  </button>
                </div>
              </div>
            )}

            {/* Save button */}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:bg-gray-400 font-medium flex items-center justify-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {isEdit ? 'Save Changes' : 'Create Album'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition font-medium"
              >
                Cancel
              </button>
            </div>

            {/* Danger zone (edit mode only) */}
            {isEdit && event && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                {!showDelete ? (
                  <button
                    type="button"
                    onClick={() => setShowDelete(true)}
                    className="text-sm text-red-600 dark:text-red-400 hover:underline"
                  >
                    Delete this event...
                  </button>
                ) : (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <p className="text-sm text-red-700 dark:text-red-300 mb-2">
                      This will permanently delete <strong>{event.name}</strong> and all its photos.
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-400 mb-2">
                      Type <code className="bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 rounded">{event.slug}</code> to confirm:
                    </p>
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={event.slug}
                      className="w-full px-3 py-2 border border-red-300 dark:border-red-700 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-3"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleteConfirmText !== event.slug || deleting}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center gap-2"
                      >
                        {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                        Delete Permanently
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowDelete(false); setDeleteConfirmText(''); }}
                        className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </form>
        </div>
      </div>
      </ModalOverlay>

      {/* GPS Location Picker Modal */}
      {showLocationPicker && (
        <EventLocationPicker
          isOpen={showLocationPicker}
          onClose={() => setShowLocationPicker(false)}
          onSetLocation={handleSetLocation}
        />
      )}
    </>
  );
};

export default EventFormModal;
