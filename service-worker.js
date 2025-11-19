// Improved service-worker.js - precache + runtime caches, network-first for navigation,
// cache-first for app shell, stale-while-revalidate for CDN libs, offline fallback.
const CACHE_VERSION = 'v2';
const PRECACHE = `bat-media-precache-${CACHE_VERSION}`;
const RUNTIME = `bat-media-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/styles.css',
  '/script.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  // Keep these here if you want them available offline immediately:
  'https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// Maximum entries for runtime caches (helps avoid unbounded storage)
const RUNTIME_MAX_ENTRIES = 60;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(PRECACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // Delete old caches that don't match current version
      const names = await caches.keys();
      await Promise.all(names
        .filter(name => name !== PRECACHE && name !== RUNTIME)
        .map(name => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

// Utility: limit cache size by deleting oldest entries
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    await trimCache(cacheName, maxItems);
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Navigation requests (HTML pages) -> network-first, fallback to offline.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Save fresh navigation responses to runtime cache optionally
          const copy = response.clone();
          caches.open(RUNTIME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return caches.match('/offline.html');
        })
    );
    return;
  }

  // Same-origin static assets (CSS, JS, images) -> cache-first strategy
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          // Put in runtime cache for future use
          return caches.open(RUNTIME).then(cache => {
            cache.put(request, response.clone());
            trimCache(RUNTIME, RUNTIME_MAX_ENTRIES).catch(() => {});
            return response;
          });
        }).catch(() => {
          // If image request fails and offline, serve an icon placeholder if available
          if (request.destination === 'image') {
            return caches.match('/icon-192.png');
          }
        });
      })
    );
    return;
  }

  // External CDN/vendor libraries -> stale-while-revalidate
  if (url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('cdnjs.cloudflare.com')) {
    event.respondWith(
      caches.open(RUNTIME).then(async cache => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
            trimCache(RUNTIME, RUNTIME_MAX_ENTRIES).catch(() => {});
          }
          return networkResponse;
        }).catch(() => null);
        // Prefer cached immediately, but update cache in background
        return cached || networkFetch || caches.match('/offline.html');
      })
    );
    return;
  }

  // Default: try cache first, then network
  event.respondWith(
    caches.match(request)
      .then(cached => cached || fetch(request))
      .catch(() => {
        if (request.destination === 'image') {
          return caches.match('/icon-192.png');
        }
      })
  );
});

// Allow the page to force the waiting service worker to become active
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});