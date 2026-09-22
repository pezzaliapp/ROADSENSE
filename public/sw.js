/* ROAD SENSE - service worker.
 *
 * Scritto a mano: nessuna libreria, nessun build step aggiuntivo, nessuna
 * dipendenza. Fa tre cose e basta.
 *
 * 1) OFFLINE SHELL
 *    L'HTML di partenza viene servito dalla cache quando la rete manca, cosi'
 *    ROAD SENSE si apre comunque (mappa senza tile, eventi locali visibili,
 *    segnalazione manuale funzionante).
 *
 * 2) ASSET CON HASH
 *    I file sotto /assets/ hanno nomi univoci per build: cache-first puro.
 *
 * 3) TILE OPENSTREETMAP - CACHE LIMITATA E RISPETTOSA
 *    Si memorizzano SOLO le tile effettivamente visualizzate, mai in anticipo.
 *    Il numero e' limitato (MAX_TILES) e le tile scadono dopo TILE_TTL_MS.
 *    Nessun download massivo, nessun prefetch: sarebbe una violazione della
 *    tile usage policy di OpenStreetMap oltre che uno spreco di banda.
 */

const VERSION = 'v0.1.0';
const SHELL_CACHE = `roadsense-shell-${VERSION}`;
const ASSET_CACHE = `roadsense-assets-${VERSION}`;
const TILE_CACHE = 'roadsense-tiles-v1';

const MAX_TILES = 400;
const TILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `reload` evita di precaricare una versione gia' stantia dalla cache HTTP.
      .then((cache) => cache.addAll(SHELL_URLS.map((u) => new Request(u, { cache: 'reload' }))))
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('roadsense-') && k !== SHELL_CACHE && k !== ASSET_CACHE && k !== TILE_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// L'aggiornamento viene applicato solo su richiesta esplicita dell'utente.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Le API non vengono mai cacheate: un evento stradale vecchio e' peggio di
  // nessun evento.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  if (isTile(url)) {
    event.respondWith(tileStrategy(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationStrategy(request));
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  event.respondWith(cacheFirst(request, SHELL_CACHE));
});

function isTile(url) {
  return url.hostname.endsWith('.tile.openstreetmap.org') || url.hostname === 'tile.openstreetmap.org';
}

/** Rete per prima, cache come rete di sicurezza: l'HTML deve restare fresco. */
async function navigationStrategy(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put('/index.html', response.clone());
    return response;
  } catch {
    const cached = (await caches.match('/index.html')) || (await caches.match('/'));
    return (
      cached ||
      new Response('<h1>ROAD SENSE non disponibile offline</h1>', {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 504 });
  }
}

/**
 * Tile: cache-first con scadenza e tetto massimo.
 * La data di memorizzazione viene letta dall'header `date` della risposta.
 */
async function tileStrategy(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    const dateHeader = cached.headers.get('date');
    const age = dateHeader ? Date.now() - Date.parse(dateHeader) : 0;
    if (!Number.isFinite(age) || age < TILE_TTL_MS) return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      void trimTiles(cache);
    }
    return response;
  } catch {
    // Offline: meglio una tile vecchia che una mappa vuota.
    return cached || new Response('', { status: 504 });
  }
}

/** Mantiene la cache tile sotto MAX_TILES eliminando le voci piu' vecchie. */
async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_TILES) return;
  const excess = keys.length - MAX_TILES;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}
