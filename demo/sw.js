// Network-first service worker: online it always fetches the newest file and saves a copy;
// offline it falls back to the saved copy. Bump CACHE and the #app-version in index.html together.
const CACHE = 'dinnersync-demo-v1.3.12';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/builder.js',
  './js/meal.js',
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
      .then(keys => Promise.all(keys.filter(k => k.startsWith('dinnersync-demo-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Done on the alarm notification tells every open page to stop the alarm; a plain tap just opens the app.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (event.action === 'done') clients.forEach(c => c.postMessage({ type: 'alarm-done' }));
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('./');
    })
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
