/**
 * ROAD SENSE - DEMO / SIMULATION MODE.
 *
 * Simula un'automobile che percorre un ITINERARIO STRADALE REALE: il tracciato
 * congelato in `src/demo/demoRoute.ts`, ricavato una sola volta dalla
 * geometria OpenStreetMap e incluso nel progetto. A runtime non serve alcun
 * servizio di routing, alcuna chiave o alcuna rete: la demo e' completamente
 * offline e deterministica.
 *
 * COSA SIMULA
 * - posizione lungo il percorso, interpolata con continuita';
 * - velocita' urbana (20-50 km/h) con variazioni graduali e rallentamento
 *   prima delle curve;
 * - direzione di marcia calcolata dai punti consecutivi del percorso;
 * - rumore di fondo dell'asfalto e impulsi da buca in punti prestabiliti.
 *
 * Al termine del percorso la demo ricomincia dall'inizio senza discontinuita':
 * il tracciato e' un anello chiuso.
 *
 * ISOLAMENTO DEI DATI
 * Gli eventi generati in demo sono marcati `demo: true`, salvati in una chiave
 * di storage separata e rifiutati dalla validazione lato backend.
 *
 * Questo provider NON tocca in alcun modo il GPS reale: `PhoneSensorProvider`
 * e' un'implementazione separata della stessa interfaccia.
 */

import { DEMO } from '../../config/config';
import { positionAtDistance, ROUTE_LENGTH_M, turnAheadDeg, wrapDistance } from '../../demo/route';
import type { GeoSample, SensorCapabilities, SensorSample } from '../types';
import type { SensorProvider, SensorProviderEvents } from './SensorProvider';

export interface DemoOptions {
  /** Distanza di partenza lungo il percorso, in metri. */
  startDistanceM?: number;
  /** Forza una velocita' costante. Usato dai test; di norma non impostato. */
  fixedSpeedMps?: number;
  motionHz?: number;
}

export class DemoSensorProvider implements SensorProvider {
  readonly id = 'demo';
  readonly label = "Modalita' demo";

  private handlers: SensorProviderEvents = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private geoTimer: ReturnType<typeof setInterval> | null = null;

  /** Distanza percorsa lungo il tracciato, in metri. */
  private traveled: number;
  /** Velocita' corrente, m/s. Filtrata per evitare scatti. */
  private speed: number;
  private readonly fixedSpeed: number | null;
  private readonly motionHz: number;

  /** Impulso attualmente in riproduzione. */
  private firing: { until: number; peak: number } | null = null;
  /** Anomalie gia' scattate nel giro corrente. */
  private fired = new Set<number>();
  /** Giro corrente: serve a ri-armare le anomalie a ogni passaggio. */
  private lap = 0;

  constructor(options: DemoOptions = {}) {
    this.traveled = wrapDistance(options.startDistanceM ?? 0);
    this.fixedSpeed = options.fixedSpeedMps ?? null;
    this.motionHz = options.motionHz ?? DEMO.motionHz;
    this.speed = this.fixedSpeed ?? (DEMO.minSpeedMps + DEMO.maxSpeedMps) / 2;
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
    this.fired.clear();
    this.lap = 0;

    const motionInterval = Math.max(1, Math.round(1000 / this.motionHz));
    this.timer = setInterval(() => this.tick(motionInterval / 1000), motionInterval);
    this.geoTimer = setInterval(() => this.emitGeo(), DEMO.geoIntervalMs);
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

  // -- stato osservabile (usato dalla UI e dai test) ------------------------

  /** Posizione e direzione correnti lungo il percorso. */
  position(): { lat: number; lon: number; heading: number } {
    return positionAtDistance(this.traveled);
  }

  /** Distanza percorsa nel giro corrente, in metri. */
  distanceTravelled(): number {
    return this.traveled;
  }

  /** Velocita' corrente, m/s. */
  currentSpeed(): number {
    return this.speed;
  }

  /** Quanti giri completi sono stati percorsi. */
  laps(): number {
    return this.lap;
  }

  /** Inietta manualmente un urto. */
  injectImpact(peak = 8, durationMs = 140): void {
    this.firing = { until: Date.now() + durationMs, peak };
  }

  // -- interni --------------------------------------------------------------

  /**
   * Avanza lungo il percorso di un passo temporale e produce un campione di
   * movimento. `dt` e' in secondi.
   */
  private tick(dt: number): void {
    const target = this.targetSpeed();
    // Filtro passa-basso sulla velocita': i cambi risultano graduali anche
    // quando il rallentamento in curva subentra di colpo.
    // Il coefficiente deriva da una costante di TEMPO, non dal numero di
    // campioni: cambiare `motionHz` non cambia come accelera il veicolo.
    const alpha = 1 - Math.exp(-dt / DEMO.speedTimeConstantS);
    this.speed = this.fixedSpeed ?? this.speed + (target - this.speed) * alpha;

    const before = this.traveled;
    const advanced = before + this.speed * dt;
    if (advanced >= ROUTE_LENGTH_M) {
      // Fine del percorso: si ricomincia e le anomalie tornano disponibili.
      this.lap++;
      this.fired.clear();
    }
    this.traveled = wrapDistance(advanced);

    this.checkAnomalies(before, advanced);
    this.emitMotion();
  }

  /** Velocita' desiderata alla posizione corrente. */
  private targetSpeed(): number {
    if (this.fixedSpeed !== null) return this.fixedSpeed;

    const mid = (DEMO.minSpeedMps + DEMO.maxSpeedMps) / 2;
    const amp = (DEMO.maxSpeedMps - DEMO.minSpeedMps) / 2;
    // Oscillazione legata alla distanza percorsa, non al tempo: resta coerente
    // qualunque sia la frequenza dei campioni.
    const base = mid + amp * Math.sin((2 * Math.PI * this.traveled) / DEMO.speedPeriodM);

    // Piu' la curva in arrivo e' stretta, piu' si rallenta.
    const turn = turnAheadDeg(this.traveled, DEMO.turnLookaheadM);
    const factor = 1 - DEMO.turnSlowdown * Math.min(1, turn / 90);

    return clamp(base * factor, DEMO.minSpeedMps, DEMO.maxSpeedMps);
  }

  /** Fa scattare le anomalie quando il veicolo le attraversa. */
  private checkAnomalies(before: number, after: number): void {
    for (let i = 0; i < DEMO.anomalies.length; i++) {
      if (this.fired.has(i)) continue;
      const a = DEMO.anomalies[i];
      if (!a) continue;
      const at = a.at * ROUTE_LENGTH_M;
      if (before <= at && after >= at) {
        this.fired.add(i);
        this.firing = { until: Date.now() + a.durationMs, peak: a.peak };
      }
    }
  }

  private emitGeo(): void {
    const p = positionAtDistance(this.traveled);
    const sample: GeoSample = {
      ts: Date.now(),
      lat: p.lat,
      lon: p.lon,
      accuracyM: DEMO.accuracyM,
      speedMps: this.speed,
      heading: p.heading,
    };
    this.handlers.onGeo?.(sample);
  }

  private emitMotion(): void {
    const now = Date.now();

    // Rumore di fondo dell'asfalto; sopra vi si sovrappone l'eventuale impulso.
    let vertical = (Math.random() - 0.5) * DEMO.roadNoise;
    if (this.firing) {
      if (now < this.firing.until) {
        // Oscillazione smorzata: la ruota scende e risale.
        vertical =
          this.firing.peak * (0.75 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1);
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

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
