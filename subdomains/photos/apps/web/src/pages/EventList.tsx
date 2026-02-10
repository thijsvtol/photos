import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Masonry from 'react-masonry-css';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import SEO from '../components/SEO';
import { getEvents, getTags, getPreviewUrl } from '../api';
import type { Event, Tag } from '../types';

const EventList: React.FC = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [allEvents, setAllEvents] = useState<Event[]>([]); // Store all events for filtering
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
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
      setAllEvents(visibleEvents);
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
      applyFilters(tagSlug, selectedCity);
      setError(null);
    } catch (err) {
      setError('Failed to filter events');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filterByCity = (city: string | null) => {
    setSelectedCity(city);
    applyFilters(selectedTag, city);
  };

  const applyFilters = (tagSlug: string | null, city: string | null) => {
    let filteredEvents = allEvents;
    
    // Apply tag filter
    if (tagSlug) {
      filteredEvents = filteredEvents.filter(event => 
        event.tags?.some(tag => tag.slug === tagSlug)
      );
    }
    
    // Apply city filter
    if (city) {
      filteredEvents = filteredEvents.filter(event => 
        event.cities?.includes(city)
      );
    }
    
    setEvents(filteredEvents);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'No date';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Photo Events',
    description: 'Browse all photo events including ice skating, inline skating, and sports photography',
    url: 'https://photos.thijsvtol.nl/events',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: events.slice(0, 10).map((event, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Event',
          name: event.name,
          url: `https://photos.thijsvtol.nl/events/${event.slug}`,
          startDate: event.inferred_date || event.created_at,
          location: event.cities && event.cities.length > 0 ? {
            '@type': 'Place',
            address: {
              '@type': 'PostalAddress',
              addressLocality: event.cities[0]
            }
          } : undefined
        }
      }))
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <SEO
        title="Photo Events - Thijs van Tol | Browse Event Photography"
        description="Browse all photo events featuring ice skating, inline skating, and sports photography. Filter by tags and locations to find your favorite moments."
        keywords="photo events, ice skating events, inline skating events, sports photography events, event gallery"
        url="https://photos.thijsvtol.nl/events"
        structuredData={structuredData}
      />
      <Navbar />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8 flex-grow w-full">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">Photo Events</h1>
        </div>

        {/* Tag filters */}
        {tags.length > 0 && (
          <div className="mb-4 sm:mb-6">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Filter by Tag</h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => filterByTag(null)}
                className={`px-4 py-2.5 rounded-full text-sm font-medium transition-all active:scale-95 ${
                  !selectedTag
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                All Tags
              </button>
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => filterByTag(tag.slug)}
                  className={`px-4 py-2.5 rounded-full text-sm font-medium transition-all active:scale-95 ${
                    selectedTag === tag.slug
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* City filters */}
        {(() => {
          // Extract unique cities from all events
          const cities = Array.from(
            new Set(
              allEvents.flatMap(event => event.cities || [])
            )
          ).sort();
          
          if (cities.length > 0) {
            return (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Filter by City</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => filterByCity(null)}
                    className={`px-4 py-2.5 rounded-full text-sm font-medium transition-all active:scale-95 ${
                      !selectedCity
                        ? 'bg-green-700 text-white shadow-md'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300 active:bg-gray-400 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:active:bg-gray-500'
                    }`}
                  >
                    All Cities
                  </button>
                  {cities.map((city) => (
                    <button
                      key={city}
                      onClick={() => filterByCity(city)}
                      className={`px-4 py-2.5 rounded-full text-sm font-medium transition-all active:scale-95 ${
                        selectedCity === city
                          ? 'bg-green-700 text-white shadow-md'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300 active:bg-gray-400 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:active:bg-gray-500'
                      }`}
                    >
                      {city}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          return null;
        })()}

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            <p className="mt-4 text-gray-600">Loading events...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded">
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
                className="mb-4 sm:mb-6 block bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-xl active:scale-[0.98] transition-all overflow-hidden"
              >
                {/* Preview Image or Placeholder */}
                <div className="relative w-full h-48 sm:h-56 bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800">
                  {event.preview_photo_id ? (
                    <img
                      src={getPreviewUrl(event.slug, event.preview_photo_id)}
                      alt={event.name}
                      className={`w-full h-full object-cover ${event.requires_password ? 'blur-md' : ''}`}
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  <div className="absolute top-2 right-2">
                    <span className={`px-2 py-1 text-xs rounded-full backdrop-blur-sm bg-opacity-90 ${
                      event.requires_password 
                        ? 'bg-amber-100 text-amber-800' 
                        : event.visibility === 'private'
                        ? 'bg-red-100 text-red-800'
                        : event.visibility === 'collaborators_only'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {event.requires_password 
                        ? 'Password Protected' 
                        : event.visibility === 'private'
                        ? 'Private'
                        : event.visibility === 'collaborators_only'
                        ? 'Invite Only'
                        : 'Public'}
                    </span>
                  </div>
                </div>
                
                <div className="p-4 sm:p-6">
                  <div className="flex items-start justify-between mb-2">
                    <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">{event.name}</h2>
                  </div>
                  <p className="text-gray-600 dark:text-gray-400 mb-3 text-sm sm:text-base">{formatDate(event.inferred_date)}</p>
                  
                  {/* Location */}
                  {event.cities && event.cities.length > 0 && (
                    <div className="flex items-center gap-1.5 mb-3 text-gray-600 dark:text-gray-400">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-sm">{event.cities.join(', ')}</span>
                    </div>
                  )}
                  
                  {/* Tags */}
                  {event.tags && event.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {event.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                  
                  <div className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-semibold text-sm sm:text-base inline-flex items-center gap-1">
                    View Gallery 
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            ))}
          </Masonry>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default EventList;
