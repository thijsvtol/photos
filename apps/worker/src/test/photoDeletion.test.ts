import { describe, expect, it } from 'vitest';
import { permanentlyDeletePhotos } from '../photoDeletion';
import type { Env } from '../types';
import type { DeletablePhotoRef } from '../photoDeletion';

/**
 * Tests for the shared hard-delete helper used by both the admin "delete
 * forever"/"empty trash" endpoints and the nightly trash-purge cron
 * (scheduled.ts runTrashPurge) — see repo memory: this is the ONLY path
 * that should ever permanently remove a photo's R2 objects + DB row.
 */

function makeFakeBucket() {
  const deletedKeys: string[] = [];
  return {
    deletedKeys,
    delete: async (key: string) => {
      deletedKeys.push(key);
    },
  };
}

function makeFakeDb() {
  const deleteStatements: unknown[][] = [];
  return {
    deleteStatements,
    prepare(query: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async run() {
          if (query.includes('DELETE FROM photos WHERE id IN')) {
            deleteStatements.push(boundArgs);
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };
}

function makeEnv(bucket: ReturnType<typeof makeFakeBucket>, db: ReturnType<typeof makeFakeDb>): Env {
  return {
    PHOTOS_BUCKET: bucket as unknown as Env['PHOTOS_BUCKET'],
    DB: db as unknown as Env['DB'],
  } as Env;
}

describe('permanentlyDeletePhotos', () => {
  it('does nothing for an empty list', async () => {
    const bucket = makeFakeBucket();
    const db = makeFakeDb();
    await permanentlyDeletePhotos(makeEnv(bucket, db), []);
    expect(bucket.deletedKeys).toHaveLength(0);
    expect(db.deleteStatements).toHaveLength(0);
  });

  it('deletes all four R2 object variants for a non-copied photo', async () => {
    const bucket = makeFakeBucket();
    const db = makeFakeDb();
    const photo: DeletablePhotoRef = { id: 'photo-1', slug: 'my-event', source_photo_id: null };

    await permanentlyDeletePhotos(makeEnv(bucket, db), [photo]);

    expect(bucket.deletedKeys).toEqual(
      expect.arrayContaining([
        'original/my-event/photo-1.jpg',
        'original/my-event/photo-1.mp4',
        'preview/my-event/photo-1.jpg',
        'ig/my-event/photo-1.jpg',
      ])
    );
  });

  it('does not delete R2 objects for a copied photo (source_photo_id set)', async () => {
    const bucket = makeFakeBucket();
    const db = makeFakeDb();
    const copiedPhoto: DeletablePhotoRef = { id: 'copy-1', slug: 'my-event', source_photo_id: 'original-1' };

    await permanentlyDeletePhotos(makeEnv(bucket, db), [copiedPhoto]);

    expect(bucket.deletedKeys).toHaveLength(0);
  });

  it('always removes the DB row regardless of whether it is a copy', async () => {
    const bucket = makeFakeBucket();
    const db = makeFakeDb();
    const photos: DeletablePhotoRef[] = [
      { id: 'original-1', slug: 'my-event', source_photo_id: null },
      { id: 'copy-1', slug: 'my-event', source_photo_id: 'original-1' },
    ];

    await permanentlyDeletePhotos(makeEnv(bucket, db), photos);

    const allDeletedIds = db.deleteStatements.flat();
    expect(allDeletedIds).toEqual(expect.arrayContaining(['original-1', 'copy-1']));
  });

  it('chunks DB deletes to stay under the 90-id-per-statement limit', async () => {
    const bucket = makeFakeBucket();
    const db = makeFakeDb();
    const photos: DeletablePhotoRef[] = Array.from({ length: 95 }, (_, i) => ({
      id: `photo-${i}`,
      slug: 'my-event',
      source_photo_id: null,
    }));

    await permanentlyDeletePhotos(makeEnv(bucket, db), photos);

    expect(db.deleteStatements).toHaveLength(2);
    expect(db.deleteStatements[0]).toHaveLength(90);
    expect(db.deleteStatements[1]).toHaveLength(5);
  });
});
