import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Masonry from 'react-masonry-css';
import Navbar from '../components/Navbar';
import { getEvents, getTags, getEventsByTag, getPreviewUrl } from '../api';
import type { Event, Tag } from '../types';

const EventList: React.FC = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTags();
    loadEvents();
  }, []);

  const loadTags = async () => {
    try {
      const data = await getTags();
      setTags(data);
    } catch (err) {
      console.error('Failed to load tags:', err);
    }
  };

  const loadEvents = async () => {
    try {
      setLoading(true);
      const data = await getEvents();
      // Filter out events starting with [prive] or [hidden]
      const visibleEvents = data.filter(event => 
        !event.name.toLowerCase().startsWith('[prive]') && 
        !event.name.toLowerCase().startsWith('[hidden]')
      );
      setEvents(visibleEvents);
      setError(null);
    } catch (err) {
      setError('Failed to load events');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filterByTag = async (tagSlug: string | null) => {
    try {
      setLoading(true);
      setSelectedTag(tagSlug);
      if (tagSlug) {
        const data = await getEventsByTag(tagSlug);
        // Filter out events starting with [prive] or [hidden]
        const visibleEvents = data.filter(event => 
          !event.name.toLowerCase().startsWith('[prive]') && 
          !event.name.toLowerCase().startsWith('[hidden]')
        );
        setEvents(visibleEvents);
      } else {
        await loadEvents();
      }
      setError(null);
    } catch (err) {
      setError('Failed to filter events');
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
      <Navbar />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">Photo Events</h1>
        </div>

        {/* Tag filters */}
        {tags.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => filterByTag(tag.slug)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                  selectedTag === tag.slug
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {tag.name}
              </button>
            ))}
          </div>
        )}

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
          <Masonry
            breakpointCols={{
              default: 3,
              1280: 3,
              1024: 2,
              640: 1
            }}
            className="flex -ml-4 sm:-ml-6 w-auto"
            columnClassName="pl-4 sm:pl-6 bg-clip-padding"
          >
            {events.map((event) => (
              <Link
                key={event.id}
                to={`/events/${event.slug}`}
                className="mb-4 sm:mb-6 block bg-white rounded-lg shadow-md hover:shadow-lg active:shadow-xl transition overflow-hidden"
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
                  <p className="text-gray-600 mb-3 text-sm sm:text-base">{formatDate(event.inferred_date)}</p>
                  
                  {/* Tags */}
                  {event.tags && event.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {event.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                  
                  <div className="text-blue-600 hover:text-blue-700 font-medium text-sm sm:text-base">
                    View Gallery →
                  </div>
                </div>
              </Link>
            ))}
          </Masonry>
        )}
      </div>
    </div>
  );
};

export default EventList;
