// Minimal stale-while-revalidate service worker for offline capability.
const CACHE = 'alongside-v5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './game.js',
  './runner.js',
  './stax.js',
  './pulse.js',
  './yt.js',
  './chart.js',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);
    const network = fetch(e.request)
      .then(r => { if (r && r.ok && r.type === 'basic') cache.put(e.request, r.clone()); return r; })
      .catch(() => cached);
    return cached || network;
  })());
});
