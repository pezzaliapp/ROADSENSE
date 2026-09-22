/**
 * ROAD SENSE - utilita' sul percorso della DEMO MODE.
 *
 * Funzioni pure sul tracciato congelato in `demoRoute.ts`: servono sia al
 * provider simulato sia al posizionamento degli eventi demo, cosi' entrambi
 * lavorano esattamente sulla stessa geometria.
 *
 * Nulla di tutto questo tocca il GPS reale.
 */

import { bearingDeg, destinationPoint, distanceM, normalizeDeg } from '../core/geo';
import { DEMO_ROUTE, type RoutePoint } from './demoRoute';

export interface RoutePosition {
  lat: number;
  lon: number;
  /** Direzione del segmento percorso, gradi 0..359. */
  heading: number;
}

/** Distanza progressiva di ogni vertice dall'inizio del percorso, in metri. */
const cumulative: number[] = (() => {
  const out = [0];
  for (let i = 0; i + 1 < DEMO_ROUTE.length; i++) {
    const a = point(i);
    const b = point(i + 1);
    out.push((out[i] as number) + distanceM(a, b));
  }
  return out;
})();

/** Lunghezza complessiva del percorso, in metri. */
export const ROUTE_LENGTH_M: number = cumulative[cumulative.length - 1] ?? 0;

function point(index: number): { lat: number; lon: number } {
  const p = DEMO_ROUTE[index] as RoutePoint;
  return { lat: p[0], lon: p[1] };
}

/** Riporta una distanza nell'intervallo [0, lunghezza): il percorso e' un anello. */
export function wrapDistance(distance: number): number {
  if (ROUTE_LENGTH_M <= 0) return 0;
  const d = distance % ROUTE_LENGTH_M;
  return d < 0 ? d + ROUTE_LENGTH_M : d;
}

/** Indice del segmento che contiene la distanza indicata. */
function segmentIndex(distance: number): number {
  // Ricerca binaria: il percorso ha un centinaio di vertici, ma la funzione
  // viene chiamata 50 volte al secondo.
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if ((cumulative[mid] as number) <= distance) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Posizione e direzione a una data distanza dall'inizio del percorso.
 * La distanza viene riportata automaticamente nell'anello, quindi al termine
 * il percorso ricomincia senza discontinuita'.
 */
export function positionAtDistance(distance: number): RoutePosition {
  const d = wrapDistance(distance);
  const i = segmentIndex(d);
  const a = point(i);
  const b = point(Math.min(i + 1, DEMO_ROUTE.length - 1));
  const segStart = cumulative[i] as number;
  const segLen = (cumulative[i + 1] as number) - segStart;
  const heading = bearingDeg(a, b);

  if (segLen <= 0) return { lat: a.lat, lon: a.lon, heading };

  const along = d - segStart;
  const p = destinationPoint(a, heading, along);
  return { lat: p.lat, lon: p.lon, heading };
}

/**
 * Ampiezza della curva che si incontra entro `lookaheadM` metri, in gradi.
 * Serve a far rallentare il veicolo simulato prima di una svolta, invece di
 * farlo girare a velocita' costante.
 */
export function turnAheadDeg(distance: number, lookaheadM: number): number {
  const now = positionAtDistance(distance);
  const ahead = positionAtDistance(distance + lookaheadM);
  const delta = Math.abs(normalizeDeg(ahead.heading - now.heading));
  return delta > 180 ? 360 - delta : delta;
}

/**
 * Distanza minima di un punto qualsiasi dal percorso, in metri.
 *
 * Calcolata come distanza punto-segmento su ogni tratto, non campionando la
 * polilinea: un campionamento introdurrebbe un errore dell'ordine del passo,
 * che a queste tolleranze (pochi metri) non sarebbe trascurabile.
 *
 * Alle distanze in gioco la proiezione locale piana e' piu' che adeguata.
 */
export function distanceFromRoute(target: { lat: number; lon: number }): number {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((target.lat * Math.PI) / 180);
  const tx = target.lon * mPerDegLon;
  const ty = target.lat * mPerDegLat;

  let best = Infinity;
  for (let i = 0; i + 1 < DEMO_ROUTE.length; i++) {
    const a = point(i);
    const b = point(i + 1);
    const ax = a.lon * mPerDegLon;
    const ay = a.lat * mPerDegLat;
    const bx = b.lon * mPerDegLon;
    const by = b.lat * mPerDegLat;

    const dx = bx - ax;
    const dy = by - ay;
    let px = ax;
    let py = ay;
    if (dx !== 0 || dy !== 0) {
      const t = ((tx - ax) * dx + (ty - ay) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        px = bx;
        py = by;
      } else if (t > 0) {
        px = ax + dx * t;
        py = ay + dy * t;
      }
    }
    const d = Math.hypot(tx - px, ty - py);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Distanza lungo il percorso del punto piu' vicino a `target`.
 * `hintM` limita la ricerca a un intorno: senza di esso, su un anello chiuso,
 * un punto vicino alla partenza risulterebbe ambiguo fra l'inizio e la fine.
 */
export function distanceAlongNearest(
  target: { lat: number; lon: number },
  hintM?: number,
): number {
  const from = hintM === undefined ? 0 : hintM - 30;
  const span = hintM === undefined ? ROUTE_LENGTH_M : 260;
  let best = 0;
  let bestDist = Infinity;
  for (let step = 0; step < span; step += 2) {
    const d = from + step;
    const dist = distanceM(positionAtDistance(d), target);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}
