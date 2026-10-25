const pendingReads = new Map<string, Promise<unknown>>();

// Only share in-flight work. Settled results are never cached, and auth changes
// and writes invalidate the map so a later read cannot join an obsolete request.
export function invalidatePendingReads(): void {
  pendingReads.clear();
}

export function deduplicateRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const existing = pendingReads.get(key);
  if (existing) return existing as Promise<T>;

  const pending = read().finally(() => {
    if (pendingReads.get(key) === pending) pendingReads.delete(key);
  });
  pendingReads.set(key, pending);
  return pending;
}
