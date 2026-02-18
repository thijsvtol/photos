import React, { useState, useEffect } from 'react';
import { getTags } from '../api';
import type { Tag } from '../types';

interface TagManagerProps {
  eventSlug: string;
  initialTags?: Tag[];
  onChange?: (tagIds: number[]) => void; // Callback to notify parent of changes
}

const TagManager: React.FC<TagManagerProps> = ({ initialTags = [], onChange }) => {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());

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
    
    // Notify parent component of changes
    if (onChange) {
      onChange(Array.from(newSelected));
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Event Tags
      </label>
      
      {/* Tag selection */}
      <div className="flex flex-wrap gap-2">
        {allTags.map((tag) => (
          <button
            type="button"
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
      
      {allTags.length === 0 && (
        <p className="text-sm text-gray-500 mt-2">
          No tags available. Create tags in the Tag Manager first.
        </p>
      )}
    </div>
  );
};

export default TagManager;
