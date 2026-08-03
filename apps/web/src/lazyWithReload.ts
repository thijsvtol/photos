import { lazy, type ComponentType } from 'react';

/**
 * Wraps React.lazy()'s dynamic import() with automatic recovery from a "stale chunk" failure —
 * see repo memory for the full incident this fixes (2026-08-03): this app deploys to Cloudflare
 * Pages, which serves index.html referencing content-HASHED JS chunk filenames (e.g.
 * AdminPeople-Bzua8w_y.js). Every new deploy replaces those files with NEW hashes; the OLD
 * hashed files are gone. If a user's browser tab has been open since BEFORE a new deploy (very
 * common — this app deploys frequently) and they then navigate to a route whose lazy chunk
 * wasn't already loaded, the browser requests the OLD (now-deleted) hashed filename — which
 * 404s. Because this app's `public/_routes.json` includes `/*` (needed for client-side routing
 * to work at all — any unmatched path must fall back to index.html so React Router can handle
 * it), Cloudffare Pages serves index.html (text/html) for that 404'd JS request too, producing
 * exactly: "Failed to load module script: Expected a JavaScript-or-Wasm module script but the
 * server responded with a MIME type of 'text/html'" — which looks like (and was reported as)
 * "the entire site is broken", when it's actually just one stale lazy-loaded route chunk.
 *
 * Fix: if the dynamic import() rejects, this assumes it's exactly this stale-chunk scenario and
 * performs ONE full page reload (`location.reload()`) to fetch the CURRENT index.html (which
 * correctly references the CURRENT deployment's chunk hashes) — self-healing the user's tab
 * automatically instead of leaving them on a permanently broken lazy-loaded page.
 *
 * FOLLOW-UP FIX (2026-08-04): the original version guarded against a reload LOOP with a
 * sessionStorage flag that, once set, was NEVER cleared — intended to stop an infinite reload
 * loop if the SAME failure kept recurring, but this had a real bug: sessionStorage persists for
 * the entire lifetime of a browser TAB (until the tab/window is closed), not just for one
 * reload. In practice this app deploys very frequently — a user can easily keep the same tab
 * open across SEVERAL separate deploys in a session. The very first stale-chunk failure in a
 * tab would correctly self-heal via one reload, but the flag it left behind then permanently
 * blocked EVERY SUBSEQUENT stale-chunk failure in that same tab from ever self-healing again,
 * for the rest of that tab's lifetime — exactly reproducing the original bug for any later
 * deploy, even though the fix appeared to work the first time. Fixed by using a
 * TIMESTAMP instead of a boolean flag: a reload is allowed again once enough time
 * (`MIN_RELOAD_INTERVAL_MS`) has passed since the last one — long enough to prevent a tight
 * reload LOOP for a single genuinely-persisting failure (e.g. a real network outage, where the
 * reload itself wouldn't fix anything and retrying every few seconds would just be wasteful),
 * but short enough that a real, later, unrelated stale-chunk failure (a subsequent deploy)
 * isn't permanently locked out for the rest of the tab's life.
 */
const RELOAD_TIMESTAMP_KEY = 'lazyWithReload:lastReloadAt';
const MIN_RELOAD_INTERVAL_MS = 10_000;

/** Exported so main.tsx's `vite:preloadError` listener (a separate failure path for the SAME
 *  class of stale-chunk issue — see that listener's own comment) can share this exact guard/key
 *  instead of duplicating slightly different logic. Returns true if a reload was actually
 *  triggered, false if one already happened too recently (within MIN_RELOAD_INTERVAL_MS). */
export function attemptStaleChunkReload(): boolean {
  const last = Number(sessionStorage.getItem(RELOAD_TIMESTAMP_KEY) || '0');
  if (Date.now() - last <= MIN_RELOAD_INTERVAL_MS) return false;
  sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, String(Date.now()));
  window.location.reload();
  return true;
}

export function lazyWithReload<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    try {
      return await importFn();
    } catch (err) {
      if (attemptStaleChunkReload()) {
        // Never resolves — the page is reloading, so this component never actually needs to
        // render; returning a pending promise avoids briefly flashing an error/fallback UI
        // during the reload.
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}

