// ===========================================================================
// Service worker.
//
// The point of caching here is a fast, working shell — not offline trading.
// Market data is worthless the moment it is stale, so nothing from the API is
// ever served from cache: a price that loads instantly and is an hour old is
// worse than one that fails honestly.
//
//   Pages and code      network first, cache as a fallback. Serving stale CSS
//                       or JS from cache means a deploy reaches nobody until
//                       their second visit, and a half-updated app is worse
//                       than a slightly slower one.
//   Immutable assets    icons and the manifest are cache first; they only
//                       change when their name does.
//   /api/*              never cached, never intercepted.
// ===========================================================================

const VERSION = 'blacktick-v2';

// Only things that genuinely never change behind a fixed URL.
const IMMUTABLE = /^\/static\/(icons)\//;
const SHELL = [
  '/',
  '/terminal',
  '/manifest.webmanifest',
  '/static/css/theme.css',
  '/static/css/dashboard.css',
  '/static/css/terminal.css',
  '/static/css/livecrypto.css',
  '/static/css/mobile.css',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Individually, so one missing file cannot fail the whole install.
    await Promise.allSettled(SHELL.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // exchanges, CDNs: leave alone
  if (url.pathname.startsWith('/api/')) return;         // market data is never cached

  const isPage = req.mode === 'navigate';

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);

    if (isPage) {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch (_e) {
        return (await cache.match(req)) || (await cache.match('/')) ||
          new Response('Offline, and this page was never cached.', {
            status: 503, headers: { 'Content-Type': 'text/plain' },
          });
      }
    }

    // Icons and the manifest can come straight from cache.
    if (IMMUTABLE.test(url.pathname)) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }

    // Everything else — stylesheets, scripts, data files — goes to the network
    // first so a change actually lands, with the cache there for offline.
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const hit = await cache.match(req);
      if (hit) return hit;
      return new Response('', { status: 504 });
    }
  })());
});

// The page asks the worker to raise the notification so it still appears when
// the window is in the background.
self.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.type !== 'signal-notify') return;
  self.registration.showNotification(d.title, {
    body: d.body,
    icon: '/static/icons/icon-192.png',
    badge: '/static/icons/icon-192.png',
    tag: d.tag || 'signal',
    renotify: true,
    requireInteraction: !!d.sticky,
    data: { url: d.url || '/#live' },
  });
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/#live';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(self.location.origin)) { await c.focus(); return; }
    }
    await self.clients.openWindow(target);
  })());
});
