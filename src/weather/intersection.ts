/**
 * ROAD SENSE - previsione dell'incontro fra veicolo e cella meteo.
 *
 * IL PRINCIPIO
 * Aspettare che il veicolo entri nella cella significa avvisare troppo tardi.
 * Quello che serve sapere e': il mio percorso incrocera' questo fenomeno, e
 * fra quanto?
 *
 * Non bastano due approcci piu' semplici, ed e' bene dire perche':
 *
 *  - la distanza IN LINEA D'ARIA dal centro della cella e' sbagliata, perche'
 *    la strada non e' diritta: una cella a 800 m in linea d'aria puo' trovarsi
 *    a 3 km di strada, o non essere mai raggiunta;
 *  - anche "distanza stradale / velocita'" e' sbagliata se la cella si muove:
 *    il punto in cui i due si incontrano non e' dove la cella si trova ADESSO.
 *
 * IL METODO
 * Si avanza lungo il percorso a passi regolari. Per ogni punto a distanza `s`
 * davanti al veicolo si calcola quando il veicolo ci arrivera' (t = s / v) e
 * DOVE SARA' LA CELLA IN QUELL'ISTANTE, spostandola secondo la sua deriva.
 * Il primo punto in cui il veicolo si trova dentro la cella e' l'incontro.
 * Il risultato viene poi raffinato per bisezione, per non restituire una
 * distanza a scatti del passo di campionamento.
 *
 * Funzioni pure: nessuno stato, nessuna rete, nessun accesso al browser.
 */

import { WEATHER } from '../config/config';
import { destinationPoint, distanceM } from '../core/geo';
import type { ConePoint, WeatherCell } from './WeatherProvider';

/**
 * Il percorso davanti al veicolo.
 *
 * E' un'interfaccia perche' il motore non deve sapere da dove venga: nella
 * v0.1.0 la fornisce solo la DEMO MODE, che ha un tracciato noto. Nella guida
 * reale ROAD SENSE non conosce il percorso, e infatti non ha sorgenti meteo.
 */
export interface RouteAhead {
  /**
   * Punto del percorso a `aheadM` metri davanti al veicolo.
   * `null` quando si e' oltre l'orizzonte conosciuto.
   */
  pointAt(aheadM: number): { lat: number; lon: number } | null;
}

export interface WeatherDriverState {
  lat: number;
  lon: number;
  heading: number | null;
  speedMps: number | null;
}

export interface CellForecast {
  /** Il veicolo e' gia' dentro la cella in questo momento. */
  inside: boolean;
  /** Distanza LUNGO LA STRADA fino al primo punto di incontro, m. */
  roadDistanceM: number | null;
  /** Tempo previsto perche' il veicolo raggiunga quel punto, s. */
  etaSec: number | null;
}

const NO_INTERSECTION: CellForecast = { inside: false, roadDistanceM: null, etaSec: null };

/**
 * Dove si trova `tSec` lungo il cono, e con che peso fra i due punti vicini.
 *
 * Fuori dagli estremi si usa l'estremo, mai un'estrapolazione: oltre
 * l'orizzonte della sorgente non esiste previsione, e inventarne una
 * significherebbe rimettere in ROAD SENSE proprio il calcolo che si e'
 * deciso di non fare.
 */
function coneSegment(
  cone: readonly ConePoint[],
  tSec: number,
): { a: ConePoint; b: ConePoint; k: number } {
  const first = cone[0] as ConePoint;
  const last = cone[cone.length - 1] as ConePoint;
  const minutes = tSec / 60;
  if (minutes <= first.minutes) return { a: first, b: first, k: 0 };
  if (minutes >= last.minutes) return { a: last, b: last, k: 0 };

  for (let i = 1; i < cone.length; i++) {
    const b = cone[i] as ConePoint;
    if (minutes > b.minutes) continue;
    const a = cone[i - 1] as ConePoint;
    const span = b.minutes - a.minutes;
    return { a, b, k: span > 0 ? (minutes - a.minutes) / span : 0 };
  }
  return { a: last, b: last, k: 0 };
}

