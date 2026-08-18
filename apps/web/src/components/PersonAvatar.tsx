import React from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import MediaThumb from './MediaThumb';

/** The subset of a person/cluster needed to render its avatar tile. Both `Person` and
 *  `UnnamedPerson` (see api.ts) satisfy this. */
export interface PersonAvatarData {
  id: number;
  name?: string | null;
  photo_count: number;
  cover_photo_id?: string | null;
  cover_file_type?: string | null;
  cover_cache_version?: number | null;
  cover_event_slug?: string | null;
}

/**
 * The round cover-photo + name + photo-count tile used to represent a person, shared by the
 * People admin grid and the Unattached page's "Unnamed people" section so the two lists stay
 * visually identical. Renders as a Link to the person detail page by default; pass `to={null}`
 * to render a plain (non-navigating) tile when the caller wants its own click handling.
 */
const PersonAvatar: React.FC<{ person: PersonAvatarData; to?: string | null }> = ({ person, to }) => {
  const target = to === undefined ? `/admin/people/${person.id}` : to;

  const inner = (
    <>
      <div className="aspect-square rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 mx-auto w-24 h-24 sm:w-28 sm:h-28 shadow group-hover:shadow-lg transition-shadow">
        {person.cover_event_slug && person.cover_photo_id && person.cover_file_type ? (
          <MediaThumb
            slug={person.cover_event_slug}
            photoId={person.cover_photo_id}
            fileType={person.cover_file_type}
            cacheVersion={person.cover_cache_version}
            alt={person.name || 'Unnamed person'}
          />
        ) : (
          <Users className="w-10 h-10 text-gray-400 m-auto mt-8" />
        )}
      </div>
      <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white truncate">
        {person.name || 'Unnamed'}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {person.photo_count} photo{person.photo_count === 1 ? '' : 's'}
      </p>
    </>
  );

  if (target) {
    return (
      <Link to={target} className="text-center group block">
        {inner}
      </Link>
    );
  }
  return <div className="text-center group">{inner}</div>;
};

export default PersonAvatar;
