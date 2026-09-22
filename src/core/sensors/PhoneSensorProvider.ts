/**
 * ROAD SENSE - provider basato sui sensori dello smartphone.
 *
 * COMPENSAZIONE DELL'ORIENTAMENTO (senza calibrazione manuale)
 * Il telefono puo' stare in verticale, orizzontale o inclinato. Invece di
 * chiedere all'utente una procedura di calibrazione, si stima il vettore
 * gravita' con un filtro passa-basso su `accelerationIncludingGravity`:
 *
 *   g_t = alpha * g_(t-1) + (1 - alpha) * a_t
 *
 * La gravita' e' l'unica componente costante: dopo pochi secondi `g` punta
 * verso il basso reale qualunque sia l'inclinazione. L'accelerazione verticale
 * e' allora la proiezione dell'accelerazione lineare sul versore di g:
 *
 *   a_vert = (a_lineare . g) / |g|
 *
 * Se il telefono viene riposizionato durante il viaggio il filtro si riadatta
 * automaticamente in qualche secondo, durante i quali la detection e' meno
 * affidabile: per questo esiste un periodo di warmup.
 *
 * LIMITI NOTI
 * - iOS richiede DeviceMotionEvent.requestPermission() da un gesto utente
 *   e HTTPS. Senza permesso restano disponibili solo GPS e segnalazione manuale.
 * - `coords.heading` e' spesso null su iOS: si ricade sul bearing calcolato
 *   tra posizioni successive.
 * - Nessun browser garantisce l'esecuzione a schermo spento o in background.
 */

import { SENSORS } from '../../config/config';
import { bearingDeg } from '../geo';
import type { GeoSample, SensorCapabilities } from '../types';
import type { SensorProvider, SensorProviderEvents } from './SensorProvider';

interface MotionPermissionApi {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

function motionPermissionApi(): MotionPermissionApi | null {
  if (typeof DeviceMotionEvent === 'undefined') return null;
  return DeviceMotionEvent as unknown as MotionPermissionApi;
}

export class PhoneSensorProvider implements SensorProvider {
  readonly id = 'phone';
  readonly label = 'Sensori telefono';

  private handlers: SensorProviderEvents = {};
  private watchId: number | null = null;
  private motionBound: ((e: DeviceMotionEvent) => void) | null = null;

  /** Stima corrente del vettore gravita' (m/s^2). */
  private gravity: { x: number; y: number; z: number } | null = null;
  private lastMotionTs = 0;
  private readonly minMotionIntervalMs = 1000 / SENSORS.motionHz;

  /** Ultima posizione utile per ricavare il heading quando il GPS non lo fornisce. */
  private lastGeo: { lat: number; lon: number; ts: number } | null = null;
  private lastComputedHeading: number | null = null;

  private caps: SensorCapabilities = {
    geolocation: false,
    accelerometer: false,
    gyroscope: false,
    orientation: false,
    needsMotionPermission: false,
  };

  async probe(): Promise<SensorCapabilities> {
    const hasGeo = typeof navigator !== 'undefined' && 'geolocation' in navigator;
    const hasMotion = typeof DeviceMotionEvent !== 'undefined';
    const api = motionPermissionApi();
    this.caps = {
      geolocation: hasGeo,
      // La presenza effettiva dell'accelerometro si conferma solo al primo evento.
      accelerometer: hasMotion,
      gyroscope: hasMotion,
      orientation: typeof DeviceOrientationEvent !== 'undefined',
      needsMotionPermission: typeof api?.requestPermission === 'function',
    };
    return this.caps;
  }

  async requestPermissions(): Promise<SensorCapabilities> {
    await this.probe();
    const api = motionPermissionApi();
    if (typeof api?.requestPermission === 'function') {
      try {
        const result = await api.requestPermission();
        const granted = result === 'granted';
        this.caps = { ...this.caps, accelerometer: granted, gyroscope: granted };
        if (!granted) {
          this.handlers.onError?.({
            kind: 'permission',
            message: 'Accesso ai sensori di movimento negato: resta attiva la segnalazione manuale.',
          });
        }
      } catch {
        this.caps = { ...this.caps, accelerometer: false, gyroscope: false };
      }
    }
    return this.caps;
  }

  async start(handlers: SensorProviderEvents): Promise<void> {
    this.handlers = handlers;
    this.gravity = null;
    this.lastGeo = null;
    this.lastComputedHeading = null;

    if (this.caps.accelerometer && typeof window !== 'undefined') {
      this.motionBound = (e: DeviceMotionEvent) => this.handleMotion(e);
      window.addEventListener('devicemotion', this.motionBound);
    }

    if (this.caps.geolocation) {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this.handlePosition(pos),
        (err) => {
          this.handlers.onError?.({
            kind: 'geolocation',
            message:
              err.code === err.PERMISSION_DENIED
                ? 'Accesso alla posizione negato.'
                : 'Posizione non disponibile.',
          });
        },
        { ...SENSORS.geo },
      );
    } else {
      this.handlers.onError?.({
        kind: 'unsupported',
        message: 'Geolocalizzazione non disponibile su questo browser.',
      });
    }
  }

