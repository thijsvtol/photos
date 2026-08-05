import { describe, it, expect } from 'vitest';
import { getPhotoPeople, setManualPhotoPersonTags, addManualPhotoPersonTags, removePersonFromPhoto } from '../faceClustering';
import type { Env } from '../types';

/**
 * Tests for manual photo <-> person tagging (photo_person_tags — see migration 026's doc
 * comment for why this is a separate table from photo_faces): lets an admin/editor tag
 * MULTIPLE people on a single photo even when automatic face detection missed someone or a
 * face was never detected at all, and getPhotoPeople() combines both sources (auto-detected +
 * manual) for display (e.g. PhotoDetail's Info sheet).
 */

interface FakeDb {
  photoFaces: { id: number; photo_id: string; person_id: number | null }[];
  personTags: { photo_id: string; person_id: number }[];
  personClusters: { id: number; name: string | null; face_count?: number }[];
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
            if (query.includes('SELECT id FROM photo_faces WHERE photo_id = ? AND person_id = ?')) {
              const [photoId, personId] = boundArgs as [string, number];
              const results = db.photoFaces
                .filter((f) => f.photo_id === photoId && f.person_id === personId)
                .map((f) => ({ id: f.id }));
              return { results: results as T[] };
            }
            return { results: [] as T[] };
          },
          async first<T>() {
            if (query.includes('SELECT face_count FROM person_clusters WHERE id = ?')) {
              const [personId] = boundArgs as [number];
              const cluster = db.personClusters.find((c) => c.id === personId);
              return (cluster ? { face_count: cluster.face_count ?? 0 } : null) as T | null;
            }
            return null as T | null;
          },
          async run() {
            if (query.includes('DELETE FROM photo_person_tags WHERE photo_id = ? AND person_id = ?')) {
              const [photoId, personId] = boundArgs as [string, number];
              db.personTags = db.personTags.filter((t) => !(t.photo_id === photoId && t.person_id === personId));
            } else if (query.includes('DELETE FROM photo_person_tags WHERE photo_id = ?')) {
              const [photoId] = boundArgs as [string];
              db.personTags = db.personTags.filter((t) => t.photo_id !== photoId);
            }
            if (query.includes('INSERT') && query.includes('INTO photo_person_tags')) {
              const [photoId, personId] = boundArgs as [string, number];
              const alreadyTagged = db.personTags.some((t) => t.photo_id === photoId && t.person_id === personId);
              if (!alreadyTagged) {
                db.personTags.push({ photo_id: photoId, person_id: personId });
              }
            }
            if (query.includes('UPDATE photo_faces SET person_id = NULL WHERE id IN')) {
              const faceIds = boundArgs as number[];
              for (const face of db.photoFaces) {
                if (faceIds.includes(face.id)) face.person_id = null;
              }
            }
            if (query.includes('DELETE FROM person_clusters WHERE id = ?')) {
              const [personId] = boundArgs as [number];
              db.personClusters = db.personClusters.filter((c) => c.id !== personId);
            }
            if (query.includes('UPDATE person_clusters SET face_count = ?')) {
              const [faceCount, personId] = boundArgs as [number, number];
              const cluster = db.personClusters.find((c) => c.id === personId);
              if (cluster) cluster.face_count = faceCount;
            }
            return { success: true, meta: { changes: 0 } };
          },
        };
        return stmt;
      },
      async batch<T>(statements: { run: () => Promise<T> }[]) {
        const results: T[] = [];
        for (const stmt of statements) {
          results.push(await stmt.run());
        }
        return results;
      },
    } as unknown as Env['DB'],
  } as Env;
}

