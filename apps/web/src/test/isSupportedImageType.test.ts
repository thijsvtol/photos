import { describe, it, expect } from 'vitest';
import { isSupportedImageType } from '../services/uploadManager';

function makeFile(type: string, name = 'file'): File {
  return new File(['data'], name, { type });
}

describe('isSupportedImageType', () => {
  it('accepts JPEG', () => {
    expect(isSupportedImageType(makeFile('image/jpeg'))).toBe(true);
  });

  it('accepts PNG', () => {
    expect(isSupportedImageType(makeFile('image/png'))).toBe(true);
  });

  it('rejects other image types', () => {
    expect(isSupportedImageType(makeFile('image/gif'))).toBe(false);
    expect(isSupportedImageType(makeFile('image/webp'))).toBe(false);
  });

  it('rejects unrecognized/empty types', () => {
    expect(isSupportedImageType(makeFile(''))).toBe(false);
  });
});
