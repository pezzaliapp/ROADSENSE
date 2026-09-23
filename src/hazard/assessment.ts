/**
 * ROAD SENSE - quattro cose diverse che vanno tenute separate.
 *
 * Confonderle e' il modo piu' rapido per produrre avvisi sbagliati, quindi
 * qui hanno nomi, tipi e origini distinte:
 *
 *   AFFIDABILITA' DELLA SORGENTE  quanto pesa chi lo dice
 *   CONFIDENZA DELL'EVENTO        quanto e' probabile che sia vero
 *   STATO DI CONFERMA             quanti dispositivi DISTINTI lo dicono
 *   PRIORITA' DEL PERICOLO        quanto e' grave SE e' vero
 *
 * La prima versione di questo lavoro aveva un solo numero al posto di tutti e
 * quattro, e il suo valore era stato scelto perche' i conti tornassero. Era
 * sbagliato: un coefficiente tarato su una soglia non e' un modello, e'
 * un'illusione di modello. E' stato rimosso.
 */

import { MERGE_RADIUS_M } from '../config/config';
import { distanceM } from '../core/geo';
import type { EventCluster, EventSource, RoadEvent } from '../core/types';
import { mostDescriptiveEvent, type HazardDetail } from './describe';
import { hazardPriority, PRIORITY_ORDER, type HazardPriority, type HazardType } from './taxonomy';

/**
 * STATO DI CONFERMA.
 *
 * E' un CONTEGGIO, non una probabilita': dice quanti dispositivi distinti
 * hanno segnalato la stessa cosa nello stesso punto. Non pretende di essere
 * una misura di verita', e proprio per questo e' difendibile.
 *
 *   reported      un solo dispositivo. La segnalazione esiste, non e' confermata
 *   corroborated  almeno due dispositivi DISTINTI concordano
 */
export type ConfirmationState = 'reported' | 'corroborated';

/** Dispositivi distinti necessari perche' una segnalazione sia corroborata. */
export const MIN_DISTINCT_REPORTERS = 2;

/**
 * AFFIDABILITA' DELLA SORGENTE.
 *
 * E' un ORDINAMENTO, non una percentuale scientifica, e va letto come tale:
 *
 *   manual  una persona ha premuto un pulsante: intenzionale, non equivocabile
 *   voice   una persona ha parlato: ha visto, ma il riconoscimento puo' sbagliare
 *   auto    un sensore: nessuno ha visto niente, si e' misurato uno scossone
 *
 * ROAD SENSE NON usa questa scala per decidere se allertare. La decisione si
 * basa sullo stato di conferma e sulla priorita', che sono fatti contabili.
 * Assegnare qui un numero e sperare che cada dalla parte giusta di una soglia
 * sarebbe esattamente l'errore che questo modulo esiste per evitare.
 */
export const SOURCE_RELIABILITY_ORDER: readonly EventSource[] = ['manual', 'voice', 'auto'];

/** Posizione nella scala di affidabilita': 0 = la piu' affidabile. */
export function sourceReliabilityRank(source: EventSource): number {
  const i = SOURCE_RELIABILITY_ORDER.indexOf(source);
  return i < 0 ? SOURCE_RELIABILITY_ORDER.length : i;
}

/**
 * Stato di conferma dal numero di segnalatori DISTINTI.
 *
 * Due segnalazioni dello stesso dispositivo non confermano nulla: lo stesso
 * telefono che passa due volte, o la stessa persona che ripete, non sono una
 * seconda testimonianza. Il conteggio dei segnalatori distinti lo garantisce
 * gia' a monte, e un test lo verifica.
 */
export function confirmationFromReporters(distinctReporters: number): ConfirmationState {
  return distinctReporters >= MIN_DISTINCT_REPORTERS ? 'corroborated' : 'reported';
}

export interface HazardAssessment {
  confirmation: ConfirmationState;
  /** Urgenza del pericolo piu' grave della zona. `null` se non classificato. */
  priority: HazardPriority | null;
  /** Descrizione piu' informativa disponibile. */
  detail?: HazardDetail;
  /** Sorgente piu' affidabile fra quelle che compongono la zona. */
  bestSource: EventSource | null;
}

/**
 * Valuta una zona SENZA toccare la confidenza.
 *
 * Deliberatamente fuori dal ConfidenceEngine: quel motore calcola una cosa
 * sola, lo fa bene ed e' collaudato. Qui si leggono fatti che stanno gia'
 * negli eventi, senza modificare alcun numero.
 */
export function assessCluster(
  cluster: EventCluster,
  events: readonly RoadEvent[],
): HazardAssessment {
  const radius = MERGE_RADIUS_M[cluster.type];
  let priority: HazardPriority | null = null;
  let bestSource: EventSource | null = null;

  for (const event of events) {
    if (event.type !== cluster.type) continue;
    if (distanceM(event, cluster) > radius) continue;

    if (event.hazard) {
      const p = hazardPriority(event.hazard as HazardType);
      if (priority === null || PRIORITY_ORDER[p] < PRIORITY_ORDER[priority]) priority = p;
    }
    if (
      bestSource === null ||
      sourceReliabilityRank(event.source) < sourceReliabilityRank(bestSource)
    ) {
      bestSource = event.source;
    }
  }

  const assessment: HazardAssessment = {
    confirmation: confirmationFromReporters(cluster.reporters),
    priority,
    bestSource,
  };
  const detail = mostDescriptiveEvent(events, cluster);
  if (detail) assessment.detail = detail;
  return assessment;
}

/**
 * Vale la pena avvisare di questa zona?
 *
 * Tre strade indipendenti, e nessuna dipende da un coefficiente tarato:
 *
 *  1. la zona ha superato la soglia di confidenza. E' il criterio storico,
 *     quello dei rilevamenti automatici, rimasto identico;
 *  2. almeno due dispositivi distinti concordano. Un fatto contabile;
 *  3. il pericolo e' CRITICO ed e' stato segnalato. Un camion contromano
 *     segnalato da una sola persona resta non confermato, ma aspettare una
 *     seconda conferma prima di dirlo sarebbe indifendibile: qui la gravita'
 *     conta piu' dell'affidabilita', e l'avviso lo dichiara apertamente.
 */
export function admitsAlert(
  cluster: EventCluster,
  assessment: HazardAssessment,
  minConfidence: number,
): boolean {
  if (cluster.confidence >= minConfidence) return true;
  if (assessment.confirmation === 'corroborated') return true;
  return assessment.priority === 'critical';
}
