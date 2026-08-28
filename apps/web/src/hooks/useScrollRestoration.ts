import { useEffect, useRef } from 'react';

// ~2.5s at 60fps and ~100ms of unchanged page height — same tuning as EventGallery's own
// (older, per-event) restore-poll loop, which this mirrors.
const MAX_ATTEMPTS = 150;
const STABLE_FRAMES_REQUIRED = 6;

/**
 * Restores scroll position when returning to a cross-event gallery page (Timeline, Favorites)
 * from PhotoDetail's back button/Escape/browser-back — anchored to the specific PHOTO the user
 * was viewing, not a raw pixel offset (an offset alone goes stale the instant lazily-rendered
 * content above it mounts/settles to its real height). Mirrors EventGallery's own slug-keyed
 * restore logic, minus its "expand numeric lazy-render window" step: Timeline/Favorites don't
 * paginate their on-screen render window that way, so jumping to the saved Y first is enough to
 * bring the target photo's section within its IntersectionObserver's rootMargin and trigger it
 * to mount real content instead of a placeholder.
 *
 * The matching sessionStorage entries (`${pathname}_scroll`/`${pathname}_photo`) are written by
 * JustifiedGrid's onClick handler before navigating to PhotoDetail — see its doc comment.
 * `ready` should become true once the page's photo list has loaded (e.g. `!loading &&
 * photos.length > 0`); restoration only ever runs once per mount.
 */
export function useScrollRestoration(ready: boolean): void {
  const startedRef = useRef(false);

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    if (!ready || startedRef.current) return;
    startedRef.current = true;

    const scrollKey = `${window.location.pathname}_scroll`;
    const photoKey = `${window.location.pathname}_photo`;
    const savedScroll = sessionStorage.getItem(scrollKey);
    const savedPhotoId = sessionStorage.getItem(photoKey);
    if (!savedScroll && !savedPhotoId) return;

    let cancelled = false;
    let attempts = 0;
    let lastScrollHeight = -1;
    let stableFrames = 0;

    const finish = () => {
      sessionStorage.removeItem(scrollKey);
      sessionStorage.removeItem(photoKey);
    };

    // Jump close first — brings the target's lazily-rendered section within range of its
    // IntersectionObserver so it mounts real content instead of staying a placeholder.
    window.scrollTo(0, savedScroll ? parseInt(savedScroll, 10) : 0);

    const tryScroll = () => {
      if (cancelled) return;

      if (!savedPhotoId) {
        // No specific photo id saved (defensive fallback only) — the scrollTo() above already
        // did its best.
        finish();
        return;
      }

      const el = document.querySelector(`[data-photo-id="${CSS.escape(savedPhotoId)}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });

        const currentScrollHeight = document.documentElement.scrollHeight;
        if (currentScrollHeight === lastScrollHeight) {
          stableFrames++;
        } else {
          stableFrames = 0;
          lastScrollHeight = currentScrollHeight;
        }

        if (stableFrames >= STABLE_FRAMES_REQUIRED || attempts >= MAX_ATTEMPTS) {
          el.classList.add('ring-4', 'ring-blue-500', 'ring-offset-2', 'dark:ring-offset-gray-900', 'transition-shadow');
          setTimeout(() => {
            el.classList.remove('ring-4', 'ring-blue-500', 'ring-offset-2', 'dark:ring-offset-gray-900', 'transition-shadow');
          }, 1500);
          finish();
          return;
        }
        attempts++;
        requestAnimationFrame(tryScroll);
        return;
      }

      if (attempts >= MAX_ATTEMPTS) {
        // Photo never showed up (deleted, filtered out by "Just me"/search, or simply not
        // among the pages/cache already loaded this session) — give up rather than guessing
        // at a stale pixel offset.
        finish();
        return;
      }
      attempts++;
      requestAnimationFrame(tryScroll);
    };

    requestAnimationFrame(tryScroll);

    return () => {
      cancelled = true;
    };
  }, [ready]);
}
