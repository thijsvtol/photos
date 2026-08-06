import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Users, X, Check } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import JustifiedGrid from '../components/JustifiedGrid';
import { useGridDensity } from '../hooks/useGridDensity';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { searchPhotos, getPublicNamedPeople, getUserFavoriteIds, toggleFavorite as toggleFavoriteAPI } from '../api';
import type { SearchResultPhoto, PublicNamedPerson } from '../api';

const SearchPage: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const initialPeople = (searchParams.get('people') || '')
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResultPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // People filter — lets anyone find photos containing specific people (AND, not OR, when
  // multiple are picked: "show me photos of the two of them together" is what picking two
  // people almost always means). See searchPhotos()'s doc comment for the API shape, and
  // getPublicNamedPeople()'s doc comment for why this list is public (name-only, no face
  // data/linked accounts), unlike the admin "Tag people" picker's fuller getNamedPeople().
  const [namedPeople, setNamedPeople] = useState<PublicNamedPerson[]>([]);
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<number>>(new Set(initialPeople));
  const [showPeoplePicker, setShowPeoplePicker] = useState(false);
  const [peopleSearchQuery, setPeopleSearchQuery] = useState('');

  // Same justified-grid setup as EventGallery/Timeline (density-aware row height, hover
  // detection for touch vs. mouse controls, favorites) so results look and behave identically —
  // including real video playback via JustifiedGrid's ProgressiveVideo rendering, which the
  // previous plain <img>-only grid here never supported at all.
  const { targetRowHeight, containerRef: densityContainerRef } = useGridDensity();
  const [supportsHover, setSupportsHover] = useState(true);
  const [userFavorites, setUserFavorites] = useState<Set<string>>(new Set());

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    setSupportsHover(mq.matches);
    const handler = () => setSupportsHover(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    getUserFavoriteIds()
      .then((favIds) => setUserFavorites(new Set(favIds.map((f) => f.photoId))))
      .catch(() => { /* ignore — favorites just won't show as favorited */ });
  }, [isAuthenticated]);

  const toggleFavorite = async (photoId: string, isFavorited: boolean) => {
    try {
      await toggleFavoriteAPI(photoId, isFavorited);
      setUserFavorites((prev) => {
        const next = new Set(prev);
        if (isFavorited) next.delete(photoId);
        else next.add(photoId);
        return next;
      });
    } catch {
      toast.showError('Failed to update favorite');
    }
  };

  // JustifiedGrid renders one event's photos at a time (it needs a single `slug` to build
  // preview URLs), same grouping approach Timeline.tsx uses for its own cross-event photo list.
  const resultsByEvent = useMemo(() => {
    const groups = new Map<string, SearchResultPhoto[]>();
    for (const photo of results) {
      const arr = groups.get(photo.event_slug) || [];
      arr.push(photo);
      groups.set(photo.event_slug, arr);
    }
    return Array.from(groups.entries());
  }, [results]);


  useEffect(() => {
    getPublicNamedPeople().then(setNamedPeople).catch((err) => console.error('Failed to load people list', err));
  }, []);

  useEffect(() => {
    if (initialQuery || initialPeople.length > 0) {
      void runSearch(initialQuery, new Set(initialPeople));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const runSearch = async (q: string, personIds: Set<number>) => {
    if (!q.trim() && personIds.size === 0) return;
    setLoading(true);
    setSearched(true);
    try {
      const photos = await searchPhotos(q.trim(), 60, Array.from(personIds));
      setResults(photos);
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const updateUrlAndSearch = (q: string, personIds: Set<number>) => {
    const params: Record<string, string> = {};
    if (q.trim()) params.q = q.trim();
    if (personIds.size > 0) params.people = Array.from(personIds).join(',');
    setSearchParams(params);
    void runSearch(q, personIds);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateUrlAndSearch(query, selectedPersonIds);
  };

  const handleTogglePerson = (personId: number) => {
    setSelectedPersonIds((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) {
        next.delete(personId);
      } else {
        next.add(personId);
      }
      updateUrlAndSearch(query, next);
      return next;
    });
  };

  const selectedPeople = namedPeople.filter((p) => selectedPersonIds.has(p.id));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <Navbar />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-8 flex-grow w-full">
        <form onSubmit={handleSubmit} className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search photos by filename, location, or description…"
              className="w-full pl-10 pr-4 py-3 border rounded-lg dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              autoFocus
            />
          </div>
          <button type="submit" className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
            Search
          </button>
        </form>

        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-2">
                {selectedPeople.map((p) => (
                  <span
                    key={p.id}
                    className="flex items-center gap-1 pl-3 pr-1.5 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 text-sm rounded-full"
                  >
                    {p.name}
                    <button
                      onClick={() => handleTogglePerson(p.id)}
                      className="p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition"
                      aria-label={`Remove ${p.name} filter`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
                <button
                  onClick={() => setShowPeoplePicker((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition"
                >
                  <Users className="w-4 h-4" /> {selectedPeople.length > 0 ? 'Edit people filter' : 'Filter by people'}
                </button>
          </div>

          {showPeoplePicker && (
                <div className="mt-2 max-w-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                    Selecting multiple people only shows photos where they're all together.
                  </p>
                  <input
                    type="text"
                    value={peopleSearchQuery}
                    onChange={(e) => setPeopleSearchQuery(e.target.value)}
                    placeholder="Search people…"
                    className="w-full mb-2 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                  <div className="max-h-56 overflow-y-auto space-y-1">
                    {namedPeople.length === 0 ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400 py-2 text-center">No named people yet.</p>
                    ) : (
                      namedPeople
                        .filter((p) => p.name.toLowerCase().includes(peopleSearchQuery.trim().toLowerCase()))
                        .map((p) => {
                          const selected = selectedPersonIds.has(p.id);
                          return (
                            <button
                              key={p.id}
                              onClick={() => handleTogglePerson(p.id)}
                              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition ${
                                selected
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-50 dark:bg-gray-700/60 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                              }`}
                            >
                              <span>{p.name}</span>
                              {selected && <Check className="w-4 h-4 shrink-0" />}
                            </button>
                          );
                        })
                    )}
                  </div>
                </div>
          )}
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          </div>
        ) : searched && results.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">
              {query.trim() ? (
                <>
                  No photos found for "{query}"
                  {selectedPeople.length > 0 && <> with {selectedPeople.map((p) => p.name).join(' and ')}</>}. Search
                  covers filenames, locations, and AI-generated descriptions (descriptions are added
                  gradually in the background, so very recently uploaded photos may not be searchable
                  by content yet).
                </>
              ) : selectedPeople.length > 0 ? (
                <>
                  No photos found with {selectedPeople.map((p) => p.name).join(' and ')}
                  {selectedPeople.length > 1 ? ' together' : ''}. This only searches photos in
                  events you have access to.
                </>
              ) : (
                'No photos found.'
              )}
            </p>
          </div>
        ) : results.length > 0 ? (
          <div ref={densityContainerRef}>
            {resultsByEvent.map(([eventSlug, eventPhotos]) => (
              <div key={eventSlug} className="mb-6">
                {resultsByEvent.length > 1 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-2 px-1">
                    {eventPhotos[0]?.event_name || eventSlug}
                  </p>
                )}
                <JustifiedGrid
                  photos={eventPhotos}
                  slug={eventSlug}
                  targetRowHeight={targetRowHeight}
                  spacing={4}
                  selectedPhotos={new Set()}
                  forceControlsVisible={false}
                  userFavorites={userFavorites}
                  supportsHover={supportsHover}
                  linkState={{ fromSearch: true }}
                  onToggleFavorite={isAuthenticated ? toggleFavorite : undefined}
                />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <Footer />
    </div>
  );
};

export default SearchPage;