describe('getPhotoPeople', () => {
  it('returns named people from BOTH automatic face detection and manual tags, de-duplicated', async () => {
    const db: FakeDb = {
      photoFaces: [{ id: 1, photo_id: 'photo-a', person_id: 1 }],
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
      photoFaces: [{ id: 1, photo_id: 'photo-a', person_id: 3 }],
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

describe('addManualPhotoPersonTags', () => {
  it('tags every given person on every given photo (cross-product)', async () => {
    const db: FakeDb = { photoFaces: [], personTags: [], personClusters: [] };

    await addManualPhotoPersonTags(makeEnv(db), ['photo-a', 'photo-b'], [1, 2]);

    expect(db.personTags.sort((a, b) => a.photo_id.localeCompare(b.photo_id) || a.person_id - b.person_id)).toEqual([
      { photo_id: 'photo-a', person_id: 1 },
      { photo_id: 'photo-a', person_id: 2 },
      { photo_id: 'photo-b', person_id: 1 },
      { photo_id: 'photo-b', person_id: 2 },
    ]);
  });

  it('is purely ADDITIVE — never removes an existing tag on any photo, even ones not in this batch', async () => {
    const db: FakeDb = {
      photoFaces: [],
      personTags: [{ photo_id: 'photo-a', person_id: 99 }],
      personClusters: [],
    };

    await addManualPhotoPersonTags(makeEnv(db), ['photo-a'], [1]);

    expect(db.personTags).toEqual([
      { photo_id: 'photo-a', person_id: 99 },
      { photo_id: 'photo-a', person_id: 1 },
    ]);
  });

  it('is a no-op (does not error) when a (photo, person) pair is already tagged', async () => {
    const db: FakeDb = {
      photoFaces: [],
      personTags: [{ photo_id: 'photo-a', person_id: 1 }],
      personClusters: [],
    };

    await addManualPhotoPersonTags(makeEnv(db), ['photo-a'], [1]);

    expect(db.personTags).toEqual([{ photo_id: 'photo-a', person_id: 1 }]);
  });

  it('de-duplicates repeated photo/person ids in the input', async () => {
    const db: FakeDb = { photoFaces: [], personTags: [], personClusters: [] };

    await addManualPhotoPersonTags(makeEnv(db), ['photo-a', 'photo-a'], [1, 1]);

    expect(db.personTags).toEqual([{ photo_id: 'photo-a', person_id: 1 }]);
  });

  it('is a no-op given an empty photoIds or personIds array', async () => {
    const db: FakeDb = { photoFaces: [], personTags: [], personClusters: [] };

    await addManualPhotoPersonTags(makeEnv(db), [], [1]);
    await addManualPhotoPersonTags(makeEnv(db), ['photo-a'], []);

    expect(db.personTags).toEqual([]);
  });
});

describe('removePersonFromPhoto', () => {
  it('removes a manual tag for the given person on the given photo', async () => {
    const db: FakeDb = {
      photoFaces: [],
      personTags: [
        { photo_id: 'photo-a', person_id: 1 },
        { photo_id: 'photo-a', person_id: 2 },
      ],
      personClusters: [],
    };

    await removePersonFromPhoto(makeEnv(db), 'photo-a', 1);

    expect(db.personTags).toEqual([{ photo_id: 'photo-a', person_id: 2 }]);
  });

  it('unassigns an automatically-detected face on the photo and decrements the person\'s face_count', async () => {
    const db: FakeDb = {
      photoFaces: [
        { id: 10, photo_id: 'photo-a', person_id: 1 },
        { id: 11, photo_id: 'photo-b', person_id: 1 }, // different photo, must stay untouched
      ],
      personTags: [],
      personClusters: [{ id: 1, name: 'Alice', face_count: 5 }],
    };

    await removePersonFromPhoto(makeEnv(db), 'photo-a', 1);

    expect(db.photoFaces.find((f) => f.id === 10)?.person_id).toBeNull();
    expect(db.photoFaces.find((f) => f.id === 11)?.person_id).toBe(1);
    expect(db.personClusters.find((c) => c.id === 1)?.face_count).toBe(4);
  });

  it('deletes the person_clusters row entirely once its face_count reaches zero', async () => {
    const db: FakeDb = {
      photoFaces: [{ id: 10, photo_id: 'photo-a', person_id: 1 }],
      personTags: [],
      personClusters: [{ id: 1, name: 'Alice', face_count: 1 }],
    };

    await removePersonFromPhoto(makeEnv(db), 'photo-a', 1);

    expect(db.personClusters).toEqual([]);
  });

  it('removes BOTH a manual tag AND an automatic face assignment when a person is attached via both', async () => {
    const db: FakeDb = {
      photoFaces: [{ id: 10, photo_id: 'photo-a', person_id: 1 }],
      personTags: [{ photo_id: 'photo-a', person_id: 1 }],
      personClusters: [{ id: 1, name: 'Alice', face_count: 1 }],
    };

    await removePersonFromPhoto(makeEnv(db), 'photo-a', 1);

    expect(db.personTags).toEqual([]);
    expect(db.photoFaces[0].person_id).toBeNull();
  });

  it('is a no-op (does not error) when the person has no tag/face on this photo at all', async () => {
    const db: FakeDb = { photoFaces: [], personTags: [], personClusters: [{ id: 1, name: 'Alice', face_count: 3 }] };

    await expect(removePersonFromPhoto(makeEnv(db), 'photo-a', 1)).resolves.toBeUndefined();
    expect(db.personClusters).toEqual([{ id: 1, name: 'Alice', face_count: 3 }]);
  });
});
