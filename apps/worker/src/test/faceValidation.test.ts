import { describe, expect, it } from 'vitest';
import { isValidFaceInput } from '../faceValidation';

/**
 * Tests for the shared face-input validator (used by both the upload-time
 * and admin-backfill "save faces" endpoints) — defense-in-depth against a
 * buggy/malicious client posting malformed or oversized descriptors, which
 * would otherwise bloat the DB or corrupt face-clustering centroids.
 */

function validFace(overrides: Partial<{ embedding: unknown; bbox: unknown }> = {}) {
  return {
    embedding: Array.from({ length: 512 }, (_, i) => i / 512),
    bbox: { x: 0, y: 0, width: 100, height: 100 },
    ...overrides,
  };
}

describe('isValidFaceInput', () => {
  it('accepts a well-formed face (512-number embedding + numeric bbox)', () => {
    expect(isValidFaceInput(validFace())).toBe(true);
  });

  it('rejects an embedding that is not exactly 512 numbers', () => {
    expect(isValidFaceInput(validFace({ embedding: [1, 2, 3] }))).toBe(false);
    expect(isValidFaceInput(validFace({ embedding: Array.from({ length: 513 }, () => 0) }))).toBe(false);
    expect(isValidFaceInput(validFace({ embedding: [] }))).toBe(false);
  });

  it('rejects an embedding containing non-finite values', () => {
    const embedding = Array.from({ length: 512 }, () => 0);
    embedding[5] = NaN;
    expect(isValidFaceInput(validFace({ embedding }))).toBe(false);

    const embeddingInfinity = Array.from({ length: 512 }, () => 0);
    embeddingInfinity[10] = Infinity;
    expect(isValidFaceInput(validFace({ embedding: embeddingInfinity }))).toBe(false);
  });

  it('rejects an embedding containing non-number entries', () => {
    const embedding: unknown[] = Array.from({ length: 512 }, () => 0);
    embedding[0] = 'not-a-number';
    expect(isValidFaceInput(validFace({ embedding }))).toBe(false);
  });

  it('rejects a missing or malformed bbox', () => {
    expect(isValidFaceInput(validFace({ bbox: undefined }))).toBe(false);
    expect(isValidFaceInput(validFace({ bbox: { x: 0, y: 0, width: 100 } }))).toBe(false);
    expect(isValidFaceInput(validFace({ bbox: { x: 'nope', y: 0, width: 100, height: 100 } }))).toBe(false);
    expect(isValidFaceInput(validFace({ bbox: { x: 0, y: 0, width: NaN, height: 100 } }))).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isValidFaceInput(null)).toBe(false);
    expect(isValidFaceInput(undefined)).toBe(false);
    expect(isValidFaceInput('face')).toBe(false);
    expect(isValidFaceInput(42)).toBe(false);
  });
});
