import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, Heart, CalendarPlus, Images, Trash2, Upload, Undo2, Copy, Archive,
  Star, MapPin, Pencil, Tag, Users, UserPlus, UserMinus, ShieldAlert, Link2,
} from 'lucide-react';
import Navbar from '../components/Navbar';
import { getActivityFeed, getActivityActors, ACTIVITY_DOMAINS } from '../api';
import type { ActivityEntry, ActivityDomain } from '../api';

// Polling interval for the activity feed — deliberately NOT realtime
// (Durable Objects would require Cloudflare's paid Workers plan); a 20s
// refresh is more than good enough for an admin-facing activity log.
const POLL_INTERVAL_MS = 20_000;
const PAGE_SIZE = 50;

const DOMAIN_LABELS: Record<ActivityDomain, string> = {
  photos: 'Photos',
  events: 'Events',
  people: 'People',
  sharing: 'Sharing',
  tags: 'Tags',
};

/**
 * Per-action icons. Actions are added server-side over time, so anything not
 * listed here falls back to a per-domain icon rather than rendering a gap —
 * see iconFor().
 */
const ACTION_ICONS: Record<string, React.ReactNode> = {
  photo_upload: <Upload className="w-4 h-4 text-blue-500" />,
  photo_favorite: <Heart className="w-4 h-4 text-pink-500" />,
  photo_trash: <Trash2 className="w-4 h-4 text-red-500" />,
  photo_restore: <Undo2 className="w-4 h-4 text-emerald-500" />,
  photo_delete_permanent: <ShieldAlert className="w-4 h-4 text-red-600" />,
  photo_bulk_delete: <Trash2 className="w-4 h-4 text-red-500" />,
  photo_bulk_copy: <Copy className="w-4 h-4 text-indigo-500" />,
  photo_replace: <Pencil className="w-4 h-4 text-amber-500" />,
  photo_archive: <Archive className="w-4 h-4 text-gray-500" />,
  photo_featured: <Star className="w-4 h-4 text-yellow-500" />,
  photo_location_edit: <MapPin className="w-4 h-4 text-teal-500" />,
  event_create: <CalendarPlus className="w-4 h-4 text-blue-500" />,
  event_update: <Pencil className="w-4 h-4 text-amber-500" />,
  event_delete: <Trash2 className="w-4 h-4 text-red-600" />,
  event_tags_update: <Tag className="w-4 h-4 text-purple-500" />,
  event_location_update: <MapPin className="w-4 h-4 text-teal-500" />,
  tag_create: <Tag className="w-4 h-4 text-purple-500" />,
  tag_update: <Tag className="w-4 h-4 text-purple-400" />,
  tag_delete: <Tag className="w-4 h-4 text-red-500" />,
  person_update: <Pencil className="w-4 h-4 text-pink-500" />,
  person_merge: <Users className="w-4 h-4 text-pink-500" />,
  person_delete: <UserMinus className="w-4 h-4 text-red-500" />,
  person_tag_add: <UserPlus className="w-4 h-4 text-pink-500" />,
  person_tag_remove: <UserMinus className="w-4 h-4 text-pink-400" />,
  collab_invite: <UserPlus className="w-4 h-4 text-blue-500" />,
  collab_accept: <Users className="w-4 h-4 text-emerald-500" />,
  collab_decline: <UserMinus className="w-4 h-4 text-gray-500" />,
  collab_remove: <UserMinus className="w-4 h-4 text-red-500" />,
  collab_upload: <Upload className="w-4 h-4 text-blue-500" />,
};

const DOMAIN_FALLBACK_ICONS: Record<string, React.ReactNode> = {
  photo: <Images className="w-4 h-4 text-gray-400" />,
  event: <CalendarPlus className="w-4 h-4 text-gray-400" />,
  tag: <Tag className="w-4 h-4 text-gray-400" />,
  person: <Users className="w-4 h-4 text-gray-400" />,
  collab: <Link2 className="w-4 h-4 text-gray-400" />,
};

