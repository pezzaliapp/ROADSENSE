/**
 * ROAD SENSE - rete ROAD SENSE SIMULATA (solo DEMO MODE).
 *
 * Fa avanzare due veicoli simulati lungo il tracciato e, quando attraversano
 * un punto prestabilito, genera un normale `RoadEvent` a loro nome.
 *
 * PUNTO IMPORTANTE: l'evento prodotto e' un evento come tutti gli altri, con
 * un proprio identificatore anonimo. Viene messo nello stesso archivio e
 * aggregato dallo stesso `ConfidenceEngine`. La confidenza sale perche' due
 * segnalatori indipendenti concordano, non perche' un numero venga scritto a
 * mano da qualche parte: il comportamento del motore non viene falsificato.
 *
 * NON esiste alcuna rete: nessuna API, nessun backend, nessuna connessione,
 * nessuna richiesta. Tutto avviene in memoria, con un temporizzatore.
 */

import { DEMO } from '../config/config';
import { newEventId } from '../core/anonId';
import { severityFromPeak, singleDetectionConfidence } from '../core/DetectionEngine';
import type { GeoSample, RoadEvent } from '../core/types';
import { parseVoiceReport } from '../voice/parser';
import { buildVoiceEvent } from '../voice/voiceEvent';
import { DemoVehicle, type DemoVehicleState } from './DemoVehicle';
import { positionAtDistance, ROUTE_LENGTH_M } from './route';

export interface DemoTrafficHandlers {
  /** Chiamato a ogni passo con lo stato di tutti i veicoli simulati. */
  onVehicles?: (vehicles: DemoVehicleState[]) => void;
  /** Chiamato quando un veicolo simulato rileva qualcosa. */
  onEvent?: (event: RoadEvent) => void;
}

/** Identificatori anonimi fittizi ma formalmente validi (16 esadecimali). */
function fakeReporterId(seed: number): string {
  return (seed * 0x7f4a7c15).toString(16).padStart(16, '0').slice(-16);
}

export class DemoTrafficProvider {
  private vehicles: DemoVehicle[];
  private timer: ReturnType<typeof setInterval> | null = null;
  private handlers: DemoTrafficHandlers = {};
  /** Punto della buca rilevata dai veicoli simulati, in metri. */
  private readonly potholeAtM: number;
  /** Punto in cui un veicolo simulato segnala a voce, in metri. */
  private readonly voiceAtM: number;
  /** Punto del pericolo critico, segnalato da un solo veicolo. */
  private readonly criticalAtM: number;

  constructor() {
    this.potholeAtM = DEMO.network.potholeAt * ROUTE_LENGTH_M;
    this.voiceAtM = DEMO.network.voiceReport.at * ROUTE_LENGTH_M;
    this.criticalAtM = DEMO.network.criticalReport.at * ROUTE_LENGTH_M;
    this.vehicles = DEMO.network.vehicles.map(
      (spec, i) =>
        new DemoVehicle({
          id: spec.id,
          startDistanceM: spec.startDistanceM,
          speedMps: spec.speedMps,
          reporterId: fakeReporterId(i + 1),
        }),
    );
  }

  /** Stato corrente dei veicoli, senza avviare nulla. */
  states(): DemoVehicleState[] {
    return this.vehicles.map((v) => v.state());
  }

  start(handlers: DemoTrafficHandlers): void {
    if (this.timer) return;
    this.handlers = handlers;
    const dt = DEMO.network.tickMs / 1000;
    this.timer = setInterval(() => this.tick(dt), DEMO.network.tickMs);
    this.handlers.onVehicles?.(this.states());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.handlers = {};
  }

  // -- interni --------------------------------------------------------------

