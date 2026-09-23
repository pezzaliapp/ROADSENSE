/**
 * ROAD SENSE - il dettaglio piu' ricco di un gruppo di rilevamenti.
 *
 * Una zona puo' nascere da sorgenti diverse: un accelerometro sa dire solo
 * "fondo anomalo", una voce sa dire "veicolo in avaria in seconda corsia".
 * Quando entrambe descrivono lo stesso punto, l'avviso deve usare la
 * descrizione piu' informativa: e' quella che aiuta chi guida.
 */

import { MERGE_RADIUS_M } from '../config/config';
import { distanceM } from '../core/geo';
import type { EventCluster, RoadEvent, RoadLane } from '../core/types';
import { PRIORITY_ORDER, hazardPriority, type HazardType } from './taxonomy';

export interface HazardDetail {
  hazard?: HazardType;
  lane?: RoadLane;
}

/**
 * Cerca fra gli eventi della zona quello che la descrive meglio: prima la
 * priorita' piu' alta, poi la presenza della corsia, poi il piu' recente.
 */
export function mostDescriptiveEvent(
  events: readonly RoadEvent[],
  cluster: EventCluster,
): HazardDetail | undefined {
  const radius = MERGE_RADIUS_M[cluster.type];
  let best: RoadEvent | null = null;

  for (const event of events) {
    if (event.type !== cluster.type) continue;
    if (!event.hazard) continue;
    if (distanceM(event, cluster) > radius) continue;
    if (!best) {
      best = event;
      continue;
    }
    if (compare(event, best) < 0) best = event;
  }

  if (!best) return undefined;
  const detail: HazardDetail = { hazard: best.hazard };
  if (best.lane) detail.lane = best.lane;
  return detail;
}

function compare(a: RoadEvent, b: RoadEvent): number {
  const pa = PRIORITY_ORDER[hazardPriority(a.hazard as HazardType)];
  const pb = PRIORITY_ORDER[hazardPriority(b.hazard as HazardType)];
  if (pa !== pb) return pa - pb;
  const la = a.lane ? 0 : 1;
  const lb = b.lane ? 0 : 1;
  if (la !== lb) return la - lb;
  return b.ts - a.ts;
}
