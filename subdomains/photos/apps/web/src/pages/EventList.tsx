import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getEvents, getPreviewUrl } from '../api';
import type { Event } from '../types';

const EventList: React.FC = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    try {
      setLoading(true);
      const data = await getEvents();
      setEvents(data);
      setError(null);
    } catch (err) {
      setError('Failed to load events');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'No date';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">Photo Events</h1>
          <Link
            to="/admin"
            className="w-full sm:w-auto text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm sm:text-base"
          >
            Admin
          </Link>
        </div>

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            <p className="mt-4 text-gray-600">Loading events...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-600">No events found.</p>
          </div>
        )}

        {!loading && !error && events.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {events.map((event) => (
              <Link
                key={event.id}
                to={`/events/${event.slug}`}
                className="bg-white rounded-lg shadow-md hover:shadow-lg active:shadow-xl transition overflow-hidden"
              >
                {/* Preview Image for Public Events */}
                {!event.requires_password && event.preview_photo_id && (
                  <div className="relative w-full h-48 sm:h-56 bg-gray-200">
                    <img
                      src={getPreviewUrl(event.slug, event.preview_photo_id)}
                      alt={event.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute top-2 right-2">
                      <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full backdrop-blur-sm bg-opacity-90">
                        Public
                      </span>
                    </div>
                  </div>
                )}
                
                <div className="p-4 sm:p-6">
                  <div className="flex items-start justify-between mb-2">
                    <h2 className="text-xl sm:text-2xl font-semibold text-gray-900">{event.name}</h2>
                    {!event.requires_password && !event.preview_photo_id && (
                      <span className="ml-2 px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full whitespace-nowrap">
                        Public
                      </span>
                    )}
                  </div>
                  <p className="text-gray-600 mb-3 sm:mb-4 text-sm sm:text-base">{formatDate(event.inferred_date)}</p>
                  <div className="text-blue-600 hover:text-blue-700 font-medium text-sm sm:text-base">
                    View Gallery →
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default EventList;
