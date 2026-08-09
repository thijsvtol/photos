import { describe, it, expect } from 'vitest';
import { getStorageExtension, getStorageContentType } from '../fileTypeUtils';

describe('getStorageExtension / getStorageContentType for PNG', () => {
  it('stores the PNG original with its real extension and content type', () => {
    expect(getStorageExtension('image/png', 'original')).toBe('png');
    expect(getStorageContentType('image/png', 'original')).toBe('image/png');
  });

  it('always generates a JPEG preview for PNG uploads', () => {
    expect(getStorageExtension('image/png', 'preview')).toBe('jpg');
    expect(getStorageContentType('image/png', 'preview')).toBe('image/jpeg');
  });

  it('leaves JPEG/RAW/video behavior unchanged', () => {
    expect(getStorageExtension('image/jpeg', 'original')).toBe('jpg');
    expect(getStorageContentType('image/jpeg', 'original')).toBe('image/jpeg');
    expect(getStorageExtension('raw/cr2', 'original')).toBe('cr2');
    expect(getStorageContentType('raw/cr2', 'original')).toBe('application/octet-stream');
    expect(getStorageExtension('raw/cr2', 'preview')).toBe('jpg');
    expect(getStorageExtension('video/mp4', 'original')).toBe('mp4');
    expect(getStorageContentType('video/mp4', 'original')).toBe('video/mp4');
  });
});