  private tick(dtSec: number): void {
    const now = Date.now();

    for (const [index, vehicle] of this.vehicles.entries()) {
      const before = vehicle.distanceTravelled();
      vehicle.advance(dtSec, now);
      const after = vehicle.distanceTravelled();

      if (DemoVehicle.crossed(before, after, this.potholeAtM)) {
        vehicle.setFlash('BUCA RILEVATA', DEMO.network.flashMs, now);
        this.handlers.onEvent?.(this.buildEvent(vehicle, now));
      }

      // Segnalazione VOCALE di un veicolo simulato. Passa dallo stesso parser
      // usato dal microfono reale: se la frase smettesse di essere capita, la
      // demo se ne accorgerebbe subito.
      if (DemoVehicle.crossed(before, after, this.voiceAtM)) {
        const voiceEvent = this.buildVoiceReport(
          vehicle,
          now,
          DEMO.network.voiceReport.phrase,
          this.voiceAtM,
        );
        if (voiceEvent) {
          vehicle.setFlash('SEGNALAZIONE VOCALE', DEMO.network.flashMs, now);
          this.handlers.onEvent?.(voiceEvent);
        }
      }

      // Pericolo critico: lo segnala UN SOLO veicolo, di proposito. Resta
      // non confermato, e ROAD SENSE avvisa lo stesso dichiarandolo.
      if (
        index === DEMO.network.criticalReport.byVehicle &&
        DemoVehicle.crossed(before, after, this.criticalAtM)
      ) {
        const criticalEvent = this.buildVoiceReport(
          vehicle,
          now,
          DEMO.network.criticalReport.phrase,
          this.criticalAtM,
        );
        if (criticalEvent) {
          vehicle.setFlash('SEGNALAZIONE VOCALE', DEMO.network.flashMs, now);
          this.handlers.onEvent?.(criticalEvent);
        }
      }
    }

    this.handlers.onVehicles?.(this.states());
  }

  /**
   * Segnalazione vocale di un veicolo simulato.
   *
   * La frase attraversa il parser vero e l'evento nasce dalla funzione vera:
   * la demo non scorciatoia nulla, e una singola voce resta NON confermata
   * finche' il secondo veicolo non passa dallo stesso punto.
   */
  private buildVoiceReport(
    vehicle: DemoVehicle,
    now: number,
    phrase: string,
    atM: number,
  ): RoadEvent | null {
    const parsed = parseVoiceReport(phrase);
    if (!parsed.ok) return null;

    const p = positionAtDistance(atM);
    const geo: GeoSample = {
      ts: now,
      lat: p.lat,
      lon: p.lon,
      accuracyM: DEMO.accuracyM,
      speedMps: DEMO.network.detection.speedMps,
      heading: p.heading,
    };
    return buildVoiceEvent(parsed.report, geo, {
      reporterId: vehicle.reporterId,
      demo: true,
      now,
    });
  }

  /**
   * Costruisce l'evento come lo costruirebbe un dispositivo reale: stessa
   * forma, stessa confidenza di un singolo rilevamento automatico, calcolata
   * con la funzione vera del DetectionEngine.
   */
  private buildEvent(vehicle: DemoVehicle, now: number): RoadEvent {
    const p = positionAtDistance(this.potholeAtM);
    const { peak, impulseMs, baselineRms, speedMps } = DEMO.network.detection;
    return {
      id: newEventId(),
      lat: Math.round(p.lat * 1e5) / 1e5,
      lon: Math.round(p.lon * 1e5) / 1e5,
      ts: now,
      type: 'pothole',
      // Severita' e confidenza NON sono scritte a mano: si usano le stesse
      // funzioni del DetectionEngine reale, cosi' il ConfidenceEngine riceve
      // esattamente cio' che riceverebbe da un dispositivo vero.
      severity: severityFromPeak(peak),
      source: 'auto',
      confidence: singleDetectionConfidence(peak, baselineRms, impulseMs),
      heading: p.heading,
      reporterId: vehicle.reporterId,
      sensorData: { peakVerticalAccel: peak, impulseMs, speedMps, baselineRms },
      demo: true,
    };
  }
}