  stop(): void {
    // Rilasciare GPS e accelerometro e' la singola scelta piu' importante
    // per il consumo di batteria: a monitoraggio fermo non resta nulla attivo.
    if (this.motionBound && typeof window !== 'undefined') {
      window.removeEventListener('devicemotion', this.motionBound);
      this.motionBound = null;
    }
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.handlers = {};
    this.gravity = null;
  }

  // -- interni --------------------------------------------------------------

  private handleMotion(e: DeviceMotionEvent): void {
    const now = Date.now();
    // Downsampling: si elabora al massimo a SENSORS.motionHz.
    if (now - this.lastMotionTs < this.minMotionIntervalMs) return;
    this.lastMotionTs = now;

    const withG = e.accelerationIncludingGravity;
    const linear = e.acceleration;
    const rot = e.rotationRate;

    const rotationRate =
      rot && (rot.alpha !== null || rot.beta !== null || rot.gamma !== null)
        ? Math.hypot(rot.alpha ?? 0, rot.beta ?? 0, rot.gamma ?? 0)
        : null;

    const sample = computeMotionSample(now, withG, linear, this.gravity, SENSORS.gravityAlpha);
    this.gravity = sample.gravity;
    this.handlers.onMotion?.({
      ts: now,
      verticalAccel: sample.verticalAccel,
      totalAccel: sample.totalAccel,
      rotationRate,
    });
  }

  private handlePosition(pos: GeolocationPosition): void {
    const { latitude, longitude, accuracy, speed, heading } = pos.coords;
    const ts = pos.timestamp || Date.now();

    let usableHeading: number | null = null;
    const speedMps = typeof speed === 'number' && Number.isFinite(speed) ? speed : null;

    // Il heading del GPS e' attendibile solo in movimento.
    if (typeof heading === 'number' && Number.isFinite(heading) && (speedMps ?? 0) > 1.5) {
      usableHeading = heading;
    } else if (this.lastGeo) {
      // Fallback: bearing tra due posizioni sufficientemente distanti.
      const moved = Math.hypot(latitude - this.lastGeo.lat, longitude - this.lastGeo.lon);
      if (moved > 0.00008) {
        this.lastComputedHeading = bearingDeg(
          { lat: this.lastGeo.lat, lon: this.lastGeo.lon },
          { lat: latitude, lon: longitude },
        );
      }
      usableHeading = this.lastComputedHeading;
    }

    this.lastGeo = { lat: latitude, lon: longitude, ts };

    const sample: GeoSample = {
      ts,
      lat: latitude,
      lon: longitude,
      accuracyM: Number.isFinite(accuracy) ? accuracy : null,
      speedMps,
      heading: usableHeading,
    };
    this.handlers.onGeo?.(sample);
  }
}

/**
 * Calcolo puro della componente verticale, estratto per essere testabile
 * senza browser. Ritorna anche la nuova stima di gravita'.
 */
export function computeMotionSample(
  _ts: number,
  withGravity: DeviceMotionEventAcceleration | null,
  linear: DeviceMotionEventAcceleration | null,
  prevGravity: { x: number; y: number; z: number } | null,
  alpha: number,
): {
  gravity: { x: number; y: number; z: number } | null;
  verticalAccel: number | null;
  totalAccel: number | null;
} {
  if (!withGravity || withGravity.x === null || withGravity.y === null || withGravity.z === null) {
    // Senza accelerazione comprensiva di gravita' non si puo' compensare
    // l'orientamento: si restituisce al piu' il modulo lineare.
    const total =
      linear && linear.x !== null && linear.y !== null && linear.z !== null
        ? Math.hypot(linear.x, linear.y, linear.z)
        : null;
    return { gravity: prevGravity, verticalAccel: null, totalAccel: total };
  }

  const gx = prevGravity ? alpha * prevGravity.x + (1 - alpha) * withGravity.x : withGravity.x;
  const gy = prevGravity ? alpha * prevGravity.y + (1 - alpha) * withGravity.y : withGravity.y;
  const gz = prevGravity ? alpha * prevGravity.z + (1 - alpha) * withGravity.z : withGravity.z;
  const gravity = { x: gx, y: gy, z: gz };
  const gMag = Math.hypot(gx, gy, gz);

  // Se `acceleration` (gia' priva di gravita') non c'e' - accade su vari
  // Android - la si ricava sottraendo la gravita' stimata.
  const ax = linear?.x ?? withGravity.x - gx;
  const ay = linear?.y ?? withGravity.y - gy;
  const az = linear?.z ?? withGravity.z - gz;

  const totalAccel = Math.hypot(ax, ay, az);
  const verticalAccel = gMag > 0.5 ? (ax * gx + ay * gy + az * gz) / gMag : null;

  return { gravity, verticalAccel, totalAccel };
}
