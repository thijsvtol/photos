import { describe, expect, it } from 'vitest';
import { cosineSimilarity, embedSearchQuery } from '../aiEnrichment';
import type { Env } from '../types';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 10);
  });

  it('is 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 10);
  });

  it('is -1 for opposite vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([-1, -2, -3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 10);
  });

  it('returns 0 when either vector is all-zero (avoids division by zero)', () => {
    const zero = new Float32Array([0, 0, 0]);
    const other = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(zero, other)).toBe(0);
    expect(cosineSimilarity(other, zero)).toBe(0);
  });

  it('handles vectors of different lengths by comparing only the overlapping prefix', () => {
    const a = new Float32Array([1, 2, 3, 4]);
    const b = new Float32Array([1, 2]);
    // Should not throw, and should equal cosineSimilarity of the truncated vectors.
    const truncatedA = new Float32Array([1, 2]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(truncatedA, b), 10);
  });
});

describe('embedSearchQuery', () => {
  it('returns null when no AI binding is configured', async () => {
    const env = { AI: undefined } as unknown as Env;
    const result = await embedSearchQuery(env, 'a search query');
    expect(result).toBeNull();
  });

  it('returns null and does not throw if the AI binding itself throws', async () => {
    const env = {
      AI: { run: async () => { throw new Error('boom'); } },
    } as unknown as Env;
    const result = await embedSearchQuery(env, 'a search query');
    expect(result).toBeNull();
  });

  it('returns the embedded vector from a successful AI call', async () => {
    const env = {
      AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
    } as unknown as Env;
    const result = await embedSearchQuery(env, 'a search query');
    expect(result).toBeInstanceOf(Float32Array);
    const values = Array.from(result as Float32Array);
    expect(values).toHaveLength(3);
    // Compare with tolerance: the vector round-trips through Float32Array,
    // which loses some float64 precision (e.g. 0.1 -> 0.10000000149011612).
    values.forEach((value, i) => expect(value).toBeCloseTo([0.1, 0.2, 0.3][i], 5));
  });
});
