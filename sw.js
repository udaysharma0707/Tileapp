
// sw.js - improved cache versioning, update-on-reload, network-first for dynamic calls
const CACHE_VERSION = 'v2'; // bump this string whenever you change assets
const CACHE_NAME = 'car-entry-cache-' + CACHE_VERSION;
const STATIC_ASSETS = [
  '/',                 // ensure correct path on GitHub Pages
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/sw.js'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Background sync for offline uploads
self.addEventListener('sync', (event) => {
  if (event.tag === 'photo-upload') {
    event.waitUntil(uploadPendingPhotos());
  }
});

async function uploadPendingPhotos() {
  // Implementation for handling offline uploads
  // Store failed uploads in IndexedDB and retry when online
  console.log('Syncing pending photo uploads...');
}

// INSTALL: cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // attempt to add all static assets; ignore failures for missing files
      return cache.addAll(STATIC_ASSETS.map(p => new Request(p, {cache: "reload"})))
        .catch(err => {
          // partial caching ok; still activate
          return Promise.resolve();
        });
    }).then(() => {
      // activate new SW immediately
      return self.skipWaiting();
    })
  );
});

// ACTIVATE: remove old caches and claim clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
        return Promise.resolve();
      }));
    }).then(() => self.clients.claim())
  );
});

// FETCH: strategy:
// - For navigation (document) and core assets -> try network first (so updates are fetched), fallback to cache
// - For other GET requests -> cache-first then network fallback
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const req = event.request;
  const url = new URL(req.url);

  // treat dynamic endpoints (your Apps Script exec) as network-first (don't serve stale cached responses)
  const isExternalAPI = url.hostname.indexOf('script.google.com') !== -1;

  if (req.mode === 'navigate' || req.headers.get('accept').includes('text/html')) {
    // navigation request - network first
    event.respondWith(
      fetch(req).then(resp => {
        // update cache with fresh index.html for offline
        caches.open(CACHE_NAME).then(cache => {
          cache.put(req, resp.clone()).catch(()=>{});
        });
        return resp.clone();
      }).catch(() => {
        return caches.match('/index.html').then(cached => cached || caches.match(req));
      })
    );
    return;
  }

  if (isExternalAPI) {
    // network-first for server calls (no caching of responses)
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // static assets and other GETs: cache-first
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(networkResp => {
        // cache the fetched resource for next time (but ignore opaque failures)
        if (networkResp && networkResp.status === 200) {
          caches.open(CACHE_NAME).then(cache => cache.put(req, networkResp.clone()).catch(()=>{}));
        }
        return networkResp.clone();
      }).catch(() => {
        // fallback to index.html for spa navigation or nothing
        return caches.match('/index.html');
      });
    })
  );
});

// Listen for SKIP_WAITING message from client (allows an update button to force new SW activation)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});