function iconFor(action: string): React.ReactNode {
  return (
    ACTION_ICONS[action] ??
    DOMAIN_FALLBACK_ICONS[action.split('_')[0]] ??
    <Activity className="w-4 h-4 text-gray-400" />
  );
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Humanises an unrecognised action id, e.g. `photo_foo_bar` → "photo foo bar". */
function humanizeAction(action: string): string {
  return action.replace(/_/g, ' ');
}

function describeActivity(entry: ActivityEntry): string {
  const actor = entry.actor_email;
  const meta = parseMetadata(entry.metadata);
  const inEvent = entry.event_name ? ` in ${entry.event_name}` : '';
  const num = (key: string): number | undefined =>
    typeof meta[key] === 'number' ? (meta[key] as number) : undefined;
  const str = (key: string): string | undefined =>
    typeof meta[key] === 'string' ? (meta[key] as string) : undefined;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  switch (entry.action) {
    // Photos
    case 'photo_upload':
      return `${actor} uploaded a photo${inEvent}`;
    case 'photo_favorite':
      return `${actor} favorited a photo${inEvent}`;
    case 'photo_trash':
      return `${actor} moved a photo to Trash${inEvent}`;
    case 'photo_restore':
      return `${actor} restored a photo from Trash${inEvent}`;
    case 'photo_delete_permanent':
      return str('source') === 'empty_trash'
        ? `${actor} emptied the Trash (${plural(num('count') ?? 0, 'photo')} deleted forever)`
        : `${actor} permanently deleted a photo${inEvent}`;
    case 'photo_bulk_delete':
      return `${actor} moved ${plural(num('count') ?? 0, 'photo')} to Trash${inEvent}`;
    case 'photo_bulk_copy':
      return `${actor} copied ${plural(num('count') ?? 0, 'photo')} to ${entry.event_name || str('targetSlug') || 'another event'}`;
    case 'photo_replace':
      return `${actor} replaced a photo's image${inEvent}`;
    case 'photo_archive':
      return `${actor} ${meta.archived ? 'archived' : 'unarchived'} a photo${inEvent}`;
    case 'photo_featured':
      return `${actor} ${meta.featured ? 'featured' : 'unfeatured'} a photo${inEvent}`;
    case 'photo_location_edit':
      return `${actor} set the location on ${plural(num('count') ?? 0, 'photo')}`;

    // Events
    case 'event_create':
      return `${actor} created event "${str('name') || entry.event_name || 'unnamed'}"`;
    case 'event_update': {
      const changed = Array.isArray(meta.changed) ? (meta.changed as string[]) : [];
      const name = entry.event_name || str('slug') || 'an event';
      if (changed.includes('visibility')) {
        return `${actor} changed "${name}" visibility to ${str('visibility') || 'unknown'}`;
      }
      if (changed.includes('password_set')) return `${actor} set a password on "${name}"`;
      if (changed.includes('password_removed')) return `${actor} removed the password from "${name}"`;
      return changed.length > 0
        ? `${actor} updated ${changed.join(', ')} on "${name}"`
        : `${actor} updated "${name}"`;
    }
    case 'event_delete':
      return `${actor} deleted event "${str('name') || str('slug') || 'unnamed'}" and ${plural(num('photoCount') ?? 0, 'photo')}`;
    case 'event_tags_update':
      return `${actor} set ${plural(num('tagCount') ?? 0, 'tag')} on "${entry.event_name || str('slug') || 'an event'}"`;
    case 'event_location_update':
      return `${actor} set the location for ${plural(num('count') ?? 0, 'photo')}${inEvent}`;

    // Tags
    case 'tag_create':
      return `${actor} created tag "${str('name') || 'unnamed'}"`;
    case 'tag_update':
      return `${actor} renamed tag "${str('name') || 'unnamed'}"`;
    case 'tag_delete':
      return `${actor} deleted tag "${str('name') || 'unnamed'}"`;

    // People
    case 'person_update': {
      const changed = Array.isArray(meta.changed) ? (meta.changed as string[]) : [];
      const who = str('name') ? `"${str('name')}"` : 'a person';
      if (changed.includes('account_linked')) return `${actor} linked an account to ${who}`;
      if (changed.includes('account_unlinked')) return `${actor} unlinked the account from ${who}`;
      if (changed.includes('name')) return `${actor} named a person ${who}`;
      return `${actor} updated ${who}`;
    }
    case 'person_merge':
      return `${actor} merged ${plural(num('mergedCount') ?? 0, 'person')} together (${plural(num('facesMoved') ?? 0, 'face')} moved)`;
    case 'person_delete':
      return `${actor} deleted person "${str('name') || 'unnamed'}"`;
    case 'person_tag_add':
      return meta.bulk
        ? `${actor} tagged ${plural(num('personCount') ?? 0, 'person')} across ${plural(num('photoCount') ?? 0, 'photo')}${inEvent}`
        : `${actor} tagged ${plural(num('personCount') ?? 0, 'person')} on a photo${inEvent}`;
    case 'person_tag_remove':
      return `${actor} removed a person from a photo${inEvent}`;

    // Sharing (sourced from collaboration_history)
    case 'collab_invite':
      return str('method') === 'link'
        ? `${actor} created an invite link${inEvent}`
        : `${actor} invited ${entry.target_user_email || 'someone'}${inEvent}`;
    case 'collab_accept':
      return `${actor} accepted an invite${inEvent}`;
    case 'collab_decline':
      return `${actor} declined an invite${inEvent}`;
    case 'collab_remove':
      return str('method') === 'link_revoked'
        ? `${actor} revoked an invite link${inEvent}`
        : `${actor} removed ${entry.target_user_email || 'a collaborator'}${inEvent}`;
    case 'collab_upload':
      return `${actor} uploaded a photo${inEvent}`;

    default:
      return `${actor} ${humanizeAction(entry.action)}${inEvent}`;
  }
}

/** D1 stores timestamps as "YYYY-MM-DD HH:MM:SS" in UTC, without a zone marker. */
function parseTimestamp(isoDate: string): Date {
  return new Date(isoDate.replace(' ', 'T') + 'Z');
}

function formatTimeAgo(isoDate: string): string {
  const seconds = Math.floor((Date.now() - parseTimestamp(isoDate).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function dayLabel(isoDate: string): string {
  const date = parseTimestamp(isoDate);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayDiff = Math.floor((startOfToday.getTime() - date.getTime()) / 86_400_000);
  if (dayDiff < 0) return 'Today';
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Rows are already time-ordered by the server, so grouping is a single pass. */
function groupByDay(entries: ActivityEntry[]): { label: string; entries: ActivityEntry[] }[] {
  const groups: { label: string; entries: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.created_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }
  return groups;
}

const AdminActivity: React.FC = () => {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [domain, setDomain] = useState<ActivityDomain | null>(null);
  const [eventSlug, setEventSlug] = useState<string | null>(null);
  const [actor, setActor] = useState<string | null>(null);
  const [actors, setActors] = useState<string[]>([]);

  // Guards the poll: it must never clobber pages the user has loaded via
  // "Load more", so polling only refreshes when we're showing the first page.
  const pageCountRef = useRef(1);

  const loadFirstPage = useCallback(async () => {
    try {
      const data = await getActivityFeed({ limit: PAGE_SIZE, domain, eventSlug, actor });
      setActivity(data.activity);
      setNextCursor(data.nextCursor);
      pageCountRef.current = 1;
      setError(null);
    } catch (err) {
      setError('Failed to load activity feed');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [domain, eventSlug, actor]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await getActivityFeed({ limit: PAGE_SIZE, before: nextCursor, domain, eventSlug, actor });
      setActivity((prev) => [...prev, ...data.activity]);
      setNextCursor(data.nextCursor);
      pageCountRef.current += 1;
      setError(null);
    } catch (err) {
      setError('Failed to load more activity');
      console.error(err);
    } finally {
      setLoadingMore(false);
    }
  };

  // Reset to a fresh first page whenever a filter changes.
  useEffect(() => {
    setLoading(true);
    loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    getActivityActors().then(setActors).catch((err) => console.error('Failed to load actors:', err));
  }, []);

  // Poll only while the tab is visible and the user hasn't paged past the
  // first page — a backgrounded admin tab used to hammer this endpoint every
  // 20s indefinitely.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (pageCountRef.current !== 1) return;
      loadFirstPage();
    };
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [loadFirstPage]);

  // Event options come from what's actually in the feed — no separate fetch,
  // and it can only ever offer events that have activity to show.
  const eventOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of activity) {
      if (entry.event_slug && !seen.has(entry.event_slug)) {
        seen.set(entry.event_slug, entry.event_name || entry.event_slug);
      }
    }
    return Array.from(seen, ([slug, name]) => ({ slug, name }));
  }, [activity]);

  const groups = useMemo(() => groupByDay(activity), [activity]);
  const hasFilters = domain !== null || eventSlug !== null || actor !== null;

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-sm transition ${
      active
        ? 'bg-blue-600 text-white'
        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-blue-400'
    }`;

  const selectClass =
    'px-3 py-1.5 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link to="/admin" className="text-blue-600 hover:text-blue-700 mb-4 inline-block">
          ← Back to Admin
        </Link>
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white flex items-center gap-3 mb-2">
          <Activity className="w-8 h-8" /> Activity
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Everything that happens across your events, refreshing every {POLL_INTERVAL_MS / 1000}s.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => setDomain(null)} className={chipClass(domain === null)}>
            All
          </button>
          {ACTIVITY_DOMAINS.map((d) => (
            <button key={d} onClick={() => setDomain(d)} className={chipClass(domain === d)}>
              {DOMAIN_LABELS[d]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <select
            value={eventSlug ?? ''}
            onChange={(e) => setEventSlug(e.target.value || null)}
            className={selectClass}
          >
            <option value="">All events</option>
            {eventOptions.map((opt) => (
              <option key={opt.slug} value={opt.slug}>{opt.name}</option>
            ))}
          </select>
          <select
            value={actor ?? ''}
            onChange={(e) => setActor(e.target.value || null)}
            className={selectClass}
          >
            <option value="">Everyone</option>
            {actors.map((email) => (
              <option key={email} value={email}>{email}</option>
            ))}
          </select>
          {hasFilters && (
            <button
              onClick={() => { setDomain(null); setEventSlug(null); setActor(null); }}
              className="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700"
            >
              Clear filters
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100"></div>
          </div>
        ) : activity.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400">
              {hasFilters ? 'No activity matches these filters.' : 'No activity yet.'}
            </p>
          </div>
        ) : (
          <>
            {groups.map((group) => (
              <div key={group.label} className="mb-6">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  {group.label}
                </h2>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow divide-y divide-gray-100 dark:divide-gray-700">
                  {group.entries.map((entry) => (
                    // id is only unique within a source table — see ActivityEntry.
                    <div key={`${entry.source}-${entry.id}`} className="p-4 flex items-start gap-3">
                      <div className="mt-0.5">{iconFor(entry.action)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 dark:text-gray-100">{describeActivity(entry)}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{formatTimeAgo(entry.created_at)}</p>
                      </div>
                      {entry.event_slug && (
                        <Link
                          to={`/events/${entry.event_slug}`}
                          className="text-xs text-blue-600 hover:text-blue-700 whitespace-nowrap"
                        >
                          View
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {nextCursor && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:border-blue-400 transition disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminActivity;
