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

  /**
   * Un campione di movimento UTILIZZABILE e' davvero arrivato.
   * E' diverso da "l'API esiste": su desktop, e su telefoni privi di
   * accelerometro, `DeviceMotionEvent` e' definito ma l'evento non arriva mai.
   */
  private motionSeen = false;
  /** Idem per il giroscopio: `rotationRate` valorizzato almeno una volta. */
  private rotationSeen = false;
  /** Scaduto il quale, senza dati, i sensori si dichiarano assenti. */
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private graceElapsed = false;
  /** L'accesso alla posizione e' stato negato dall'utente. */
  private geoDenied = false;

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
      onError: (e) => {
        // Lo stato della posizione vive qui, non nel chiamante: cosi' non
        // puo' essere sovrascritto da un aggiornamento successivo.
        if (e.kind === 'geolocation' && e.denied) {
          this.geoDenied = true;
          this.emitStatus();
        }
        this.handlers.onError?.(e);
      },
    });

    this.running = true;
    // Finestra di cortesia: entro questo tempo deve arrivare un campione
    // reale, altrimenti l'indicatore dice che i sensori non ci sono.
    this.geoDenied = false;
    this.graceElapsed = false;
    this.graceTimer = setTimeout(() => {
      this.graceElapsed = true;
      this.emitStatus();
    }, SENSORS.motionGraceMs);

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
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.graceElapsed = false;
    this.geoDenied = false;
    this.motionSeen = false;
    this.rotationSeen = false;
    this.handlers = {};
  }

  /** true se sono arrivati campioni di movimento realmente utilizzabili. */
  hasMotionData(): boolean {
    return this.motionSeen;
  }

  // -- interni --------------------------------------------------------------

  private handleGeo(geo: GeoSample): void {
    this.lastGeo = geo;
    this.lastGeoAt = Date.now();
    this.handlers.onGeo?.(geo);
    this.emitStatus();
  }

  private handleMotion(sample: SensorSample): void {
    // Lo stato viene ricalcolato solo sulle TRANSIZIONI, mai a ogni campione:
    // a 50 Hz aggiornare la interfaccia ogni volta sarebbe uno spreco.
    const usable =
      (sample.verticalAccel !== null && Number.isFinite(sample.verticalAccel)) ||
      (sample.totalAccel !== null && Number.isFinite(sample.totalAccel));
    if (usable && !this.motionSeen) {
      this.motionSeen = true;
      this.emitStatus();
    }
    if (!this.rotationSeen && sample.rotationRate !== null && Number.isFinite(sample.rotationRate)) {
      this.rotationSeen = true;
      this.emitStatus();
    }

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

  /**
   * Stato dei sensori di movimento, basato su cio' che ARRIVA DAVVERO e non
   * sull'esistenza dell'API.
   *
   *   off     nessun permesso, oppure nessun dato entro la finestra di attesa
   *   partial dati in arrivo ma senza giroscopio, oppure attesa in corso
   *   ok      accelerometro e giroscopio entrambi attivi
   */
  private sensorStatus(): SystemStatus['sensors'] {
    if (!this.caps?.accelerometer) return 'off';
    if (!this.motionSeen) return this.graceElapsed ? 'off' : 'partial';
    return this.rotationSeen ? 'ok' : 'partial';
  }

  /** RMS dell'accelerazione verticale sulla finestra corrente. */
  private currentRms(): number {
    if (this.ring.length === 0) return 0;
    return Math.sqrt(this.sumSq / this.ring.length);
  }

  private emitStatus(): void {
    const geo = this.lastGeo;
    let gps: SystemStatus['gps'] = this.geoDenied ? 'denied' : 'off';
    if (geo) {
      gps = geo.accuracyM !== null && geo.accuracyM > SENSORS.weakAccuracyM ? 'weak' : 'ok';
    }

    this.handlers.onStatus?.(gps, this.sensorStatus());
  }
}
