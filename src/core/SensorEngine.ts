/**
 * ROAD SENSE - SensorEngine.
 *
 * Responsabilita':
 * - acquisire dai provider (astrazione: non sa se e' telefono o demo);
 * - normalizzare e marcare temporalmente i campioni;
 * - filtrare il rumore (finestra scorrevole + RMS di fondo);
 * - gestire la frequenza di campionamento;
 * - mantenere lo stato dei sensori e la posizione corrente.
 *
 * NON decide se c'e' una buca: quello e' compito del DetectionEngine.
 */

import { DETECTION, SENSORS } from '../config/config';
import type {
  GeoSample,
  SensorCapabilities,
  SensorSample,
  SystemStatus,
} from './types';
import type { SensorProvider, SensorProviderError } from './sensors/SensorProvider';

/** Campione arricchito passato al DetectionEngine. */
export interface EngineSample extends SensorSample {
  /** Velocita' corrente (m/s) dal GPS, o null. */
  speedMps: number | null;
  /** Posizione corrente al momento del campione, o null. */
  lat: number | null;
  lon: number | null;
  heading: number | null;
  /** RMS dell'accelerazione verticale sulla finestra precedente all'istante. */
  baselineRms: number;
  /** true se il motore e' avviato da abbastanza tempo da essere affidabile. */
  warm: boolean;
}

export interface SensorEngineHandlers {
  onSample?: (sample: EngineSample) => void;
  onGeo?: (geo: GeoSample) => void;
  onStatus?: (status: SystemStatus['gps'], sensors: SystemStatus['sensors']) => void;
  onError?: (error: SensorProviderError) => void;
}

interface RingEntry {
  ts: number;
  v: number;
}

export class SensorEngine {
  private provider: SensorProvider;
  private handlers: SensorEngineHandlers = {};
  private running = false;
  private startedAt = 0;

  private caps: SensorCapabilities | null = null;
  private lastGeo: GeoSample | null = null;
  private lastGeoAt = 0;

  /** Finestra scorrevole dei campioni verticali, usata per il rumore di fondo. */
  private ring: RingEntry[] = [];
  private sumSq = 0;

  constructor(provider: SensorProvider) {
    this.provider = provider;
  }

  /** Sostituisce il provider (es. passaggio a DEMO MODE). Richiede engine fermo. */
  setProvider(provider: SensorProvider): void {
    if (this.running) this.stop();
    this.provider = provider;
    this.caps = null;
  }

  getProviderId(): string {
    return this.provider.id;
  }

  getCapabilities(): SensorCapabilities | null {
    return this.caps;
  }

  getLastGeo(): GeoSample | null {
    return this.lastGeo;
  }

  isRunning(): boolean {
    return this.running;
  }

  async probe(): Promise<SensorCapabilities> {
    this.caps = await this.provider.probe();
    return this.caps;
  }

  async start(handlers: SensorEngineHandlers): Promise<SensorCapabilities> {
    if (this.running) return this.caps ?? (await this.probe());
    this.handlers = handlers;
    this.ring = [];
    this.sumSq = 0;
    this.startedAt = Date.now();

    this.caps = await this.provider.requestPermissions();

    await this.provider.start({
      onMotion: (s) => this.handleMotion(s),
      onGeo: (g) => this.handleGeo(g),
      onError: (e) => this.handlers.onError?.(e),
    });

    this.running = true;
    this.emitStatus();
    return this.caps;
  }

  stop(): void {
    if (!this.running) return;
    this.provider.stop();
    this.running = false;
    this.ring = [];
    this.sumSq = 0;
    this.lastGeo = null;
    this.handlers = {};
  }

  // -- interni --------------------------------------------------------------

  private handleGeo(geo: GeoSample): void {
    this.lastGeo = geo;
    this.lastGeoAt = Date.now();
    this.handlers.onGeo?.(geo);
    this.emitStatus();
  }

  private handleMotion(sample: SensorSample): void {
    const v = sample.verticalAccel;

    // Il rumore di fondo va misurato PRIMA di inserire il campione corrente,
    // altrimenti l'impulso stesso alzerebbe la propria baseline.
    const baselineRms = this.currentRms();

    if (v !== null && Number.isFinite(v)) {
      this.push(sample.ts, v);
    }

    const geo = this.lastGeo;
    const geoFresh = Date.now() - this.lastGeoAt < 5000;

    const out: EngineSample = {
      ...sample,
      speedMps: geoFresh ? (geo?.speedMps ?? null) : null,
      lat: geo?.lat ?? null,
      lon: geo?.lon ?? null,
      heading: geo?.heading ?? null,
      baselineRms,
      warm: Date.now() - this.startedAt > SENSORS.warmupSec * 1000,
    };
    this.handlers.onSample?.(out);
  }

  /** Inserisce un campione nella finestra e scarta quelli scaduti. */
  private push(ts: number, v: number): void {
    this.ring.push({ ts, v });
    this.sumSq += v * v;
    const cutoff = ts - DETECTION.windowMs;
    while (this.ring.length > 0 && (this.ring[0] as RingEntry).ts < cutoff) {
      const old = this.ring.shift() as RingEntry;
      this.sumSq -= old.v * old.v;
    }
    if (this.sumSq < 0) this.sumSq = 0; // guardia contro derive numeriche
  }

  /** RMS dell'accelerazione verticale sulla finestra corrente. */
  private currentRms(): number {
    if (this.ring.length === 0) return 0;
    return Math.sqrt(this.sumSq / this.ring.length);
  }

  private emitStatus(): void {
    const geo = this.lastGeo;
    let gps: SystemStatus['gps'] = 'off';
    if (geo) {
      gps = geo.accuracyM !== null && geo.accuracyM > SENSORS.weakAccuracyM ? 'weak' : 'ok';
    }

    let sensors: SystemStatus['sensors'] = 'off';
    if (this.caps?.accelerometer && this.caps?.gyroscope) sensors = 'ok';
    else if (this.caps?.accelerometer) sensors = 'partial';

    this.handlers.onStatus?.(gps, sensors);
  }
}
