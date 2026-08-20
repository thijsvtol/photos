import { describe, it, expect } from 'vitest';
import { computeFileHash, sha256Stream } from '../imageUtils';

/**
 * computeFileHash powers duplicate detection (GET /admin/photos/duplicates). It must produce a
 * standard SHA-256, identical whether it takes the one-shot WebCrypto path (small files) or the
 * streaming hash-wasm path (large files, e.g. videos) — otherwise a photo and a byte-identical
 * video, or the same file hashed via different paths, wouldn't group. See imageUtils.ts.
 */

// SHA-256("abc") — canonical NIST test vector.
const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
// SHA-256("") — empty input.
const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('computeFileHash', () => {
  it('hashes a small blob to the correct SHA-256 (one-shot WebCrypto path)', async () => {
    expect(await computeFileHash(new Blob(['abc']))).toBe(SHA256_ABC);
  });

  it('hashes an empty blob correctly', async () => {
    expect(await computeFileHash(new Blob([]))).toBe(SHA256_EMPTY);
  });
});

describe('sha256Stream (streaming path used for large files / videos)', () => {
  it('produces the SAME SHA-256 as the one-shot path for identical content', async () => {
    expect(await sha256Stream(new Blob(['abc']))).toBe(SHA256_ABC);
    expect(await sha256Stream(new Blob([]))).toBe(SHA256_EMPTY);
  });

  it('matches the one-shot path across many chunks of arbitrary bytes', async () => {
    // Build a multi-part blob so the streaming reader yields several chunks.
    const parts: BlobPart[] = [];
    for (let i = 0; i < 64; i++) {
      parts.push(new Uint8Array(1024).map((_, j) => (i * 31 + j) % 256));
    }
    const blob = new Blob(parts);
    const [oneShot, streamed] = await Promise.all([computeFileHash(blob), sha256Stream(blob)]);
    expect(streamed).toBe(oneShot);
    expect(streamed).toMatch(/^[0-9a-f]{64}$/); // well-formed lowercase hex digest
  });
});
