import { describe, it, expect } from 'vitest';
import { firstNameOf } from '../utils';

describe('firstNameOf', () => {
  it('returns the first word of a multi-word name', () => {
    expect(firstNameOf('Jane Doe')).toBe('Jane');
  });

  it('collapses extra internal whitespace', () => {
    expect(firstNameOf('  Jane   Doe  ')).toBe('Jane');
  });

  it('returns a single-word name unchanged', () => {
    expect(firstNameOf('Jane')).toBe('Jane');
  });

  it('returns null for null/undefined/empty input', () => {
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
    expect(firstNameOf('')).toBeNull();
    expect(firstNameOf('   ')).toBeNull();
  });
});
