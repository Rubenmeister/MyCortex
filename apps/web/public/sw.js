// MyCortex service worker — offline shell + asset cache.
// Diseño conservador para no romper la app viva:
//  · cross-origin (la API en Cloud Run) → NUNCA se toca, va directo a la red.
//  · navegaciones → network-first, con página offline de respaldo.
//  · assets con hash de Next (/_next/static/) e íconos → cache-first (inmutables).
//  · el resto same-origin → red normal.
// El nombre de cache lleva versión: un deploy nuevo purga el viejo.

const VERSION = 'v1';
const STATIC_CACHE = `mycortex-static-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    PRECACHE.includes(url.pathname) ||
    /\.(?:png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Cross-origin (la API, Supabase, etc.) → sin interceptar.
  if (url.origin !== self.location.origin) return;

  // Navegaciones: red primero; si no hay red, la página offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
    );
    return;
  }

  // Assets inmutables: cache primero, red como respaldo (y se cachea al vuelo).
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request)
            .then((res) => {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
              return res;
            })
            .catch(() => cached ?? Response.error()),
      ),
    );
  }
  // El resto same-origin: red normal (sin cachear).
});
