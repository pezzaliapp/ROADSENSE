/**
 * ROAD SENSE - AlertEngine.
 *
 * REGOLA: si allerta solo su cio' che e' DAVANTI, VICINO e ATTENDIBILE.
 *
 * Criteri applicati in ordine:
 *  1. confidenza del cluster >= ALERT.minConfidence;
 *  2. distanza <= lookahead, dove lookahead = velocita' * lookaheadSec,
 *     limitato tra minLookaheadM e maxLookaheadM. A 50 km/h l'alert arriva a
 *     ~195 m, a 130 km/h a ~500 m: sempre lo stesso tempo di reazione;
 *  3. l'evento e' nel cono frontale rispetto alla direzione di marcia
 *     (maxBearingDeltaDeg); il cono si allarga sotto nearDistanceM perche' a
 *     pochi metri l'errore angolare del GPS esplode;
 *  4. se il cluster ha una direzione nota, deve essere concorde con la marcia
 *     entro maxHeadingMatchDeg: evita gli alert per l'altra carreggiata;
 *  5. lo stesso cluster non viene ripetuto entro ALERT.cooldownMs, e comunque
 *     mai due volte finche' non ci si e' allontanati.
 *
 * LIMITE DICHIARATO: ROAD SENSE non conosce il grafo stradale. Puo' quindi
 * allertare su un evento che si trova su una strada parallela vicina. Il filtro
 * per cono e direzione riduce il problema ma non lo elimina. Senza routing
 * gratuito e offline non e' risolvibile in modo affidabile: e' documentato
 * invece di essere mascherato con un workaround fragile.
 */

import { ALERT } from '../config/config';
import { angleDeltaDeg, bearingDeg, distanceM } from './geo';
import type { EventCluster } from './types';

export interface AlertCandidate {
  cluster: EventCluster;
  distanceM: number;
}

export interface ActiveAlert {
  clusterId: string;
  cluster: EventCluster;
  distanceM: number;
  issuedAt: number;
}

export interface DriverState {
  lat: number;
  lon: number;
  /** Direzione di marcia in gradi, o null se sconosciuta. */
  heading: number | null;
  /** Velocita' in m/s, o null. */
  speedMps: number | null;
}

/** Distanza di anticipo in metri, proporzionale alla velocita'. */
export function lookaheadMeters(speedMps: number | null): number {
  const v = speedMps ?? 0;
  const raw = v * ALERT.lookaheadSec;
  return Math.min(ALERT.maxLookaheadM, Math.max(ALERT.minLookaheadM, raw));
}

/**
 * Decide se una zona merita di essere annunciata, a prescindere da dove si
 * trovi. Per impostazione predefinita e' la soglia di confidenza storica.
 *
 * E' un parametro perche' la politica non appartiene a questo motore: qui si
 * sa dove sono le cose, non quanto contano. Chi chiama puo' passare una regola
 * piu' ricca - conferma da piu' dispositivi, pericolo critico - senza che
 * AlertEngine debba conoscere la tassonomia dei pericoli.
 */
export type AdmissionPolicy = (cluster: EventCluster) => boolean;

const defaultAdmission: AdmissionPolicy = (cluster) => cluster.confidence >= ALERT.minConfidence;

/**
 * Determina se un cluster e' rilevante per il conducente in questo istante.
 * Funzione pura.
 */
export function isRelevant(
  cluster: EventCluster,
  driver: DriverState,
  admits: AdmissionPolicy = defaultAdmission,
): AlertCandidate | null {
  if (!admits(cluster)) return null;

  const dist = distanceM({ lat: driver.lat, lon: driver.lon }, { lat: cluster.lat, lon: cluster.lon });
  const lookahead = lookaheadMeters(driver.speedMps);
  if (dist > lookahead) return null;

  // Senza direzione di marcia non si puo' sapere cosa sia "davanti":
  // si allerta solo a distanza molto ravvicinata, per non disturbare.
  if (driver.heading === null) {
    return dist <= ALERT.nearDistanceM ? { cluster, distanceM: dist } : null;
  }

  const toEvent = bearingDeg({ lat: driver.lat, lon: driver.lon }, { lat: cluster.lat, lon: cluster.lon });
  const maxDelta = dist <= ALERT.nearDistanceM ? ALERT.nearBearingDeltaDeg : ALERT.maxBearingDeltaDeg;
  if (angleDeltaDeg(driver.heading, toEvent) > maxDelta) return null;

  // Carreggiata: se l'evento ha una direzione nota deve essere concorde.
  if (cluster.heading !== null && angleDeltaDeg(driver.heading, cluster.heading) > ALERT.maxHeadingMatchDeg) {
    return null;
  }

  return { cluster, distanceM: dist };
}

