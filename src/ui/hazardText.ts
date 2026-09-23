/**
 * ROAD SENSE - come si nomina un pericolo a schermo e a voce.
 *
 * Un solo posto, usato sia dal banner sia dalla sintesi vocale: se le due
 * formulazioni divergessero, chi guida leggerebbe una cosa e ne sentirebbe
 * un'altra.
 */

import type { RoadLane } from '../core/types';
import { HAZARD_META, type HazardType } from '../hazard/taxonomy';
import type { HazardDetail } from '../hazard/describe';
import { EVENT_META } from './eventMeta';
import type { EventType } from '../core/types';

/** Posizione trasversale, detta come la direbbe una persona. */
export const LANE_LABEL: Record<RoadLane, string> = {
  first_lane: 'in prima corsia',
  second_lane: 'in seconda corsia',
  third_lane: 'in terza corsia',
  driving_lane: 'in corsia di marcia',
  central_lane: 'in corsia centrale',
  overtaking_lane: 'in corsia di sorpasso',
  emergency_lane: 'in corsia di emergenza',
  carriageway: 'sulla carreggiata',
  roadside: 'sul bordo strada',
};

/**
 * Nome del pericolo, con la corsia se e solo se e' nota.
 * Senza dettaglio fine si ricade sulla famiglia: e' cio' che accade per i
 * rilevamenti dei sensori, che non sanno dire di piu'.
 */
export function hazardText(family: EventType, detail?: HazardDetail | null): string {
  const name = detail?.hazard
    ? HAZARD_META[detail.hazard as HazardType].label
    : EVENT_META[family].label;
  return detail?.lane ? `${name} ${LANE_LABEL[detail.lane]}` : name;
}
