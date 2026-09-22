/**
 * ROAD SENSE - DEMO / SIMULATION MODE.
 *
 * Permette di provare ROAD SENSE dal Mac, senza guidare e senza sensori.
 * Simula un veicolo che percorre un anello, con anomalie posizionate lungo il
 * percorso e altri "utenti" che hanno gia' segnalato alcuni punti.
 *
 * ISOLAMENTO DEI DATI
 * Gli eventi generati in demo sono marcati `demo: true`, salvati in una chiave
 * di storage separata e rifiutati dalla validazione lato backend. Non possono
 * in alcun modo contaminare i dati reali.
 */

import { destinationPoint, normalizeDeg } from '../geo';
import type { GeoSample, SensorCapabilities, SensorSample } from '../types';
import type { SensorProvider, SensorProviderEvents } from './SensorProvider';

/** Anomalia piazzata lungo il percorso simulato. */
interface ScriptedAnomaly {
  /** Posizione lungo l'anello, 0..1. */
  at: number;
  /** Ampiezza del picco verticale, m/s^2. */
  peak: number;
  /** Durata dell'impulso, ms. */
  durationMs: number;
}

export interface DemoOptions {
  center?: { lat: number; lon: number };
  /** Raggio dell'anello percorso, metri. */
  radiusM?: number;
  /** Velocita' simulata, m/s (default ~50 km/h). */
  speedMps?: number;
  /** Frequenza dei campioni di movimento, Hz. */
  motionHz?: number;
}

const DEFAULT_CENTER = { lat: 45.4642, lon: 9.19 }; // Milano, centro di comodo

/** Anomalie fisse: percorrendo l'anello si incontrano sempre negli stessi punti. */
const ANOMALIES: ScriptedAnomaly[] = [
  { at: 0.12, peak: 6.5, durationMs: 120 }, // buca media
  { at: 0.34, peak: 9.5, durationMs: 160 }, // buca grave
  { at: 0.58, peak: 4.2, durationMs: 90 }, // buca lieve
  { at: 0.81, peak: 7.8, durationMs: 140 }, // buca grave
];

export class DemoSensorProvider implements SensorProvider {
  readonly id = 'demo';
  readonly label = "Modalita' demo";

  private handlers: SensorProviderEvents = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private geoTimer: ReturnType<typeof setInterval> | null = null;

  private center: { lat: number; lon: number };
  private radiusM: number;
  private speedMps: number;
  private motionHz: number;

  /** Posizione lungo l'anello, 0..1. */
  private progress = 0;
  /** Anomalia attualmente in riproduzione. */
  private firing: { until: number; peak: number } | null = null;
  private armed = new Set<number>();

  constructor(options: DemoOptions = {}) {
    this.center = options.center ?? DEFAULT_CENTER;
    this.radiusM = options.radiusM ?? 900;
    this.speedMps = options.speedMps ?? 14;
    this.motionHz = options.motionHz ?? 50;
  }

  async probe(): Promise<SensorCapabilities> {
    return {
      geolocation: true,
      accelerometer: true,
      gyroscope: true,
      orientation: true,
      needsMotionPermission: false,
    };
  }

  async requestPermissions(): Promise<SensorCapabilities> {
    return this.probe();
  }

  async start(handlers: SensorProviderEvents): Promise<void> {
    this.handlers = handlers;
    this.progress = 0;
    this.armed.clear();

    const motionInterval = Math.round(1000 / this.motionHz);
    const circumference = 2 * Math.PI * this.radiusM;

    this.timer = setInterval(() => {
      this.progress = (this.progress + (this.speedMps * (motionInterval / 1000)) / circumference) % 1;
      this.emitMotion();
    }, motionInterval);

    // Il GPS reale aggiorna circa una volta al secondo: la demo fa lo stesso.
    this.geoTimer = setInterval(() => this.emitGeo(), 1000);
    this.emitGeo();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.geoTimer) clearInterval(this.geoTimer);
    this.timer = null;
    this.geoTimer = null;
    this.handlers = {};
    this.firing = null;
  }

  /** Posizione corrente lungo l'anello. */
  position(): { lat: number; lon: number; heading: number } {
    const angle = this.progress * 360;
    const p = destinationPoint(this.center, angle, this.radiusM);
    // Percorrendo un cerchio in senso orario la direzione e' tangente.
    return { lat: p.lat, lon: p.lon, heading: normalizeDeg(angle + 90) };
  }

  /** Inietta manualmente un urto (pulsante "simula buca"). */
  injectImpact(peak = 8, durationMs = 140): void {
    this.firing = { until: Date.now() + durationMs, peak };
  }

  // -- interni --------------------------------------------------------------

  private emitGeo(): void {
    const p = this.position();
    const sample: GeoSample = {
      ts: Date.now(),
      lat: p.lat,
      lon: p.lon,
      accuracyM: 8,
      speedMps: this.speedMps,
      heading: p.heading,
    };
    this.handlers.onGeo?.(sample);
  }

  private emitMotion(): void {
    const now = Date.now();

    // Armamento delle anomalie: scatta quando si attraversa il punto previsto.
    for (let i = 0; i < ANOMALIES.length; i++) {
      const a = ANOMALIES[i] as ScriptedAnomaly;
      const near = Math.abs(this.progress - a.at) < 0.004;
      if (near && !this.armed.has(i)) {
        this.armed.add(i);
        this.firing = { until: now + a.durationMs, peak: a.peak };
      } else if (!near && this.armed.has(i) && Math.abs(this.progress - a.at) > 0.02) {
        this.armed.delete(i); // ri-armabile al giro successivo
      }
    }

    // Rumore di fondo realistico dell'asfalto + eventuale impulso.
    const noise = (Math.random() - 0.5) * 1.2;
    let vertical = noise;
    if (this.firing) {
      if (now < this.firing.until) {
        vertical = this.firing.peak * (0.75 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1);
      } else {
        this.firing = null;
      }
    }

    const sample: SensorSample = {
      ts: now,
      verticalAccel: vertical,
      totalAccel: Math.abs(vertical) + Math.random() * 0.8,
      rotationRate: Math.random() * 12,
    };
    this.handlers.onMotion?.(sample);
  }
}
