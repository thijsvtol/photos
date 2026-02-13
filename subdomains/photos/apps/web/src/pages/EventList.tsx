import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Tag as TagIcon, MapPin, Calendar, ChevronRight, Loader2, Filter, X, ChevronDown, ChevronUp } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import SEO from '../components/SEO';
import { useRefresh } from '../contexts/RefreshContext';
import { getEvents, getTags, getPreviewUrl } from '../api';
import type { Event, Tag } from '../types';
import { config } from '../config';

const EventList: React.FC = () => {
  const { registerRefreshHandler, unregisterRefreshHandler } = useRefresh();
  const [events, setEvents] = useState<Event[]>([]);
  const [allEvents, setAllEvents] = useState<Event[]>([]); // Store all events for filtering
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTagFilters, setShowTagFilters] = useState(false);
  const [showCityFilters, setShowCityFilters] = useState(false);

  useEffect(() => {
    loadTags();
    loadEvents();
  }, []);

  // Register refresh handler
  useEffect(() => {
    registerRefreshHandler(handleRefresh);
    return () => unregisterRefreshHandler();
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

  const handleRefresh = async () => {
    await Promise.all([loadEvents(), loadTags()]);
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
    url: window.location.origin + '/events',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: events.slice(0, 10).map((event, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Event',
          name: event.name,
          url: `${window.location.origin}/events/${event.slug}`,
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
        title={`Photo Events - ${config.brandName} | Browse Event Photography`}
        description="Browse all photo events featuring ice skating, inline skating, and sports photography. Filter by tags and locations to find your favorite moments."
        keywords="photo events, ice skating events, inline skating events, sports photography events, event gallery"
        url={window.location.origin + '/events'}
        structuredData={structuredData}
      />
      <Navbar />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-8 flex-grow w-full">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">Photo Events</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2 text-sm sm:text-base">Browse all photo events and galleries</p>
          </div>
          {(selectedTag || selectedCity) && (
            <button
              onClick={() => {
                filterByTag(null);
                filterByCity(null);
              }}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition flex items-center gap-2 text-sm"
            >
              <X className="w-4 h-4" />
              Clear Filters
            </button>
          )}
        </div>

        {/* Tag filters */}
        {tags.length > 0 && (
          <div className="mb-4 sm:mb-6">
            <button
              onClick={() => setShowTagFilters(!showTagFilters)}
              className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 hover:text-gray-900 dark:hover:text-white transition"
            >
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4" />
                Filter by Tag
                {selectedTag && <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">1</span>}
              </div>
              {showTagFilters ? <ChevronUp className="w-4 h-4 sm:hidden" /> : <ChevronDown className="w-4 h-4 sm:hidden" />}
            </button>
            <div className={`flex flex-wrap gap-1.5 sm:gap-2 ${!showTagFilters ? 'hidden sm:flex' : ''}`}>
              <button
                onClick={() => filterByTag(null)}
                className={`px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-full text-xs sm:text-sm font-medium transition-all active:scale-95 ${
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
                  className={`px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-full text-xs sm:text-sm font-medium transition-all active:scale-95 ${
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
                <button
                  onClick={() => setShowCityFilters(!showCityFilters)}
                  className="w-full sm:w-auto flex items-center justify-between sm:justify-start gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 hover:text-gray-900 dark:hover:text-white transition"
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    Filter by City
                    {selectedCity && <span className="text-xs bg-green-700 text-white px-2 py-0.5 rounded-full">1</span>}
                  </div>
                  {showCityFilters ? <ChevronUp className="w-4 h-4 sm:hidden" /> : <ChevronDown className="w-4 h-4 sm:hidden" />}
                </button>
                <div className={`flex flex-wrap gap-1.5 sm:gap-2 ${!showCityFilters ? 'hidden sm:flex' : ''}`}>
                  <button
                    onClick={() => filterByCity(null)}
                    className={`px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-full text-xs sm:text-sm font-medium transition-all active:scale-95 ${
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
                      className={`px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-full text-xs sm:text-sm font-medium transition-all active:scale-95 ${
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
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-12 h-12 animate-spin text-blue-600 dark:text-blue-400 mb-4" />
            <p className="text-gray-600 dark:text-gray-400">Loading events...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-8 h-8 text-gray-400 dark:text-gray-500" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              {selectedTag || selectedCity ? 'No events match your filters' : 'No events found'}
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {selectedTag || selectedCity ? 'Try adjusting your filters' : 'No events have been created yet'}
            </p>
            {(selectedTag || selectedCity) && (
              <button
                onClick={() => {
                  filterByTag(null);
                  filterByCity(null);
                }}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition inline-flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                Clear Filters
              </button>
            )}
          </div>
        )}

        {!loading && !error && events.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {events.map((event) => (
              <Link
                key={event.id}
                to={`/events/${event.slug}`}
                className="flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-xl active:scale-[0.98] transition-all overflow-hidden h-full"
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
                
                <div className="p-4 sm:p-6 flex-1 flex flex-col">
                  <div className="flex items-start justify-between mb-2">
                    <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">{event.name}</h2>
                  </div>
                  <p className="text-gray-600 dark:text-gray-400 mb-3 text-sm sm:text-base">{formatDate(event.inferred_date)}</p>
                  
                  {/* Location */}
                  {event.cities && event.cities.length > 0 && (
                    <div className="flex items-center gap-1.5 mb-3 text-gray-600 dark:text-gray-400">
                      <MapPin className="w-4 h-4" />
                      <span className="text-sm">{event.cities.join(', ')}</span>
                    </div>
                  )}
                  
                  {/* Tags */}
                  {event.tags && event.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {event.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full flex items-center gap-1"
                        >
                          <TagIcon className="w-3 h-3" />
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                  
                  <div className="mt-auto text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-semibold text-sm sm:text-base inline-flex items-center gap-1">
                    View Gallery
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
};

export default EventList;
