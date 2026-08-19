import { describe, expect, it } from 'vitest';
import { computeUnnamedSuggestion } from '../faceClustering';

/**
 * Unit tests for the confidence decision core behind the "Unnamed people" cleanup
 * (getUnnamedPeopleWithSuggestions / merge-unnamed-confident). The surrounding SQL can't be
 * exercised by the worker's hand-rolled D1 mocks, but this pure helper holds all the branching
 * that matters — the three gates that decide whether an unnamed cluster is safe to auto-merge
 * into a named person: coverage (>=80% of photos), dominance (>=2x the runner-up), and centroid
 * similarity (>=0.6 cosine).
 */

const v = (...xs: number[]) => Float32Array.from(xs);
/** A named-people map: id -> { name, centroid }. */
const named = (entries: Array<[number, string, number[]]>) =>
  new Map(entries.map(([id, name, c]) => [id, { name, centroid: Float32Array.from(c) }]));

describe('computeUnnamedSuggestion', () => {
  it('is confident when one named person dominates the cluster and centroids match', () => {
    const { suggestion, confident } = computeUnnamedSuggestion(
      [{ named_id: 5, shared: 9 }],
      10,
      v(1, 0),
      named([[5, 'Anna', [1, 0]]])
    );
    expect(confident).toBe(true);
    expect(suggestion).toMatchObject({ personId: 5, name: 'Anna', sharedPhotos: 9, totalPhotos: 10 });
    expect(suggestion!.centroidSimilarity).toBeCloseTo(1);
  });

  it('is NOT confident for a group photo where two named people co-occur equally (dominance gate)', () => {
    const { suggestion, confident } = computeUnnamedSuggestion(
      [
        { named_id: 5, shared: 10 },
        { named_id: 6, shared: 10 },
      ],
      10,
      v(1, 0),
      named([
        [5, 'Anna', [1, 0]],
        [6, 'Bram', [1, 0]],
      ])
    );
    // Still surfaces a best-guess suggestion for manual review...
    expect(suggestion).not.toBeNull();
    // ...but must not be auto-mergeable: neither candidate is 2x the other.
    expect(confident).toBe(false);
  });

  it('is NOT confident when the tagged named person is a different face (centroid gate)', () => {
    const { suggestion, confident } = computeUnnamedSuggestion(
      [{ named_id: 7, shared: 10 }],
      10,
      v(1, 0),
      named([[7, 'Chris', [0, 1]]]) // orthogonal → cosine 0
    );
    expect(suggestion).not.toBeNull();
    expect(suggestion!.centroidSimilarity).toBeCloseTo(0);
    expect(confident).toBe(false);
  });

  it('is NOT confident when coverage is below the threshold', () => {
    const { confident } = computeUnnamedSuggestion(
      [{ named_id: 5, shared: 5 }],
      10, // 50% coverage < 80%
      v(1, 0),
      named([[5, 'Anna', [1, 0]]])
    );
    expect(confident).toBe(false);
  });

  it('returns no suggestion when there are no named candidates', () => {
    const { suggestion, confident } = computeUnnamedSuggestion([], 10, v(1, 0), named([]));
    expect(suggestion).toBeNull();
    expect(confident).toBe(false);
  });

  it('returns no suggestion when the top candidate is not a known named person', () => {
    const { suggestion } = computeUnnamedSuggestion(
      [{ named_id: 99, shared: 10 }],
      10,
      v(1, 0),
      named([[5, 'Anna', [1, 0]]])
    );
    expect(suggestion).toBeNull();
  });

  it('picks the highest-shared candidate as the suggestion regardless of input order', () => {
    const { suggestion } = computeUnnamedSuggestion(
      [
        { named_id: 5, shared: 3 },
        { named_id: 6, shared: 9 },
      ],
      10,
      v(1, 0),
      named([
        [5, 'Anna', [1, 0]],
        [6, 'Bram', [1, 0]],
      ])
    );
    expect(suggestion!.personId).toBe(6);
    expect(suggestion!.name).toBe('Bram');
  });

  it('treats a mismatched-dimension centroid as similarity 0 (not confident)', () => {
    const { suggestion, confident } = computeUnnamedSuggestion(
      [{ named_id: 5, shared: 10 }],
      10,
      v(1, 0, 0), // 3-dim
      named([[5, 'Anna', [1, 0]]]) // 2-dim
    );
    expect(suggestion!.centroidSimilarity).toBe(0);
    expect(confident).toBe(false);
  });
});
