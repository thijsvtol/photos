import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import type { Photo } from '../types';
import {
  getCachedEventPhotos,
  cacheEventPhotos,
  clearEventPhotoCache,
  clearAllEventPhotoCaches,
} from '../services/eventPhotoCache';

/**
 * The event gallery renders straight from this cache before any network request,
 * so the two ways it can go wrong are both user-visible:
 *   - a deleted photo lingering forever, because a plain upsert never removes
 *     rows the server no longer returns;
 *   - one event's photos bleeding into another's, or surviving a logout.
 */
function photo(id: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    event_id: 1,
    original_filename: `${id}.jpg`,
    file_type: 'image/jpeg',
    capture_time: '2026-08-01 12:00:00',
    uploaded_at: '2026-08-01 12:00:00',
    uploaded_by: 'admin@example.com',
    width: 4032,
    height: 3024,
    iso: null,
    aperture: null,
    shutter_speed: null,
    focal_length: null,
    camera_make: null,
    camera_model: null,
    lens_model: null,
    latitude: null,
    longitude: null,
    city: null,
    favorites_count: 0,
    blur_placeholder: null,
    is_featured: false,
    cache_version: 1,
    ...overrides,
  } as Photo;
}

describe('eventPhotoCache', () => {
  beforeEach(async () => {
    await clearAllEventPhotoCaches();
  });

  it('returns what was cached for an event', async () => {
    await cacheEventPhotos('my-event', [photo('a'), photo('b')]);

    const cached = await getCachedEventPhotos('my-event');
    expect(cached.map((p) => p.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps events separate', async () => {
    await cacheEventPhotos('event-one', [photo('a')]);
    await cacheEventPhotos('event-two', [photo('b')]);

    expect((await getCachedEventPhotos('event-one')).map((p) => p.id)).toEqual(['a']);
    expect((await getCachedEventPhotos('event-two')).map((p) => p.id)).toEqual(['b']);
  });

  it('drops photos the server no longer returns', async () => {
    await cacheEventPhotos('my-event', [photo('a'), photo('b'), photo('c')]);

    // 'b' was trashed since the last visit.
    await cacheEventPhotos('my-event', [photo('a'), photo('c')]);

    const cached = await getCachedEventPhotos('my-event');
    expect(cached.map((p) => p.id).sort()).toEqual(['a', 'c']);
  });

  it('does not drop another event\'s photos while reconciling one', async () => {
    await cacheEventPhotos('event-one', [photo('a')]);
    await cacheEventPhotos('event-two', [photo('b')]);

    await cacheEventPhotos('event-one', []);

    expect(await getCachedEventPhotos('event-one')).toEqual([]);
    expect((await getCachedEventPhotos('event-two')).map((p) => p.id)).toEqual(['b']);
  });

  it('overwrites changed fields on an existing photo', async () => {
    await cacheEventPhotos('my-event', [photo('a', { is_featured: false })]);
    await cacheEventPhotos('my-event', [photo('a', { is_featured: true })]);

    const [cached] = await getCachedEventPhotos('my-event');
    expect(cached.is_featured).toBe(true);
  });

  it('does not leak its internal slug key into returned photos', async () => {
    await cacheEventPhotos('my-event', [photo('a')]);

    const [cached] = await getCachedEventPhotos('my-event');
    expect('cached_event_slug' in cached).toBe(false);
  });

  it('clears a single event', async () => {
    await cacheEventPhotos('event-one', [photo('a')]);
    await cacheEventPhotos('event-two', [photo('b')]);

    await clearEventPhotoCache('event-one');

    expect(await getCachedEventPhotos('event-one')).toEqual([]);
    expect((await getCachedEventPhotos('event-two')).map((p) => p.id)).toEqual(['b']);
  });

  it('clears every event on logout, so a shared device leaks nothing', async () => {
    await cacheEventPhotos('event-one', [photo('a')]);
    await cacheEventPhotos('event-two', [photo('b')]);

    await clearAllEventPhotoCaches();

    expect(await getCachedEventPhotos('event-one')).toEqual([]);
    expect(await getCachedEventPhotos('event-two')).toEqual([]);
  });
});
