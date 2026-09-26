/* ROAD SENSE - service worker.
 *
 * Scritto a mano: nessuna libreria, nessun build step aggiuntivo, nessuna
 * dipendenza. Fa due cose e basta.
 *
 * 1) OFFLINE SHELL
 *    L'HTML di partenza viene servito dalla cache quando la rete manca, cosi'
 *    ROAD SENSE si apre comunque: eventi locali visibili e segnalazione
 *    manuale funzionante.
 *
 * 2) ASSET CON HASH
 *    I file sotto /assets/ hanno nomi univoci per build: cache-first puro.
 *
 * COSA NON FA, DELIBERATAMENTE: NON MEMORIZZA CARTOGRAFIA.
 * Nessuna tile, nessuno stile, nessun glifo, nessuno sprite viene messo in
 * cache. Ogni richiesta verso un'origine diversa dalla propria viene lasciata
 * passare alla rete senza essere intercettata.
 *
 * Perche': memorizzare tile equivale a costruirsi un archivio cartografico
 * offline. La Tile Usage Policy di OpenStreetMap lo vieta espressamente
 * ("Offline use is not permitted"), e anche presso fornitori che lo
 * consentirebbero resta un uso che ROAD SENSE non ha motivo di fare: la mappa
 * serve durante la guida, con la rete attiva. Il browser applica comunque la
 * propria cache HTTP secondo gli header del fornitore, che e' il
 * comportamento corretto e sufficiente.
 *
 * Conseguenza accettata: offline la mappa resta senza sfondo cartografico.
 * E' documentato nel README, non nascosto.
 */

// Sostituita al momento della build con la versione di package.json:
// un solo punto da aggiornare per una release, nessuna divergenza possibile
// fra versione dell'app e nome delle cache.
const VERSION = '__APP_VERSION__';
/**
 * Identificatore della BUILD, non della versione dichiarata.
 *
 * I nomi delle cache derivavano da `VERSION`, ferma a 0.1.0 da sempre: erano
 * quindi identici a ogni pubblicazione, e la pulizia in `activate` - che
 * cancella le cache il cui nome non e' quello corrente - non cancellava mai
 * niente. Ogni deploy lasciava sul telefono i propri asset, per sempre, e in
 * questo progetto significa qualche megabyte alla volta.
 *
 * Con un identificatore che cambia a ogni build le cache vecchie hanno un nome
 * diverso e vengono rimosse davvero.
 */
const BUILD = '__BUILD_ID__';
const SHELL_CACHE = `roadsense-shell-${VERSION}-${BUILD}`;
const ASSET_CACHE = `roadsense-assets-${VERSION}-${BUILD}`;

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
      // Questo cancella anche `roadsense-tiles-v1`, la cache cartografica
      // creata dalla v0.1.0: i dispositivi che l'hanno gia' se la vedono
      // rimuovere al primo aggiornamento.
      await Promise.all(
        keys
          .filter((k) => k.startsWith('roadsense-') && k !== SHELL_CACHE && k !== ASSET_CACHE)
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

  // TUTTO cio' che non e' della nostra origine - cartografia inclusa - non
  // viene nemmeno intercettato: va in rete e non entra in alcuna cache.
  if (url.origin !== self.location.origin) return;

  // Le API non vengono mai cacheate: un evento stradale vecchio e' peggio di
  // nessun evento.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationStrategy(request));
    return;
  }

  // Il modello vocale pesa 47 MB ed e' gia' dichiarato immutabile: la cache
  // HTTP del browser lo conserva da sola. Metterlo ANCHE qui significava
  // tenerne due copie sul telefono, e in un dispositivo che sta finendo lo
  // spazio e' la differenza fra funzionare e no.
  if (url.pathname.startsWith('/assets/model/')) return;

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  event.respondWith(cacheFirst(request, SHELL_CACHE));
});

/**
 * Rete per prima, cache come rete di sicurezza: l'HTML deve restare fresco.
 *
 * SOLO LA SHELL DELL'APPLICAZIONE VIENE CONSERVATA COME `/index.html`.
 *
 * Il controllo sul percorso non e' una precauzione teorica. Questa funzione
 * intercetta OGNI navigazione della nostra origine e ne salvava il contenuto
 * sotto `/index.html`, cioe' sotto la chiave da cui ROAD SENSE riparte quando
 * la rete manca. Con una sola pagina esisteva un solo esito possibile e il
 * difetto non poteva manifestarsi; appena l'origine serve una seconda pagina -
 * la diagnostica `/voice-lab.html` - visitarla sostituirebbe la shell offline,
 * e al primo avvio senza rete ROAD SENSE aprirebbe la pagina di prova al posto
 * dell'applicazione.
 *
 * Le altre pagine non vengono conservate affatto: una diagnostica non ha alcun
 * motivo di funzionare offline, e inventarle un fallback sarebbe peggio che
 * dichiararla non disponibile.
 */
async function navigationStrategy(request) {
  const path = new URL(request.url).pathname;
  const isShell = path === '/' || path === '/index.html';
  try {
    const response = await fetch(request);
    if (isShell) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    const cached = isShell
      ? (await caches.match('/index.html')) || (await caches.match('/'))
      : null;
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
