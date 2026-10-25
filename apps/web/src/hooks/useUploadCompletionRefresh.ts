import { useEffect, useRef } from 'react';

export function useUploadCompletionRefresh(
  scope: string | null,
  completedIds: string[],
  refresh: () => Promise<void>
): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const seenRef = useRef(new Set<string>());
  const scheduleRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    seenRef.current = new Set();
    if (!scope) return;

    let cancelled = false;
    let dirty = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (cancelled || running || timer !== undefined) return;
      timer = setTimeout(async () => {
        timer = undefined;
        dirty = false;
        running = true;
        try {
          await refreshRef.current();
        } catch (error) {
          console.error('Failed to refresh gallery after uploads:', error);
        } finally {
          running = false;
          // A completion during a slow fetch needs a fresh request afterward,
          // not a concurrent request that could share the older response.
          if (dirty) schedule();
        }
      }, 1000);
    };

    scheduleRef.current = () => {
      dirty = true;
      schedule();
    };
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      scheduleRef.current = null;
    };
  }, [scope]);

  useEffect(() => {
    if (!scope) return;
    const hasNewCompletion = completedIds.some((id) => !seenRef.current.has(id));
    seenRef.current = new Set(completedIds);
    if (hasNewCompletion) scheduleRef.current?.();
  }, [scope, completedIds]);
}