/**
 * Posizione del centro della cella al tempo `tSec`.
 *
 * Con il cono della sorgente si LEGGE la traiettoria, non si ricostruisce:
 * la previsione meteorologica appartiene a chi la calcola. La deriva lineare
 * resta solo per la demo, che un cono non ce l'ha.
 */
export function cellCentreAt(cell: WeatherCell, tSec: number): { lat: number; lon: number } {
  if (cell.cone && cell.cone.length > 0) {
    const { a, b, k } = coneSegment(cell.cone, tSec);
    return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k };
  }
  if (cell.driftHeading === null || cell.driftSpeedMps <= 0 || tSec <= 0) {
    return { lat: cell.lat, lon: cell.lon };
  }
  return destinationPoint(cell, cell.driftHeading, cell.driftSpeedMps * tSec);
}

/**
 * Raggio della cella al tempo `tSec`.
 *
 * Nel cono cresce: e' l'incertezza che si allarga, non la cella. Senza cono
 * resta costante, come e' sempre stato.
 */
export function cellRadiusAt(cell: WeatherCell, tSec: number): number {
  if (cell.cone && cell.cone.length > 0) {
    const { a, b, k } = coneSegment(cell.cone, tSec);
    return a.radiusM + (b.radiusM - a.radiusM) * k;
  }
  return cell.radiusM;
}

/** true se il punto si trova dentro la cella al tempo `tSec`. */
function insideAt(cell: WeatherCell, point: { lat: number; lon: number }, tSec: number): boolean {
  return distanceM(point, cellCentreAt(cell, tSec)) <= cellRadiusAt(cell, tSec);
}

/**
 * Cerca il primo incontro fra il percorso davanti al veicolo e la cella.
 *
 * Restituisce `inside: true` se il veicolo e' gia' dentro: in quel caso una
 * distanza "fra X km" non avrebbe senso e non viene calcolata.
 */
export function forecastIntersection(
  cell: WeatherCell,
  driver: WeatherDriverState,
  route: RouteAhead | null,
): CellForecast {
  // Gia' dentro adesso: e' uno stato, non una previsione. Il centro e il
  // raggio si prendono all'istante 0, che con il cono non coincide
  // necessariamente con `lat`/`lon`/`radiusM` dichiarati sulla cella.
  if (distanceM(driver, cellCentreAt(cell, 0)) <= cellRadiusAt(cell, 0)) {
    return { inside: true, roadDistanceM: 0, etaSec: 0 };
  }

  if (!route) return NO_INTERSECTION;

  const speed = driver.speedMps ?? 0;
  // Da fermi non si puo' prevedere quando si arrivera' da nessuna parte.
  if (speed < WEATHER.minSpeedMps) return NO_INTERSECTION;

  const step = WEATHER.searchStepM;
  let previous = 0;

  for (let s = step; s <= WEATHER.maxSearchM; s += step) {
    const t = s / speed;
    if (t > WEATHER.maxEtaSec) break;

    const point = route.pointAt(s);
    if (!point) break; // percorso finito o sconosciuto oltre questo punto

    if (insideAt(cell, point, t)) {
      const exact = refine(cell, route, speed, previous, s);
      return { inside: false, roadDistanceM: exact, etaSec: exact / speed };
    }
    previous = s;
  }

  return NO_INTERSECTION;
}

/**
 * Bisezione fra l'ultimo punto fuori e il primo dentro: restituisce una
 * distanza continua invece di un multiplo del passo di campionamento, che
 * altrimenti farebbe saltare il testo dell'avviso a scatti.
 */
function refine(
  cell: WeatherCell,
  route: RouteAhead,
  speed: number,
  outsideM: number,
  insideM: number,
): number {
  let lo = outsideM;
  let hi = insideM;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const point = route.pointAt(mid);
    if (!point) break;
    if (insideAt(cell, point, mid / speed)) hi = mid;
    else lo = mid;
  }
  return hi;
}
