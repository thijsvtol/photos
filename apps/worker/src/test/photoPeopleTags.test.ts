import { describe, it, expect } from 'vitest';
import { getPhotoPeople, setManualPhotoPersonTags } from '../faceClustering';
import type { Env } from '../types';

/**
 * Tests for manual photo <-> person tagging (photo_person_tags — see migration 026's doc
 * comment for why this is a separate table from photo_faces): lets an admin/editor tag
 * MULTIPLE people on a single photo even when automatic face detection missed someone or a
 * face was never detected at all, and getPhotoPeople() combines both sources (auto-detected +
 * manual) for display (e.g. PhotoDetail's Info sheet).
 */

interface FakeDb {
  photoFaces: { photo_id: string; person_id: number | null }[];
  personTags: { photo_id: string; person_id: number }[];
  personClusters: { id: number; name: string | null }[];
}

function makeEnv(db: FakeDb): Env {
  return {
    DB: {
      prepare(query: string) {
        let boundArgs: unknown[] = [];
        const stmt = {
          bind(...args: unknown[]) {
            boundArgs = args;
            return stmt;
          },
          async all<T>() {
            if (query.includes('SELECT DISTINCT pc.id, pc.name')) {
              const [photoIdA, photoIdB] = boundArgs as [string, string];
              const fromFaces = db.photoFaces
                .filter((f) => f.photo_id === photoIdA && f.person_id !== null)
                .map((f) => f.person_id as number);
              const fromTags = db.personTags
                .filter((t) => t.photo_id === photoIdB)
                .map((t) => t.person_id);
              const ids = [...new Set([...fromFaces, ...fromTags])];
              const results = db.personClusters
                .filter((c) => ids.includes(c.id) && c.name !== null)
                .map((c) => ({ id: c.id, name: c.name }))
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
              return { results: results as T[] };
            }
            return { results: [] as T[] };
          },
          async first<T>() {
            return null as T | null;
          },
          async run() {
            if (query.includes('DELETE FROM photo_person_tags WHERE photo_id = ?')) {
              const [photoId] = boundArgs as [string];
              db.personTags = db.personTags.filter((t) => t.photo_id !== photoId);
            }
            if (query.includes('INSERT INTO photo_person_tags')) {
              const [photoId, personId] = boundArgs as [string, number];
              db.personTags.push({ photo_id: photoId, person_id: personId });
            }
            return { success: true, meta: { changes: 0 } };
          },
        };
        return stmt;
      },
    } as unknown as Env['DB'],
  } as Env;
}

describe('getPhotoPeople', () => {
  it('returns named people from BOTH automatic face detection and manual tags, de-duplicated', async () => {
    const db: FakeDb = {
      photoFaces: [{ photo_id: 'photo-a', person_id: 1 }],
      personTags: [{ photo_id: 'photo-a', person_id: 1 }, { photo_id: 'photo-a', person_id: 2 }],
      personClusters: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    };

    const people = await getPhotoPeople(makeEnv(db), 'photo-a');

    expect(people).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
  });

  it('excludes unnamed clusters even if a face on the photo belongs to one', async () => {
    const db: FakeDb = {
      photoFaces: [{ photo_id: 'photo-a', person_id: 3 }],
      personTags: [],
      personClusters: [{ id: 3, name: null }],
    };

    const people = await getPhotoPeople(makeEnv(db), 'photo-a');

    expect(people).toEqual([]);
  });

  it('returns an empty array for a photo with no tagged people', async () => {
    const db: FakeDb = { photoFaces: [], personTags: [], personClusters: [] };
    expect(await getPhotoPeople(makeEnv(db), 'photo-a')).toEqual([]);
  });
});

describe('setManualPhotoPersonTags', () => {
  it('replaces the full set of manual tags for a photo (delete then insert)', async () => {
    const db: FakeDb = {
      photoFaces: [],
      personTags: [{ photo_id: 'photo-a', person_id: 99 }], // stale tag, should be removed
      personClusters: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
    };

    await setManualPhotoPersonTags(makeEnv(db), 'photo-a', [1, 2]);

    expect(db.personTags).toEqual([
      { photo_id: 'photo-a', person_id: 1 },
      { photo_id: 'photo-a', person_id: 2 },
    ]);
  });

  it('de-duplicates repeated person ids in the input', async () => {
    const db: FakeDb = { photoFaces: [], personTags: [], personClusters: [] };

    await setManualPhotoPersonTags(makeEnv(db), 'photo-a', [1, 1, 2]);

    expect(db.personTags).toEqual([
      { photo_id: 'photo-a', person_id: 1 },
      { photo_id: 'photo-a', person_id: 2 },
    ]);
  });

  it('clears all manual tags when given an empty array', async () => {
    const db: FakeDb = {
      photoFaces: [],
      personTags: [{ photo_id: 'photo-a', person_id: 1 }],
      personClusters: [{ id: 1, name: 'Alice' }],
    };

    await setManualPhotoPersonTags(makeEnv(db), 'photo-a', []);

    expect(db.personTags).toEqual([]);
  });

  it('only touches the given photo\'s tags, leaving other photos untouched', async () => {
    const db: FakeDb = {
      photoFaces: [],
      personTags: [{ photo_id: 'photo-b', person_id: 5 }],
      personClusters: [{ id: 1, name: 'Alice' }],
    };

    await setManualPhotoPersonTags(makeEnv(db), 'photo-a', [1]);

    expect(db.personTags).toEqual([
      { photo_id: 'photo-b', person_id: 5 },
      { photo_id: 'photo-a', person_id: 1 },
    ]);
  });
});
