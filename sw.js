// Network-first service worker: online it always fetches the newest file and saves a copy;
// offline it falls back to the saved copy. Bump CACHE and the #app-version in index.html together.
const CACHE = 'dinnersync-v1.1.4';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/plan.js',
  './js/ring.js',
  './js/store.js',
  './js/timer.js',
  './assets/logo.png',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then(res => {
      if (res.ok && new URL(event.request.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});
