/**
 * ROAD SENSE - il percorso davanti al veicolo, per la DEMO MODE.
 *
 * E' l'unico punto in cui il motore meteo riceve un percorso. Nella guida
 * reale ROAD SENSE non sa dove stai andando, e infatti non ha sorgenti meteo:
 * questa conoscenza esiste solo perche' nella demo il tracciato e' noto.
 */

import type { RouteAhead } from '../weather/intersection';
import { distanceAlongNearest, positionAtDistance, ROUTE_LENGTH_M } from './route';

/**
 * Oltre questa frazione del tracciato la ricerca si ferma: l'anello si chiude
 * su se' stesso, e proseguire vorrebbe dire "incontrare" una cella che in
 * realta' ci si e' appena lasciati alle spalle.
 */
const MAX_AHEAD_M = ROUTE_LENGTH_M * 0.85;

export interface DemoRouteAhead {
  route: RouteAhead;
  /** Distanza del veicolo dall'inizio del tracciato, in metri. */
  atM: number;
}

/**
 * Costruisce il percorso davanti al veicolo a partire dalla sua posizione.
 *
 * `hintM` e' l'ultima distanza nota: restringe la ricerca del punto piu'
 * vicino a un intorno, evitando che su un anello chiuso una posizione vicina
 * alla partenza venga confusa con la fine.
 */
export function routeAheadFrom(
  position: { lat: number; lon: number },
  hintM?: number,
): DemoRouteAhead {
  const atM = distanceAlongNearest(position, hintM);
  return {
    atM,
    route: {
      pointAt: (aheadM: number) => (aheadM > MAX_AHEAD_M ? null : positionAtDistance(atM + aheadM)),
    },
  };
}
