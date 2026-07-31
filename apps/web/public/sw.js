// Service Worker for caching preview images
// Strategy: cache-first for media previews, network-first for everything else

const CACHE_NAME = 'photos-preview-v2'; // bumped: v1 cached by full URL (incl. volatile auth params)
const MAX_CACHE_SIZE_BYTES = 200 * 1024 * 1024; // 200MB
const PREVIEW_PATTERN = /\/media\/[^/]+\/preview\//;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// The native app appends volatile auth query params to every media URL
// (`est=<event session token>`, `token=<bearer token>`) that can change
// between app sessions even when the underlying photo hasn't changed at all.
// Caching by the FULL request URL (including those params) means a token
// rotation makes every single cached preview a miss — the whole album gets
// redownloaded on every app open even though nothing actually changed.
// Only `v` (cache_version — the real content-version signal, bumped when a
// photo is edited) should participate in the cache key.
function getCacheKey(url) {
  const parsed = new URL(url);
  const version = parsed.searchParams.get('v');
  parsed.search = version !== null ? `?v=${version}` : '';
  return parsed.toString();
}

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Only cache-first for preview media requests (images/videos)
  if (!PREVIEW_PATTERN.test(url)) {
    return; // Let the browser handle non-media requests normally
  }

  const cacheKey = getCacheKey(url);

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Try cache first (keyed on the normalized URL, ignoring auth params)
      const cached = await cache.match(cacheKey);
      if (cached) {
        return cached;
      }

      // Not in cache — fetch from network using the REAL request (with its
      // auth query params intact, so the server can authorize it)
      const response = await fetch(event.request);
      if (response.ok) {
        // Clone and store in cache under the normalized key (don't await —
        // fire and forget)
        const clone = response.clone();
        cache.put(cacheKey, clone).then(() => trimCache());
      }
      return response;
    }).catch(() => {
      // Network error and not in cache — return a transparent placeholder
      return new Response('', { status: 503, statusText: 'Offline' });
    })
  );
});

// Evict oldest entries when cache exceeds size limit (approximate LRU)
async function trimCache() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();

  // Only check periodically (every ~50 new entries)
  if (keys.length % 50 !== 0) return;

  let totalSize = 0;
  const entries = [];

  for (const request of keys) {
    const response = await cache.match(request);
    if (response) {
      const blob = await response.clone().blob();
      entries.push({ request, size: blob.size });
      totalSize += blob.size;
    }
  }

  // Evict oldest entries (first in list = oldest) until under limit
  if (totalSize > MAX_CACHE_SIZE_BYTES) {
    let removed = 0;
    for (const entry of entries) {
      if (totalSize - removed <= MAX_CACHE_SIZE_BYTES) break;
      await cache.delete(entry.request);
      removed += entry.size;
    }
  }
}
