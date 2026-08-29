/**
 * Scrolls the current page so the given photo is back in view — used by gallery pages
 * (EventGallery/Timeline/MyFavorites) to restore scroll position once the PhotoDetail overlay
 * closes, since it may have been opened on a different photo than whichever one the user ended
 * up swiping to. `[data-photo-id]` elements may not exist yet if that section hasn't been
 * lazily rendered (Timeline's LazyDateGroup, EventGallery's windowed reveal) — and if the photo
 * is further than what's currently loaded, Timeline/EventGallery only fetch more via a "load
 * more" IntersectionObserver sentinel, a genuine network round-trip. Nudging the scroll forward
 * and polling on a real timer (not requestAnimationFrame, which only allows a couple of seconds
 * total) gives both the lazy-render and the pagination fetch enough real time to catch up.
 * Bounded so this can never spin forever if the photo genuinely isn't present in the page's
 * current DOM (e.g. a different filter is active).
 */
export function scrollPhotoIntoView(photoId: string): void {
  const SEARCH_TIMEOUT_MS = 8000;
  const SEARCH_POLL_MS = 200;
  const SETTLE_FRAMES_REQUIRED = 4;
  const searchStartedAt = Date.now();

  // Once found, the justified grid (react-photo-album) keeps resettling row heights for a few
  // frames — re-assert the scroll position each frame until the page height stops changing.
  const settle = (el: Element) => {
    el.scrollIntoView({ block: 'center' });
    let lastScrollHeight = document.documentElement.scrollHeight;
    let stableFrames = 0;

    const step = () => {
      const scrollHeight = document.documentElement.scrollHeight;
      if (scrollHeight === lastScrollHeight) {
        stableFrames++;
      } else {
        stableFrames = 0;
        lastScrollHeight = scrollHeight;
        el.scrollIntoView({ block: 'center' });
      }
      if (stableFrames >= SETTLE_FRAMES_REQUIRED) return;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const search = () => {
    const el = document.querySelector(`[data-photo-id="${CSS.escape(photoId)}"]`);
    if (el) {
      settle(el);
      return;
    }

    if (Date.now() - searchStartedAt > SEARCH_TIMEOUT_MS) return;

    window.scrollBy(0, window.innerHeight * 0.85);
    setTimeout(search, SEARCH_POLL_MS);
  };

  search();
}
