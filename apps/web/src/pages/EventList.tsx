import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Calendar, Filter, X, ChevronDown, ChevronUp, Search, Plus, MapPin } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { EventListSkeleton } from '../components/Skeletons';
import SEO from '../components/SEO';
import EventFormModal from '../components/EventFormModal';
import { useRefresh } from '../contexts/RefreshContext';
import { useAuth } from '../contexts/AuthContext';
import { getEvents, getTags, getPreviewUrl } from '../api';
import type { Event, Tag } from '../types';
import { config } from '../config';

const EventList: React.FC = () => {
  const navigate = useNavigate();
  const { registerRefreshHandler, unregisterRefreshHandler } = useRefresh();
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const [events, setEvents] = useState<Event[]>([]);
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTagFilters, setShowTagFilters] = useState(false);
  const [showCityFilters, setShowCityFilters] = useState(false);
  const [showAllCities, setShowAllCities] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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

  const applyFilters = (tagSlug: string | null, city: string | null, query: string = searchQuery) => {
    let filteredEvents = allEvents;
    
    // Apply text search
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      filteredEvents = filteredEvents.filter(event =>
        event.name.toLowerCase().includes(q) ||
        event.cities?.some(c => c.toLowerCase().includes(q)) ||
        event.tags?.some(tag => tag.name.toLowerCase().includes(q))
      );
    }
    
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

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    applyFilters(selectedTag, selectedCity, value);
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
          {(selectedTag || selectedCity || searchQuery) && (
            <button
              onClick={() => {
                setSearchQuery('');
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

        {/* Search input */}
        <div className="relative mb-4 sm:mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search events by name, city, or tag..."
            className="w-full pl-9 pr-8 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="w-4 h-4" />
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
          const cityCounts = new Map<string, number>();
          allEvents.forEach(event => {
            (event.cities || []).forEach(city => {
              cityCounts.set(city, (cityCounts.get(city) || 0) + 1);
            });
          });

          const cities = Array.from(cityCounts.entries())
            .sort((a, b) => {
              if (b[1] !== a[1]) return b[1] - a[1];
              return a[0].localeCompare(b[0]);
            })
            .map(([city]) => city);

          const visibleCities = showAllCities ? cities : cities.slice(0, 5);
          
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
                  {visibleCities.map((city) => (
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
                  {cities.length > 5 && (
                    <button
                      onClick={() => setShowAllCities(prev => !prev)}
                      className="px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-all active:scale-95 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800"
                    >
                      {showAllCities ? 'View less' : `+ ${cities.length - 5} more`}
                    </button>
                  )}
                </div>
              </div>
            );
          }
          return null;
        })()}

        {loading && (
          <EventListSkeleton />
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
              {selectedTag || selectedCity || searchQuery ? 'No events match your filters' : 'No events found'}
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {selectedTag || selectedCity || searchQuery ? 'Try adjusting your filters' : 'No events have been created yet'}
            </p>
            {(selectedTag || selectedCity || searchQuery) && (
              <button
                onClick={() => {
                  setSearchQuery('');
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {events.map((event) => (
              <Link
                key={event.id}
                to={`/events/${event.slug}`}
                className="group relative block rounded-xl overflow-hidden shadow-md hover:shadow-xl active:scale-[0.98] transition-all aspect-[3/2]"
              >
                {/* Full-bleed cover image */}
                <div className="absolute inset-0 bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-700 dark:to-gray-800">
                  {event.preview_photo_id ? (
                    <img
                      src={getPreviewUrl(event.slug, event.preview_photo_id)}
                      alt={event.name}
                      className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03] ${event.requires_password ? 'blur-md' : ''}`}
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-16 h-16 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Bottom gradient overlay for text */}
                <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />

                {/* Visibility badge */}
                {(event.requires_password || event.visibility !== 'public') && (
                  <div className="absolute top-2.5 right-2.5">
                    <span className={`px-2 py-0.5 text-[11px] font-medium rounded-full backdrop-blur-md ${
                      event.requires_password 
                        ? 'bg-amber-500/80 text-white' 
                        : event.visibility === 'private'
                        ? 'bg-red-500/80 text-white'
                        : 'bg-purple-500/80 text-white'
                    }`}>
                      {event.requires_password 
                        ? 'Password' 
                        : event.visibility === 'private'
                        ? 'Private'
                        : 'Invite Only'}
                    </span>
                  </div>
                )}

                {/* Overlaid title and date */}
                <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                  <h2 className="text-lg sm:text-xl font-bold text-white leading-tight mb-1 drop-shadow-lg">
                    {event.name}
                  </h2>
                  <p className="text-white/80 text-sm drop-shadow-md">
                    {formatDate(event.inferred_date)}
                    {event.cities && event.cities.length > 0 && (
                      <span> &middot; {event.cities.join(', ')}</span>
                    )}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <Footer />

      {/* FAB for creating events (admin only) */}
      {isAdmin && (
        <button
          onClick={() => setShowCreateModal(true)}
          className="fixed bottom-6 right-6 z-30 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center"
          aria-label="Create new album"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}

      {/* Create Event Modal */}
      <EventFormModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => { loadEvents(); loadTags(); }}
        onCreated={(slug) => navigate(`/events/${slug}`)}
      />
    </div>
  );
};

export default EventList;
