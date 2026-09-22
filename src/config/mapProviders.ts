/**
 * ROAD SENSE - astrazione della sorgente cartografica.
 *
 * PERCHE' ESISTE
 * I fornitori di cartografia cambiano condizioni, chiudono, introducono chiavi o
 * bloccano l'accesso. E' gia' successo a ROAD SENSE con i server di
 * OpenStreetMap (vedi nota in fondo). MapView non deve saperne nulla: consuma
 * solo questa interfaccia, quindi cambiare fornitore significa modificare
 * questo file e nient'altro.
 *
 * L'interfaccia copre sia le cartografie VETTORIALI sia quelle RASTER: MapView
 * costruisce lo stile nell'uno o nell'altro modo, quindi anche passare da
 * vettoriale a raster non richiede di toccarlo.
 */

/** Cartografia vettoriale: un file di stile MapLibre descrive sorgenti e resa. */
export interface VectorTileProvider {
  kind: 'vector';
  id: string;
  label: string;
  /** URL dello stile MapLibre (JSON). */
  styleUrl: string;
  /** Testo di attribuzione. OBBLIGATORIO e non rimovibile. */
  attribution: string;
  maxZoom: number;
  /**
   * Domini contattati dal fornitore. Vanno tenuti allineati con la
   * Content-Security-Policy in `public/_headers` e in `index.html`.
   */
  hosts: string[];
  /** Condizioni d'uso, per poterle riverificare in futuro. */
  terms: string;
}

/** Cartografia raster classica: schema XYZ di immagini. */
export interface RasterTileProvider {
  kind: 'raster';
  id: string;
  label: string;
  /** Template XYZ, es. https://esempio/{z}/{x}/{y}.png */
  tileUrl: string;
  attribution: string;
  maxZoom: number;
  /** Lato della tile in pixel (256 classico, 512 per schermi ad alta densita'). */
  tileSize: number;
  hosts: string[];
  terms: string;
}

export type MapTileProvider = VectorTileProvider | RasterTileProvider;

// ---------------------------------------------------------------------------
// Fornitori disponibili
// ---------------------------------------------------------------------------

/**
 * OpenFreeMap - stile "dark".
 *
 * Verificato il 22/09/2026 su https://openfreemap.org:
 * - gratuito, dichiarato senza limiti di richieste o di visualizzazioni;
 * - NESSUNA chiave API, NESSUNA registrazione, NESSUN cookie, NESSUNA carta
 *   di credito;
 * - codice del progetto sotto licenza MIT, dati OpenStreetMap;
 * - esplicitamente destinato a siti e applicazioni;
 * - attribuzione obbligatoria (riportata qui sotto e mostrata in mappa);
 * - risponde con `access-control-allow-origin: *` e senza alcun header di
 *   blocco.
 *
 * Nota sulla sostenibilita': il servizio e' sostenuto da donazioni ricorrenti.
 * E' una ragione in piu' perche' questa astrazione esista.
 *
 * Difetto noto dello stile (non di ROAD SENSE): i layer `place_city`,
 * `place_town` e le aree boschive richiedono le immagini `circle-11` e
 * `wood-pattern`, che non sono presenti nello sprite pubblicato. MapView
 * registra un'immagine trasparente per le immagini mancanti, cosi' lo stile
 * non segnala errori. Nessun effetto sulla leggibilita' della mappa.
 */
export const OPENFREEMAP_DARK: VectorTileProvider = {
  kind: 'vector',
  id: 'openfreemap-dark',
  label: 'OpenFreeMap Dark',
  styleUrl: 'https://tiles.openfreemap.org/styles/dark',
  attribution:
    '<a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · ' +
    '<a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · ' +
    'dati <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  maxZoom: 19,
  hosts: ['https://tiles.openfreemap.org'],
  terms: 'https://openfreemap.org/',
};

/** Variante chiara dello stesso fornitore, alle stesse condizioni. */
export const OPENFREEMAP_POSITRON: VectorTileProvider = {
  ...OPENFREEMAP_DARK,
  id: 'openfreemap-positron',
  label: 'OpenFreeMap Positron',
  styleUrl: 'https://tiles.openfreemap.org/styles/positron',
};

/**
 * Modello per una cartografia RASTER auto-ospitata.
 *
 * NON attivo: e' qui per documentare che l'astrazione copre anche il caso
 * raster e per rendere immediata la migrazione se OpenFreeMap dovesse
 * cambiare condizioni. Per usarlo occorre un proprio server di tile
 * (vedi https://switch2osm.org): in quel caso l'attribuzione ai dati
 * OpenStreetMap resta comunque obbligatoria.
 *
 * ATTENZIONE: NON puntare questo template a
 * https://tile.openstreetmap.org. I server di OpenStreetMap sono gestiti da
 * volontari e la loro Tile Usage Policy vieta l'uso da parte di applicazioni
 * distribuite. Vedi la nota in fondo a questo file.
 */
export const SELF_HOSTED_RASTER_TEMPLATE: RasterTileProvider = {
  kind: 'raster',
  id: 'self-hosted-raster',
  label: 'Raster auto-ospitato (da configurare)',
  tileUrl: 'https://tiles.esempio.invalid/{z}/{x}/{y}.png',
  attribution:
    'dati <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  maxZoom: 19,
  tileSize: 256,
  hosts: ['https://tiles.esempio.invalid'],
  terms: 'https://switch2osm.org/',
};

/** Elenco dei fornitori selezionabili. */
export const MAP_PROVIDERS: Record<string, MapTileProvider> = {
  [OPENFREEMAP_DARK.id]: OPENFREEMAP_DARK,
  [OPENFREEMAP_POSITRON.id]: OPENFREEMAP_POSITRON,
};

/**
 * Fornitore attivo.
 * Sovrascrivibile in fase di build con VITE_MAP_PROVIDER; se il valore non
 * corrisponde a un fornitore noto si ricade su quello predefinito, senza errori.
 */
const requested = (import.meta.env?.VITE_MAP_PROVIDER ?? '').trim();

export const ACTIVE_MAP_PROVIDER: MapTileProvider =
  MAP_PROVIDERS[requested] ?? OPENFREEMAP_DARK;

// ---------------------------------------------------------------------------
// NOTA STORICA - perche' ROAD SENSE non usa tile.openstreetmap.org
// ---------------------------------------------------------------------------
//
// La v0.1.0 usava https://{s}.tile.openstreetmap.org. I server hanno iniziato a
// rispondere con una tile di blocco e l'header
//   x-blocked: Access denied. See https://operations.osmfoundation.org/policies/tiles/
//
// La Tile Usage Policy della OpenStreetMap Foundation chiarisce il perche':
// quei server sono gestiti da volontari, consentono "normal interactive viewing
// by a human" e non l'uso da parte di applicazioni distribuite; richiedono uno
// User-Agent che identifichi l'applicazione (una PWA non puo' impostarlo);
// vietano di impedire l'invio del Referer con una Referrer-Policy restrittiva;
// e vietano l'uso offline, quindi la memorizzazione delle tile in cache.
//
// ROAD SENSE violava tre di questi punti. Il blocco era corretto.
// La soluzione non e' aggirarlo: e' usare una sorgente che consenta
// esplicitamente questo tipo di applicazione. I dati restano OpenStreetMap,
// l'attribuzione resta obbligatoria.
