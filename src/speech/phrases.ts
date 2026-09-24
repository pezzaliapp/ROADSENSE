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
 *
 * `hazard` e `lane` arrivano dall'evento piu' descrittivo del gruppo, quando
 * c'e': un cluster nato da una segnalazione vocale sa dire molto piu' di uno
 * nato da un accelerometro. Non si aggiunge NIENTE che non sia nei dati: una
 * buca rilevata dai sensori resta "buca", senza corsia inventata.
 *
 * "Attenzione" NON apre ogni frase. Se precedesse anche l'avviso piu' banale
 * smetterebbe di significare qualcosa, ed e' proprio sui pericoli gravi che
 * deve far alzare la testa. Lo si dice per i pericoli classificati `critical`
 * o `high` - un contromano, un veicolo in avaria - non per una buca.
 *
 * La classificazione NON viene decisa qui: si legge dalla tassonomia, dove e'
 * gia' scritta. Duplicarla significherebbe avere due verita' che prima o poi
 * divergono.
 */
export function roadAlertPhrase(
  cluster: EventCluster,
  distanceM: number,
  assessment?: HazardAssessment | null,
): string {
  const cosa = hazardText(cluster.type, assessment?.detail);
  const dove = `tra ${spokenDistance(distanceM)}`;
  const grave = assessment?.priority === 'critical' || assessment?.priority === 'high';
  const apertura = grave ? 'Attenzione. ' : '';

  // Quando nessun altro dispositivo ha confermato, la frase lo dice.
  // Un pericolo grave va annunciato lo stesso, ma chi ascolta deve sapere
  // che si tratta di una segnalazione singola: gravita' e affidabilita' sono
  // due cose diverse e vanno pronunciate come tali.
  if (assessment?.confirmation === 'reported') {
    return `${apertura}${cosa} segnalato ${dove}. Segnalazione non ancora confermata.`;
  }
  return `${apertura}${cosa} ${dove}.`;
}

/**
 * Frase per un avviso meteo, coerente con i due stati del banner.
 *
 * Dentro la cella il fenomeno c'e': si dice "Attenzione". Davanti e' una
 * previsione, e una previsione si annuncia come tale - "Possibile" - perche'
 * dichiarare come certo cio' che e' stimato sarebbe inventare un dettaglio
 * che i dati non contengono.
 */
export function weatherAlertPhrase(alert: WeatherAlert): string {
  const meta = WEATHER_META[alert.cell.kind];
  if (alert.forecast.inside) return `Attenzione. ${meta.label} nell'area attuale.`;
  const eta = alert.displayEtaSec !== null ? ` tra circa ${formatEta(alert.displayEtaSec)}` : '';
  return `Possibile ${meta.label.toLowerCase()} sul percorso${eta}.`;
}

/** Conferma parlata di una segnalazione vocale accolta. */
export function voiceAcceptedPhrase(label: string, lane?: RoadLane): string {
  return `Segnalazione ricevuta. ${label}${lane ? ` ${LANE_LABEL[lane]}` : ''}.`;
}
