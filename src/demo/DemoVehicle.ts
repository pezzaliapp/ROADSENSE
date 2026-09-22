/**
 * ROAD SENSE - veicolo ROAD SENSE SIMULATO.
 *
 * Non e' un utente, non e' un dispositivo collegato, non e' una connessione:
 * e' un punto che avanza lungo lo stesso tracciato stradale del veicolo
 * principale. Esiste solo per rendere visibile la catena
 *
 *   un veicolo rileva -> ROAD SENSE condivide -> un altro viene avvisato
 *   -> un ulteriore passaggio conferma
 *
 * NON esiste alcuna rete reale. Va sempre chiamato
 * "VEICOLO ROAD SENSE · SIMULATO": qualunque formula che faccia pensare a
 * persone realmente collegate descriverebbe qualcosa che non c'e'.
 */

import { positionAtDistance, ROUTE_LENGTH_M, wrapDistance } from './route';

export interface DemoVehicleState {
  id: string;
  lat: number;
  lon: number;
  /** Direzione di marcia, gradi 0..359. */
  heading: number;
  speedMps: number;
  /** Etichetta temporanea mostrata accanto al veicolo, es. "BUCA RILEVATA". */
  flash: string | null;
}

export interface DemoVehicleSpec {
  id: string;
  /** Posizione iniziale lungo il tracciato, in metri. */
  startDistanceM: number;
  /**
   * Velocita' costante. Costante di proposito: questi veicoli servono a far
   * capire un concetto, non a simulare il traffico. Velocita' diverse bastano
   * a renderli indipendenti fra loro e dal veicolo principale.
   */
  speedMps: number;
  /**
   * Identificatore anonimo usato negli eventi che genera.
   * E' un valore fittizio ma formalmente valido: il ConfidenceEngine deve
   * poterlo trattare come un segnalatore indipendente qualsiasi.
   */
  reporterId: string;
}

export class DemoVehicle {
  readonly id: string;
  readonly reporterId: string;
  private readonly speedMps: number;
  private distance: number;
  private flash: string | null = null;
  private flashUntil = 0;

  constructor(spec: DemoVehicleSpec) {
    this.id = spec.id;
    this.reporterId = spec.reporterId;
    this.speedMps = spec.speedMps;
    this.distance = wrapDistance(spec.startDistanceM);
  }

  /** Avanza di `dtSec` secondi lungo il tracciato. */
  advance(dtSec: number, now: number = Date.now()): void {
    this.distance = wrapDistance(this.distance + this.speedMps * dtSec);
    if (this.flash !== null && now >= this.flashUntil) this.flash = null;
  }

  /** Distanza percorsa nel giro corrente, in metri. */
  distanceTravelled(): number {
    return this.distance;
  }

  /**
   * true se il veicolo ha attraversato `target` durante l'ultimo passo.
   * `previous` e' la distanza prima dell'avanzamento.
   */
  static crossed(previous: number, current: number, target: number): boolean {
    // Caso normale: il passo contiene il punto.
    if (previous <= target && current >= target) return true;
    // Caso del ricongiungimento a fine anello: la distanza e' ripartita da zero.
    if (current < previous) return previous <= target || current >= target;
    return false;
  }

  /** Mostra un'etichetta accanto al veicolo per un tempo limitato. */
  setFlash(label: string, durationMs: number, now: number = Date.now()): void {
    this.flash = label;
    this.flashUntil = now + durationMs;
  }

  state(): DemoVehicleState {
    const p = positionAtDistance(this.distance);
    return {
      id: this.id,
      lat: p.lat,
      lon: p.lon,
      heading: p.heading,
      speedMps: this.speedMps,
      flash: this.flash,
    };
  }

  /** Lunghezza del tracciato, esposta per comodita' dei test. */
  static get routeLengthM(): number {
    return ROUTE_LENGTH_M;
  }
}
