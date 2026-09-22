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
import type { RoadEvent } from '../core/types';
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

  constructor() {
    this.potholeAtM = DEMO.network.potholeAt * ROUTE_LENGTH_M;
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

    for (const vehicle of this.vehicles) {
      const before = vehicle.distanceTravelled();
      vehicle.advance(dtSec, now);
      const after = vehicle.distanceTravelled();

      if (DemoVehicle.crossed(before, after, this.potholeAtM)) {
        vehicle.setFlash('BUCA RILEVATA', DEMO.network.flashMs, now);
        this.handlers.onEvent?.(this.buildEvent(vehicle, now));
      }
    }

    this.handlers.onVehicles?.(this.states());
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
