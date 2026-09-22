/**
 * ROAD SENSE - selezione degli avvisi meteo.
 *
 * Deliberatamente SEPARATO da `core/AlertEngine`: gli avvisi stradali sono il
 * cuore di ROAD SENSE e non vanno toccati per aggiungere una simulazione.
 * Le regole sono anche diverse, e la differenza e' concettuale:
 *
 *   un evento stradale e' un PUNTO, si annuncia a qualche centinaio di metri;
 *   una cella meteo e' un'AREA IN MOVIMENTO, si annuncia a chilometri.
 *
 * LA CORRELAZIONE
 * Se dentro l'area esistono gia' segnalazioni ROAD SENSE del tipo che quel
 * fenomeno produce (pioggia intensa -> acqua sulla carreggiata), l'avviso non
 * e' piu' una previsione: e' una previsione CONFERMATA DA CIO' CHE ACCADE SULLA
 * STRADA. E' il punto dell'intera idea, e qui e' un semplice conteggio.
 */

import { WEATHER } from '../config/config';
import { angleDeltaDeg, bearingDeg, distanceM } from '../core/geo';
import type { EventCluster } from '../core/types';
import type { WeatherCell } from './WeatherProvider';

export interface WeatherDriverState {
  lat: number;
  lon: number;
  heading: number | null;
  speedMps: number | null;
}

export interface WeatherAlert {
  cell: WeatherCell;
  /** Distanza dal bordo dell'area, in metri (mai negativa). */
  distanceM: number;
  /** Quante segnalazioni stradali indipendenti confermano il fenomeno. */
  correlatedReporters: number;
  /** true quando due sorgenti indipendenti indicano lo stesso pericolo. */
  correlated: boolean;
  issuedAt: number;
}

/** Distanza di preavviso, proporzionale alla velocita'. */
export function weatherLookaheadM(speedMps: number | null): number {
  const v = speedMps ?? 0;
  return Math.min(WEATHER.maxLookaheadM, Math.max(WEATHER.minLookaheadM, v * WEATHER.lookaheadSec));
}

/**
 * Distanza dal BORDO dell'area, non dal centro: e' il momento in cui si entra
 * nel fenomeno che conta. Zero se si e' gia' dentro.
 */
export function distanceToCellM(cell: WeatherCell, from: { lat: number; lon: number }): number {
  return Math.max(0, distanceM(from, { lat: cell.lat, lon: cell.lon }) - cell.radiusM);
}

/** Conta i segnalatori stradali indipendenti coerenti con la cella. */
export function correlatedReporters(
  cell: WeatherCell,
  clusters: readonly EventCluster[],
): number {
  if (!cell.correlatesWith) return 0;
  let total = 0;
  for (const c of clusters) {
    if (c.type !== cell.correlatesWith) continue;
    if (distanceM(c, { lat: cell.lat, lon: cell.lon }) > WEATHER.correlationRadiusM) continue;
    total += c.reporters;
  }
  return total;
}

/** Una cella e' rilevante se e' davanti, abbastanza vicina e non alle spalle. */
export function isCellRelevant(
  cell: WeatherCell,
  driver: WeatherDriverState,
): { distanceM: number } | null {
  const dist = distanceToCellM(cell, driver);
  if (dist > weatherLookaheadM(driver.speedMps)) return null;

  // Gia' dentro l'area: l'avviso e' sempre pertinente.
  if (dist === 0) return { distanceM: 0 };

  // Senza direzione di marcia non si sa cosa sia "davanti": non si allerta,
  // per non trasformare la mappa in un bollettino.
  if (driver.heading === null) return null;

  const toCentre = bearingDeg(driver, { lat: cell.lat, lon: cell.lon });
  const centreDist = distanceM(driver, { lat: cell.lat, lon: cell.lon });

  // Una cella e' un'AREA, non un punto: sottende un angolo. Misurare il cono
  // sul solo centro escluderebbe aree grandi e vicine che stanno comunque
  // attraversando la strada davanti al veicolo. Si sottrae quindi la
  // semiampiezza angolare dell'area.
  const halfWidthDeg =
    centreDist > 0
      ? (Math.asin(Math.min(1, cell.radiusM / centreDist)) * 180) / Math.PI
      : 90;
  const offAxis = Math.max(0, angleDeltaDeg(driver.heading, toCentre) - halfWidthDeg);
  if (offAxis > WEATHER.maxBearingDeltaDeg) return null;

  return { distanceM: dist };
}

/**
 * Sceglie l'avviso meteo da mostrare.
 *
 * Mostra UNA cella alla volta, la piu' vicina: la demo deve restare leggibile,
 * non diventare un bollettino.
 */
export class WeatherAlertEngine {
  private lastAlertAt = new Map<string, number>();

  reset(): void {
    this.lastAlertAt.clear();
  }

  evaluate(
    cells: readonly WeatherCell[],
    driver: WeatherDriverState,
    roadClusters: readonly EventCluster[],
    now: number = Date.now(),
  ): WeatherAlert | null {
    let best: { cell: WeatherCell; distanceM: number; reporters: number } | null = null;

    for (const cell of cells) {
      const relevant = isCellRelevant(cell, driver);
      if (!relevant) continue;
      const last = this.lastAlertAt.get(cell.id);
      if (last !== undefined && now - last < WEATHER.cooldownMs) continue;

      const reporters = correlatedReporters(cell, roadClusters);
      const candidate = { cell, distanceM: relevant.distanceM, reporters };
      if (!best) {
        best = candidate;
        continue;
      }

      // Un fenomeno gia' CONFERMATO da segnalazioni sulla strada ha la
      // precedenza su una previsione non confermata, anche se piu' lontano:
      // due sorgenti indipendenti che concordano valgono piu' di una sola.
      // A parita' di conferma vince il piu' vicino.
      const better =
        candidate.reporters > 0 && best.reporters === 0
          ? true
          : candidate.reporters === 0 && best.reporters > 0
            ? false
            : candidate.distanceM < best.distanceM;
      if (better) best = candidate;
    }

    if (!best) return null;
    this.lastAlertAt.set(best.cell.id, now);

    return {
      cell: best.cell,
      distanceM: best.distanceM,
      correlatedReporters: best.reporters,
      correlated: best.reporters > 0,
      issuedAt: now,
    };
  }
}
