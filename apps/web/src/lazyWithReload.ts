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
 * automatically instead of leaving them on a permanently broken lazy-loaded page. A
 * sessionStorage flag prevents an infinite reload loop if the import somehow keeps failing for
 * a different, unrelated reason (e.g. a genuine network outage) — after one reload attempt per
 * page load, a persisting failure is left to throw/surface normally (e.g. to the app's
 * <ErrorBoundary>) rather than reloading forever.
 */
export function lazyWithReload<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    try {
      return await importFn();
    } catch (err) {
      const reloadKey = 'lazyWithReload:reloaded';
      if (!sessionStorage.getItem(reloadKey)) {
        sessionStorage.setItem(reloadKey, '1');
        window.location.reload();
        // Never resolves — the page is reloading, so this component never actually needs to
        // render; returning a pending promise avoids briefly flashing an error/fallback UI
        // during the reload.
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}
