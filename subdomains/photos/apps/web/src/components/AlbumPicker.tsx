import { useEffect, useState } from 'react';
import { X, Upload, Folder, Lock, Users } from 'lucide-react';
import { Event } from '../types';
import { getEvents, getPreviewUrl } from '../api';

interface AlbumPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAlbum: (eventSlug: string) => void;
}

/**
 * AlbumPicker component displays a modal to select an album for uploading shared photos.
 * Only shows albums where the user has upload permissions (admin or collaborator).
 */
export default function AlbumPicker({ isOpen, onClose, onSelectAlbum }: AlbumPickerProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadEvents();
    }
  }, [isOpen]);

  const loadEvents = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // getEvents already filters by permissions on the backend
      // It returns only events where user is admin or collaborator
      const fetchedEvents = await getEvents();
      setEvents(fetchedEvents);
    } catch (err) {
      console.error('Failed to load albums:', err);
      setError('Failed to load albums. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAlbum = (eventSlug: string) => {
    onSelectAlbum(eventSlug);
    onClose();
  };

  const getVisibilityIcon = (visibility: string) => {
    switch (visibility) {
      case 'private':
        return <Lock className="w-3 h-3" />;
      case 'collaborators_only':
        return <Users className="w-3 h-3" />;
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-800 rounded-t-xl sm:rounded-xl max-w-2xl w-full max-h-[95vh] sm:max-h-[85vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-start gap-3 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Upload className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
              <span>Select Album</span>
            </h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              Choose an album to upload your photos
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition flex-shrink-0"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0" data-no-pull-refresh>
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center">
              <p className="text-red-800 dark:text-red-200">{error}</p>
              <button
                onClick={loadEvents}
                className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm"
              >
                Try Again
              </button>
            </div>
          )}

          {!loading && !error && events.length === 0 && (
            <div className="text-center py-12">
              <Folder className="w-12 h-12 text-gray-400 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-600 dark:text-gray-400 mb-2">No albums available</p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                You need to be an admin or collaborator to upload photos
              </p>
            </div>
          )}

          {!loading && !error && events.length > 0 && (
            <div className="grid gap-2 sm:gap-3">
              {events.map((event) => (
                <button
                  key={event.id}
                  onClick={() => handleSelectAlbum(event.slug)}
                  className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg transition group text-left"
                >
                  {/* Preview Image */}
                  <div className="w-12 h-12 sm:w-14 sm:h-14 flex-shrink-0 rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-600">
                    {event.preview_photo_id ? (
                      <img
                        src={getPreviewUrl(event.slug, event.preview_photo_id)}
                        alt={event.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Folder className="w-6 h-6 sm:w-8 sm:h-8 text-gray-400 dark:text-gray-500" />
                      </div>
                    )}
                  </div>

                  {/* Album Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                        {event.name}
                      </h3>
                      {getVisibilityIcon(event.visibility) && (
                        <span className="text-gray-500 dark:text-gray-400">
                          {getVisibilityIcon(event.visibility)}
                        </span>
                      )}
                    </div>
                    
                    {event.inferred_date && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {new Date(event.inferred_date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                    )}
                    
                    {event.cities && event.cities.length > 0 && (
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                        {event.cities.join(', ')}
                      </p>
                    )}
                  </div>

                  {/* Arrow indicator */}
                  <div className="flex-shrink-0 text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
