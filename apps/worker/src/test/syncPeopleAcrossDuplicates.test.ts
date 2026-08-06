import { describe, it, expect } from 'vitest';
import { syncPeopleAcrossDuplicates } from '../faceClustering';
import type { Env } from '../types';

/**
 * Tests for syncPeopleAcrossDuplicates() — copies people already identified (auto-detected face
 * or manual tag) on one exact-content duplicate photo (same file_hash) to every other copy
 * missing them, so tagging/clustering one copy (e.g. in the "Evil8" event) doesn't have to be
 * redone by hand for a second copy of the same photo shared into a different event (e.g. "TBT
 * Event"). See its doc comment in faceClustering.ts for the full rationale.
 */

interface FakePhoto {
  id: string;
  file_hash: string | null;
}
interface FakeFace {
  photo_id: string;
  person_id: number | null;
}
interface FakeTag {
  photo_id: string;
  person_id: number;
}
interface FakeCluster {
  id: number;
  name: string | null;
}

function makeEnv(photos: FakePhoto[], faces: FakeFace[], tags: FakeTag[], clusters: FakeCluster[]): Env {
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
            if (query.includes('SELECT id, file_hash') && query.includes('FROM photos')) {
              const hashCounts = new Map<string, number>();
              for (const p of photos) {
                if (!p.file_hash) continue;
                hashCounts.set(p.file_hash, (hashCounts.get(p.file_hash) || 0) + 1);
              }
              const results = photos
                .filter((p) => p.file_hash && (hashCounts.get(p.file_hash) || 0) > 1)
                .map((p) => ({ id: p.id, file_hash: p.file_hash }));
              return { results: results as T[] };
            }
            if (query.includes('SELECT DISTINCT photo_id, person_id')) {
              const half = boundArgs.length / 2;
              const photoIds = boundArgs.slice(0, half) as string[];
              const namedIds = new Set(clusters.filter((c) => c.name !== null).map((c) => c.id));
              const fromFaces = faces
                .filter((f) => photoIds.includes(f.photo_id) && f.person_id !== null && namedIds.has(f.person_id))
                .map((f) => ({ photo_id: f.photo_id, person_id: f.person_id as number }));
              const fromTags = tags
                .filter((t) => photoIds.includes(t.photo_id) && namedIds.has(t.person_id))
                .map((t) => ({ photo_id: t.photo_id, person_id: t.person_id }));
              const seen = new Set<string>();
              const results = [...fromFaces, ...fromTags].filter((r) => {
                const key = `${r.photo_id}:${r.person_id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              return { results: results as T[] };
            }
            return { results: [] as T[] };
          },
          async first<T>() {
            return null as T | null;
          },
          async run() {
            if (query.includes('INSERT OR IGNORE INTO photo_person_tags')) {
              const [photoId, personId] = boundArgs as [string, number];
              const alreadyTagged = tags.some((t) => t.photo_id === photoId && t.person_id === personId);
              if (!alreadyTagged) tags.push({ photo_id: photoId, person_id: personId });
            }
            return { success: true, meta: { changes: 0 } };
          },
        };
        return stmt;
      },
    } as unknown as Env['DB'],
  } as Env;
}

describe('syncPeopleAcrossDuplicates', () => {
  it('adds a manual tag for a person identified on one duplicate copy to every other copy missing them', async () => {
    const photos: FakePhoto[] = [
      { id: 'evil8-photo', file_hash: 'abc' },
      { id: 'tbt-photo', file_hash: 'abc' },
    ];
    const faces: FakeFace[] = [{ photo_id: 'evil8-photo', person_id: 1 }];
    const tags: FakeTag[] = [];
    const clusters: FakeCluster[] = [{ id: 1, name: 'Thijs van Tol' }];

    const env = makeEnv(photos, faces, tags, clusters);
    const result = await syncPeopleAcrossDuplicates(env);

    expect(result).toEqual({ groupsSynced: 1, tagsAdded: 1 });
    expect(tags).toContainEqual({ photo_id: 'tbt-photo', person_id: 1 });
  });

  it('is a no-op when every duplicate copy already has the same people', async () => {
    const photos: FakePhoto[] = [
      { id: 'photo-a', file_hash: 'abc' },
      { id: 'photo-b', file_hash: 'abc' },
    ];
    const faces: FakeFace[] = [];
    const tags: FakeTag[] = [
      { photo_id: 'photo-a', person_id: 1 },
      { photo_id: 'photo-b', person_id: 1 },
    ];
    const clusters: FakeCluster[] = [{ id: 1, name: 'Someone' }];

    const env = makeEnv(photos, faces, tags, clusters);
    const result = await syncPeopleAcrossDuplicates(env);

    expect(result).toEqual({ groupsSynced: 0, tagsAdded: 0 });
  });

  it('ignores unnamed clusters (never tags a meaningless un-reviewed grouping)', async () => {
    const photos: FakePhoto[] = [
      { id: 'photo-a', file_hash: 'abc' },
      { id: 'photo-b', file_hash: 'abc' },
    ];
    const faces: FakeFace[] = [{ photo_id: 'photo-a', person_id: 99 }];
    const tags: FakeTag[] = [];
    const clusters: FakeCluster[] = [{ id: 99, name: null }];

    const env = makeEnv(photos, faces, tags, clusters);
    const result = await syncPeopleAcrossDuplicates(env);

    expect(result).toEqual({ groupsSynced: 0, tagsAdded: 0 });
    expect(tags).toHaveLength(0);
  });

  it('handles a duplicate group spanning more than two photos', async () => {
    const photos: FakePhoto[] = [
      { id: 'p1', file_hash: 'xyz' },
      { id: 'p2', file_hash: 'xyz' },
      { id: 'p3', file_hash: 'xyz' },
    ];
    const faces: FakeFace[] = [{ photo_id: 'p1', person_id: 1 }];
    const tags: FakeTag[] = [{ photo_id: 'p2', person_id: 2 }];
    const clusters: FakeCluster[] = [
      { id: 1, name: 'Person One' },
      { id: 2, name: 'Person Two' },
    ];

    const env = makeEnv(photos, faces, tags, clusters);
    const result = await syncPeopleAcrossDuplicates(env);

    expect(result).toEqual({ groupsSynced: 1, tagsAdded: 4 });
    expect(tags).toContainEqual({ photo_id: 'p2', person_id: 1 });
    expect(tags).toContainEqual({ photo_id: 'p3', person_id: 1 });
    expect(tags).toContainEqual({ photo_id: 'p1', person_id: 2 });
    expect(tags).toContainEqual({ photo_id: 'p3', person_id: 2 });
  });
});
