/**
 * Global image load priority manager.
 *
 * Tracks pending Image() loads from gallery components. When a user clicks
 * a specific photo, `prioritize(src)` aborts all other pending loads so the
 * browser's connection pool is freed for the clicked image.
 */

type PendingLoad = {
  img: HTMLImageElement;
  abort: () => void;
};

const pending = new Map<string, PendingLoad>();

/** Register a pending image load. Returns a cleanup function. */
export function registerLoad(src: string, img: HTMLImageElement): () => void {
  const entry: PendingLoad = {
    img,
    abort: () => {
      img.src = '';
      img.onload = null;
      img.onerror = null;
    },
  };
  pending.set(src, entry);

  return () => {
    pending.delete(src);
  };
}

/** Abort a specific pending load (e.g. on component unmount). */
export function abortLoad(src: string): void {
  const entry = pending.get(src);
  if (entry) {
    entry.abort();
    pending.delete(src);
  }
}

/**
 * Prioritize a specific image: abort all OTHER pending loads to free
 * browser connections for the target image.
 */
export function prioritize(src: string): void {
  for (const [url, entry] of pending) {
    if (url !== src) {
      entry.abort();
    }
  }
  pending.clear();
}