/**
 * Sceglie l'alert da mostrare, applicando il cooldown.
 * Mantiene lo stato minimo necessario (ultimo istante per cluster).
 *
 * IL COOLDOWN APPARTIENE A CHI HA PARLATO, NON A CHI PROPONE
 *
 * `evaluate()` proponeva un alert e nella stessa riga ne consumava il
 * cooldown di due minuti. Ma la voce poteva rifiutarsi di pronunciarlo -
 * `AlertSpeechEngine` impone otto secondi fra due enunciati qualsiasi - e
 * quel rifiuto non lo sapeva nessuno: l'alert veniva mostrato, marcato come
 * gia' annunciato e mai detto. In strada significava questo:
 *
 *   t=0s   "Buca tra 50 metri"      pronunciata
 *   t=1s   "Incidente tra 40 metri" MOSTRATA, rifiutata per gli 8 secondi,
 *                                   e bruciata per 120 secondi
 *   t=2s   "Ostacolo tra 30 metri"  idem
 *   t=8s   la voce sarebbe libera, ma non c'e' piu' niente da dire:
 *          i tre cluster sono tutti in cooldown
 *
 * Il primo avviso parlava, gli altri sparivano. Adesso `evaluate()` si limita
 * a proporre: finche' nessuno conferma, il candidato resta eleggibile e torna
 * al tick successivo. Il cooldown parte da `confirmSpoken()`, cioe' da quando
 * l'avviso e' stato davvero pronunciato.
 */
export class AlertEngine {
  private lastAlertAt = new Map<string, number>();

  reset(): void {
    this.lastAlertAt.clear();
  }

  /** Ritorna il cluster piu' vicino da segnalare, oppure null. */
  evaluate(
    clusters: readonly EventCluster[],
    driver: DriverState,
    now: number = Date.now(),
    admits: AdmissionPolicy = defaultAdmission,
  ): ActiveAlert | null {
    let best: AlertCandidate | null = null;

    for (const cluster of clusters) {
      const candidate = isRelevant(cluster, driver, admits);
      if (!candidate) continue;
      const last = this.lastAlertAt.get(cluster.id);
      if (last !== undefined && now - last < ALERT.cooldownMs) continue;
      if (!best || candidate.distanceM < best.distanceM) best = candidate;
    }

    if (!best) return null;
    // NIENTE `lastAlertAt` qui: proporre non e' annunciare. Vedi
    // `confirmSpoken`, che e' l'unico punto in cui il cooldown comincia.
    return {
      clusterId: best.cluster.id,
      cluster: best.cluster,
      distanceM: best.distanceM,
      issuedAt: now,
    };
  }

  /**
   * L'avviso e' stato PRONUNCIATO: da adesso parte il cooldown.
   *
   * Va chiamata solo quando la voce ha parlato davvero. Un alert proposto e
   * non pronunciato non deve consumare nulla, altrimenti lo si perde: e' il
   * difetto che questa coppia di metodi elimina.
   */
  confirmSpoken(clusterId: string, now: number = Date.now()): void {
    this.lastAlertAt.set(clusterId, now);
  }

  /** Dimentica i cluster non piu' esistenti, per non far crescere la mappa. */
  prune(validIds: ReadonlySet<string>): void {
    for (const id of this.lastAlertAt.keys()) {
      if (!validIds.has(id)) this.lastAlertAt.delete(id);
    }
  }
}
