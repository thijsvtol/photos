import React, { useState, useEffect } from 'react';
import { getTags, setEventTags } from '../api';
import type { Tag } from '../types';

interface TagManagerProps {
  eventSlug: string;
  initialTags?: Tag[];
}

const TagManager: React.FC<TagManagerProps> = ({ eventSlug, initialTags = [] }) => {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadTags();
    // Initialize selected tags
    if (initialTags.length > 0) {
      setSelectedTagIds(new Set(initialTags.map(t => t.id)));
    }
  }, [initialTags]);

  const loadTags = async () => {
    try {
      const tags = await getTags();
      setAllTags(tags);
    } catch (err) {
      console.error('Failed to load tags:', err);
    }
  };

  const toggleTag = (tagId: number) => {
    const newSelected = new Set(selectedTagIds);
    if (newSelected.has(tagId)) {
      newSelected.delete(tagId);
    } else {
      newSelected.add(tagId);
    }
    setSelectedTagIds(newSelected);
  };

  const saveTags = async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(false);
      await setEventTags(eventSlug, Array.from(selectedTagIds));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError('Failed to save tags');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
      <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-4">Event Tags</h3>
      
      {/* Tag selection */}
      <div className="flex flex-wrap gap-2 mb-4">
        {allTags.map((tag) => (
          <button
            key={tag.id}
            onClick={() => toggleTag(tag.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
              selectedTagIds.has(tag.id)
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {tag.name}
          </button>
        ))}
      </div>

      {/* Save button */}
      <button
        onClick={saveTags}
        disabled={loading}
        className="w-full sm:w-auto px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Saving...' : 'Save Tags'}
      </button>

      {/* Feedback messages */}
      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded">
          Tags saved successfully!
        </div>
      )}
    </div>
  );
};

export default TagManager;
