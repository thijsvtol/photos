import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deduplicateRead, invalidatePendingReads } from '../services/pendingReads';

beforeEach(invalidatePendingReads);

describe('in-flight read deduplication', () => {
  it('shares identical concurrent reads but never caches settled results', async () => {
    const read = vi.fn(async () => ['photo']);
    const first = deduplicateRead('event:one', read);
    const second = deduplicateRead('event:one', read);
    expect(first).toBe(second);
    expect(read).toHaveBeenCalledTimes(1);
    await first;
    await deduplicateRead('event:one', read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps event, filter and permission scopes separate', async () => {
    const read = vi.fn(async () => []);
    await Promise.all([
      deduplicateRead('event:one', read),
      deduplicateRead('event:two', read),
      deduplicateRead('people:public:one', read),
      deduplicateRead('people:admin:named', read),
    ]);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('allows retries after failure and propagates errors to every caller', async () => {
    const failure = new Error('Network failed');
    const read = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(['fresh']);
    const first = deduplicateRead('event:one', read);
    const second = deduplicateRead('event:one', read);
    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    await expect(deduplicateRead('event:one', read)).resolves.toEqual(['fresh']);
  });

  it('does not join pre-auth-change or pre-mutation reads, even while they finish', async () => {
    let finishOld!: (value: string[]) => void;
    let finishNew!: (value: string[]) => void;
    const old = deduplicateRead('event:one', () => new Promise<string[]>((resolve) => { finishOld = resolve; }));
    invalidatePendingReads();
    const current = deduplicateRead('event:one', () => new Promise<string[]>((resolve) => { finishNew = resolve; }));
    finishOld(['old']);
    await old;
    const read = vi.fn(async () => ['unexpected']);
    expect(deduplicateRead('event:one', read)).toBe(current);
    expect(read).not.toHaveBeenCalled();
    finishNew(['new']);
    await expect(current).resolves.toEqual(['new']);
  });
});
