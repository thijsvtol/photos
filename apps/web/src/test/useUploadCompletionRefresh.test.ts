import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploadCompletionRefresh } from '../hooks/useUploadCompletionRefresh';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('upload-triggered gallery refreshes', () => {
  it('coalesces a burst into one refresh, including already-completed uploads at mount', async () => {
    const refresh = vi.fn(async () => {});
    const { rerender } = renderHook(
      ({ ids }) => useUploadCompletionRefresh('event', ids, refresh),
      { initialProps: { ids: ['one'] } }
    );
    rerender({ ids: ['one', 'two'] });
    rerender({ ids: ['one', 'two', 'three'] });
    expect(refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ ids: ['one', 'two', 'three'] });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not starve refreshes during continuous uploads', async () => {
    const refresh = vi.fn(async () => {});
    const { rerender } = renderHook(
      ({ ids }) => useUploadCompletionRefresh('event', ids, refresh),
      { initialProps: { ids: ['one'] } }
    );
    await act(() => vi.advanceTimersByTimeAsync(900));
    rerender({ ids: ['one', 'two'] });
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ ids: ['one', 'two', 'three'] });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('queues a trailing refresh when an upload finishes during an in-flight refresh', async () => {
    let finish!: () => void;
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ ids }) => useUploadCompletionRefresh('event', ids, refresh),
      { initialProps: { ids: ['one'] } }
    );
    await act(() => vi.advanceTimersByTimeAsync(1000));
    rerender({ ids: ['one', 'two'] });
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('cancels pending work on navigation, logout and unmount', async () => {
    const refresh = vi.fn(async () => {});
    const { rerender, unmount } = renderHook(
      ({ scope, ids }: { scope: string | null; ids: string[] }) => useUploadCompletionRefresh(scope, ids, refresh),
      { initialProps: { scope: 'one' as string | null, ids: ['one'] } }
    );
    rerender({ scope: 'two', ids: [] });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(refresh).not.toHaveBeenCalled();
    rerender({ scope: 'two', ids: ['two'] });
    rerender({ scope: null, ids: ['two'] });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(refresh).not.toHaveBeenCalled();
    rerender({ scope: 'two', ids: ['two'] });
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(refresh).not.toHaveBeenCalled();
  });
});
