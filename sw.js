// Service worker: carga normal en línea y página de respaldo para navegación sin conexión.
importScripts('https://storage.googleapis.com/workbox-cdn/releases/5.1.2/workbox-sw.js');

const CACHE = 'creamos-imagen-offline-v2';
const offlineFallbackPage = './offline.html';

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(offlineFallbackPage))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith('creamos-imagen-offline-') && name !== CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

if (workbox.navigationPreload.isSupported()) {
  workbox.navigationPreload.enable();
}

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;

  event.respondWith((async () => {
    try {
      const preloadResponse = await event.preloadResponse;
      if (preloadResponse) return preloadResponse;
      return await fetch(event.request);
    } catch (error) {
      const cache = await caches.open(CACHE);
      const fallback = await cache.match(offlineFallbackPage);
      if (fallback) return fallback;
      return new Response('Sin conexión. Vuelve a intentarlo cuando tengas acceso a Internet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
