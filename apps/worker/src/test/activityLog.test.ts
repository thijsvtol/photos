import { describe, expect, it, vi } from 'vitest';
import { logActivity } from '../activityLog';
import type { Env } from '../types';

/**
 * Tests for the polling-based activity feed writer (activityLog.ts). The
 * most important behavior to lock in: a failure writing an activity entry
 * must NEVER throw and break the primary action it's attached to (e.g.
 * favoriting a photo, creating an event, trashing a photo).
 */

function makeDbCapturing() {
  const inserts: unknown[][] = [];
  return {
    inserts,
    prepare(_query: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async run() {
          inserts.push(boundArgs);
          return { success: true };
        },
      };
      return stmt;
    },
  };
}

function makeThrowingDb() {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async run() {
          throw new Error('D1 is unavailable');
        },
      };
    },
  };
}

describe('logActivity', () => {
  it('inserts a row with the expected bound arguments', async () => {
    const db = makeDbCapturing();
    const env = { DB: db as unknown as Env['DB'] } as Env;

    await logActivity(env, {
      eventId: 42,
      actorEmail: 'user@example.com',
      action: 'photo_favorite',
      targetType: 'photo',
      targetId: 'photo-1',
    });

    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toEqual([42, 'user@example.com', 'photo_favorite', 'photo', 'photo-1', null]);
  });

  it('serializes metadata to JSON when provided', async () => {
    const db = makeDbCapturing();
    const env = { DB: db as unknown as Env['DB'] } as Env;

    await logActivity(env, {
      actorEmail: 'admin@example.com',
      action: 'event_create',
      targetType: 'event',
      targetId: 'my-event',
      metadata: { name: 'My Event' },
    });

    const [, , , , , metadataArg] = db.inserts[0];
    expect(metadataArg).toBe(JSON.stringify({ name: 'My Event' }));
  });

  it('defaults eventId to null when omitted', async () => {
    const db = makeDbCapturing();
    const env = { DB: db as unknown as Env['DB'] } as Env;

    await logActivity(env, {
      actorEmail: 'admin@example.com',
      action: 'tag_create',
    });

    expect(db.inserts[0][0]).toBeNull();
  });

  it('swallows errors instead of throwing, so the caller action is never broken', async () => {
    const env = { DB: makeThrowingDb() as unknown as Env['DB'] } as Env;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      logActivity(env, { actorEmail: 'user@example.com', action: 'photo_trash' })
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
