import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { searchPhotos, getPreviewUrl } from '../api';
import type { SearchResultPhoto } from '../api';

const SearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResultPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (initialQuery) {
      void runSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const runSearch = async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const photos = await searchPhotos(q.trim());
      setResults(photos);
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams(query.trim() ? { q: query.trim() } : {});
    void runSearch(query);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <Navbar />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-8 flex-grow w-full">
        <form onSubmit={handleSubmit} className="mb-8 flex gap-2">
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

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          </div>
        ) : searched && results.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">
              No photos found for "{query}". Search covers filenames, locations, and
              AI-generated descriptions (descriptions are added gradually in the background,
              so very recently uploaded photos may not be searchable by content yet).
            </p>
          </div>
        ) : results.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {results.map((photo) => (
              <Link
                key={photo.id}
                to={`/p/${photo.event_slug}/${photo.id}`}
                className="rounded-lg overflow-hidden shadow hover:shadow-lg transition-shadow bg-white dark:bg-gray-800"
              >
                <div className="aspect-square">
                  <img
                    src={getPreviewUrl(photo.event_slug, photo.id, photo.file_type, photo.cache_version)}
                    alt={photo.original_filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="p-2">
                  <p className="text-xs text-gray-600 dark:text-gray-400 truncate">{photo.event_name}</p>
                  {photo.ai_caption && (
                    <p className="text-xs text-gray-400 truncate italic">{photo.ai_caption}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
      <Footer />
    </div>
  );
};

export default SearchPage;
