/**
 * ROAD SENSE - costruzione delle frasi pronunciate.
 *
 * Brevi e sempre nello stesso ordine: attenzione, cosa, dove, quando. Chi
 * guida deve poterla capire senza riascoltarla.
 */

import type { EventCluster, RoadLane } from '../core/types';
import type { HazardAssessment } from '../hazard/assessment';
import { hazardText, LANE_LABEL } from '../ui/hazardText';
import { formatEta, WEATHER_META } from '../ui/weatherMeta';
import type { WeatherAlert } from '../weather/weatherAlerts';


/** Distanza detta a voce: arrotondata, senza decimali inutili. */
export function spokenDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.max(50, Math.round(meters / 50) * 50)} metri`;
  const km = meters / 1000;
  return km >= 10 ? `${Math.round(km)} chilometri` : `${km.toFixed(1).replace('.', ',')} chilometri`;
}

/**
 * Frase per un pericolo sulla strada.
 * `hazard` e `lane` arrivano dall'evento piu' descrittivo del gruppo, quando
 * c'e': un cluster nato da una segnalazione vocale sa dire molto piu' di uno
 * nato da un accelerometro.
 */
export function roadAlertPhrase(
  cluster: EventCluster,
  distanceM: number,
  assessment?: HazardAssessment | null,
): string {
  const cosa = hazardText(cluster.type, assessment?.detail);
  // Quando nessun altro dispositivo ha confermato, la frase lo dice.
  // Un pericolo grave va annunciato lo stesso, ma chi ascolta deve sapere
  // che si tratta di una segnalazione singola: gravita' e affidabilita' sono
  // due cose diverse e vanno pronunciate come tali.
  if (assessment?.confirmation === 'reported') {
    return `Attenzione. ${cosa} segnalato tra ${spokenDistance(distanceM)}. Segnalazione non ancora confermata.`;
  }
  return `Attenzione. ${cosa} tra ${spokenDistance(distanceM)}.`;
}

/** Frase per un avviso meteo, coerente con i due stati del banner. */
export function weatherAlertPhrase(alert: WeatherAlert): string {
  const meta = WEATHER_META[alert.cell.kind];
  if (alert.forecast.inside) return `Attenzione. ${meta.label} nell'area attuale.`;
  const eta = alert.displayEtaSec !== null ? ` tra ${formatEta(alert.displayEtaSec)}` : '';
  return `Attenzione. ${meta.label} sul percorso${eta}.`;
}

/** Conferma parlata di una segnalazione vocale accolta. */
export function voiceAcceptedPhrase(label: string, lane?: RoadLane): string {
  return `Segnalazione ricevuta. ${label}${lane ? ` ${LANE_LABEL[lane]}` : ''}.`;
}
