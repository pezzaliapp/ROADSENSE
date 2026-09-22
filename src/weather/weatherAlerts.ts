/**
 * ROAD SENSE - selezione degli avvisi meteo.
 *
 * Deliberatamente SEPARATO da `core/AlertEngine`: gli avvisi stradali sono il
 * cuore di ROAD SENSE e non vanno toccati per aggiungere una simulazione.
 * Le regole sono anche diverse, e la differenza e' concettuale:
 *
 *   un evento stradale e' un PUNTO FERMO: si annuncia a qualche centinaio di
 *   metri, e basta sapere se e' davanti;
 *
 *   una cella meteo e' un'AREA IN MOVIMENTO: quello che conta e' se il mio
 *   percorso la incrocera', dove e fra quanto. La previsione vera e' in
 *   `intersection.ts`.
 *
 * QUANDO SI RI-ANNUNCIA
 * Un avviso che resta fisso sullo schermo copre la mappa; uno che scade e non
 * torna piu' fa perdere il senso dell'avvicinamento. La cella viene quindi
 * ri-annunciata quando attraversa una soglia di distanza (WEATHER.bandsM) e
 * quando si entra davvero nell'area: cioe' quando la situazione cambia.
 *
 * LA CORRELAZIONE
 * Se dentro l'area esistono gia' segnalazioni ROAD SENSE del tipo che quel
 * fenomeno produce (pioggia intensa -> acqua sulla carreggiata), l'avviso non
 * e' piu' una previsione: e' una previsione CONFERMATA DA CIO' CHE ACCADE
 * SULLA STRADA. E' il punto dell'intera idea, e qui e' un semplice conteggio.
 */

import { WEATHER } from '../config/config';
import { distanceM } from '../core/geo';
import type { EventCluster } from '../core/types';
import {
  forecastIntersection,
  type CellForecast,
  type RouteAhead,
  type WeatherDriverState,
} from './intersection';
import type { WeatherCell } from './WeatherProvider';

export type { WeatherDriverState, RouteAhead } from './intersection';

export interface WeatherAlert {
  cell: WeatherCell;
  /** Previsione dell'incontro: dentro adesso, oppure distanza e tempo. */
  forecast: CellForecast;
  /** Quante segnalazioni stradali indipendenti confermano il fenomeno. */
  correlatedReporters: number;
  /** true quando due sorgenti indipendenti indicano lo stesso pericolo. */
  correlated: boolean;
  /**
   * Tempo effettivamente MOSTRATO, s. Segue la previsione ma con una banda
   * morta, perche' il testo non oscilli attorno all'arrotondamento al minuto.
   */
  displayEtaSec: number | null;
  issuedAt: number;
}

/**
 * Fascia di avvicinamento. Cresce man mano che ci si avvicina; l'avviso torna
 * quando la fascia cambia.
 * 0 = lontano, ultima = gia' dentro l'area.
 */
export function approachBand(forecast: CellForecast): number {
  if (forecast.inside) return WEATHER.bandsM.length + 1;
  if (forecast.roadDistanceM === null) return -1;
  let band = 0;
  for (const threshold of WEATHER.bandsM) {
    if (forecast.roadDistanceM <= threshold) band++;
  }
  return band;
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

export class WeatherAlertEngine {
  /** Ultima fascia annunciata per ogni cella, e quando. */
  private announced = new Map<string, { band: number; at: number }>();
  private lastAnyAlertAt = Number.NEGATIVE_INFINITY;

  reset(): void {
    this.announced.clear();
    this.lastAnyAlertAt = Number.NEGATIVE_INFINITY;
  }

  /**
   * Ricalcola la previsione di una cella gia' annunciata.
   *
   * Serve a due cose: far scendere distanza e tempo mentre ci si avvicina, e
   * far DECADERE l'avviso se l'incontro non e' piu' previsto - per esempio
   * perche' il veicolo ha cambiato strada o la cella si e' allontanata.
   * Restituisce `null` quando l'avviso non ha piu' ragione di esistere.
   */
  refresh(
    alert: WeatherAlert,
    driver: WeatherDriverState,
    route: RouteAhead | null,
    clusters: readonly EventCluster[],
  ): WeatherAlert | null {
    const forecast = forecastIntersection(alert.cell, driver, route);
    if (!forecast.inside && forecast.roadDistanceM === null) return null;
    const reporters = correlatedReporters(alert.cell, clusters);
    return {
      ...alert,
      forecast,
      displayEtaSec: steadyEta(alert.displayEtaSec, forecast.etaSec),
      correlatedReporters: reporters,
      correlated: reporters > 0,
    };
  }

  /**
   * Sceglie l'avviso da mostrare, se ce n'e' uno.
   * Mostra UNA cella alla volta: la demo deve restare leggibile, non
   * diventare un bollettino.
   */
  evaluate(
    cells: readonly WeatherCell[],
    driver: WeatherDriverState,
    route: RouteAhead | null,
    roadClusters: readonly EventCluster[],
    now: number = Date.now(),
  ): WeatherAlert | null {
    if (now - this.lastAnyAlertAt < WEATHER.minGapMs) return null;

    let best: {
      cell: WeatherCell;
      forecast: CellForecast;
      band: number;
      reporters: number;
    } | null = null;

    for (const cell of cells) {
      // Le celle con `announce: false` si vedono sulla mappa ma non avvisano.
      if (!cell.announce) continue;

      const forecast = forecastIntersection(cell, driver, route);
      // Nessun incontro previsto: niente da dire. E' il caso della cella che
      // si allontana, o che passa accanto al percorso senza incrociarlo.
      if (!forecast.inside && forecast.roadDistanceM === null) continue;

      const band = approachBand(forecast);
      const last = this.announced.get(cell.id);
      // Si annuncia solo se la situazione e' cambiata: prima volta, oppure
      // una soglia di avvicinamento superata.
      if (last && band <= last.band) continue;
      if (last && now - last.at < WEATHER.cooldownMs) continue;

      const reporters = correlatedReporters(cell, roadClusters);
      const candidate = { cell, forecast, band, reporters };

      if (!best) {
        best = candidate;
        continue;
      }

      // Un fenomeno gia' CONFERMATO da segnalazioni sulla strada ha la
      // precedenza su una previsione non confermata, anche se piu' lontano:
      // due sorgenti indipendenti che concordano valgono piu' di una sola.
      // A parita' di conferma vince l'incontro piu' imminente.
      const better =
        candidate.reporters > 0 && best.reporters === 0
          ? true
          : candidate.reporters === 0 && best.reporters > 0
            ? false
            : eta(candidate.forecast) < eta(best.forecast);
      if (better) best = candidate;
    }

    if (!best) return null;

    this.announced.set(best.cell.id, { band: best.band, at: now });
    this.lastAnyAlertAt = now;

    return {
      cell: best.cell,
      forecast: best.forecast,
      displayEtaSec: best.forecast.etaSec,
      correlatedReporters: best.reporters,
      correlated: best.reporters > 0,
      issuedAt: now,
    };
  }
}

function eta(forecast: CellForecast): number {
  return forecast.inside ? 0 : (forecast.etaSec ?? Number.POSITIVE_INFINITY);
}

/**
 * Tempo da mostrare: segue la nuova stima solo se si e' spostata in modo
 * apprezzabile. Senza questa banda morta il valore arrotondato al minuto
 * saltava avanti e indietro attorno alla soglia.
 */
export function steadyEta(shown: number | null, next: number | null): number | null {
  if (next === null) return null;
  if (shown === null) return next;
  return Math.abs(next - shown) >= WEATHER.etaDeadbandSec ? next : shown;
}
