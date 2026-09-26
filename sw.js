// Service worker de Mi Portal (app instalable).
//
// Solo hace una cosa: si al abrir una página no hay internet, muestra
// offline.html en vez del error del navegador. Todo lo demás (páginas,
// llamadas a /api/portal, sesión, scripts) va directo a la red y NUNCA se
// guarda en caché: así el login y los datos siempre están al día. Un intento
// anterior que cacheaba más cosas terminó rompiendo el inicio de sesión.
//
// Al cambiar este archivo, subir VERSION para que los teléfonos lo renueven.
const VERSION = "mi-portal-v1";
const RESPALDO = ["/offline.html", "/brand/app-icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(RESPALDO)).then(() => self.skipWaiting()));
});

// Borra cachés antiguos, incluidos los del intento anterior (Workbox).
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter((n) => n !== VERSION).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(fetch(req).catch(async () => {
    const respaldo = await caches.match("/offline.html");
    return respaldo || new Response("Sin conexión. Vuelve a intentarlo cuando tengas internet.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }));
});
