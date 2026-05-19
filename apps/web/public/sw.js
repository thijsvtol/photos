// Service Worker for caching preview images
// Strategy: cache-first for media previews, network-first for everything else

const CACHE_NAME = 'photos-preview-v1';
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

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Only cache-first for preview media requests (images/videos)
  if (!PREVIEW_PATTERN.test(url)) {
    return; // Let the browser handle non-media requests normally
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Try cache first
      const cached = await cache.match(event.request);
      if (cached) {
        return cached;
      }

      // Not in cache — fetch from network
      const response = await fetch(event.request);
      if (response.ok) {
        // Clone and store in cache (don't await — fire and forget)
        const clone = response.clone();
        cache.put(event.request, clone).then(() => trimCache());
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
