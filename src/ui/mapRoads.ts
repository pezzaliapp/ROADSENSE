/**
 * ROAD SENSE - la geometria stradale che la mappa ha gia' in memoria.
 *
 * PERCHE' DA QUI
 * ROAD SENSE non ha un grafo stradale. L'unica geometria disponibile durante
 * la guida e' quella dei tile vettoriali che MapLibre ha gia' scaricato per
 * DISEGNARE la mappa. Si legge quella, e nient'altro.
 *
 * DUE LIMITI, DICHIARATI INVECE CHE AGGIRATI
 * - Nessuna richiesta aggiuntiva: si interroga la cache, non la rete. Oltre il
 *   viewport la geometria non esiste, e il corridoio si accorcia di
 *   conseguenza (vedi CORRIDOR.roadMaxLengthM).
 * - A zoom basso il livello stradale e' semplificato o assente. In quel caso
 *   qui non arriva nulla e il corridoio ripiega sull'heading, dichiarandolo.
 *
 * Questo file e' l'UNICO punto in cui ROAD SENSE guarda dentro la mappa. Il
 * modulo che costruisce il corridoio riceve le polilinee gia' pronte e non sa
 * che MapLibre esista.
 */

import type { Map as MapLibreMap } from 'maplibre-gl';

import { distanceM } from '../core/geo';
import type { LatLon, RoadPolyline } from '../core/forwardCorridor';

/** Livello OpenMapTiles che contiene le strade. */
const LIVELLO_STRADE = 'transportation';

/**
 * Tipi di strada su cui un veicolo puo' realmente trovarsi.
 * Esclude sentieri, piste ciclabili, scale e ferrovie: agganciarvi il
 * corridoio produrrebbe una pertinenza stradale falsa.
 */
const CLASSI_VEICOLARI = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
  'unclassified',
  'residential',
]);

/** Interroga la geometria gia' caricata. Ritorna `[]` se non c'e' nulla. */
export type RoadQuery = (around: LatLon, radiusM: number) => RoadPolyline[];

/** Sorgenti vettoriali che espongono il livello stradale, secondo lo stile. */
function sorgentiStradali(map: MapLibreMap): string[] {
  try {
    const layers = map.getStyle()?.layers ?? [];
    const ids = new Set<string>();
    for (const l of layers) {
      const sourceLayer = (l as { 'source-layer'?: string })['source-layer'];
      const source = (l as { source?: string }).source;
      if (sourceLayer === LIVELLO_STRADE && typeof source === 'string') ids.add(source);
    }
    return [...ids];
  } catch {
    return [];
  }
}

function coordinate(geometry: unknown): LatLon[][] {
  if (typeof geometry !== 'object' || geometry === null) return [];
  const g = geometry as { type?: string; coordinates?: unknown };
  const toLine = (raw: unknown): LatLon[] => {
    if (!Array.isArray(raw)) return [];
    const out: LatLon[] = [];
    for (const c of raw) {
      if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
      out.push({ lat: c[1], lon: c[0] });
    }
    return out;
  };
  if (g.type === 'LineString') return [toLine(g.coordinates)];
  if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
    return g.coordinates.map(toLine);
  }
  return [];
}

/**
 * Costruisce la funzione di interrogazione per una mappa gia' pronta.
 *
 * Non solleva mai: una mappa in caricamento, uno stile diverso o un livello
 * assente producono `[]`, e il corridoio ripiega sull'heading.
 */
export function roadQueryFor(map: MapLibreMap): RoadQuery {
  return (around, radiusM) => {
    const fuori: RoadPolyline[] = [];
    try {
      for (const source of sorgentiStradali(map)) {
        const features = map.querySourceFeatures(source, { sourceLayer: LIVELLO_STRADE });
        for (const f of features) {
          const classe = (f.properties as { class?: unknown } | undefined)?.class;
          if (typeof classe === 'string' && !CLASSI_VEICOLARI.has(classe)) continue;

          for (const linea of coordinate(f.geometry)) {
            if (linea.length < 2) continue;
            // Solo cio' che passa davvero vicino: il resto e' peso inutile.
            const vicino = linea.some((p) => distanceM(around, p) <= radiusM);
            if (vicino) fuori.push({ points: linea });
          }
        }
      }
    } catch {
      // Sorgente non pronta o stile senza strade: nessuna geometria.
      return [];
    }
    return fuori;
  };
}
