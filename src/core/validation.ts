/**
 * ROAD SENSE - validazione degli eventi.
 *
 * Questo modulo e' condiviso tra frontend e Cloudflare Worker:
 * non deve importare nulla che dipenda dal browser o dalla configurazione UI.
 * Regola: NON fidarsi mai dei dati inviati dal client.
 */

import { EVENT_TYPES, type EventType, type RoadEvent, type Severity } from './types';

/** Limiti difensivi applicati anche lato server. */
export const LIMITS = {
  /** Dimensione massima del payload accettato, byte. */
  maxPayloadBytes: 4096,
  /** Massimo numero di eventi per singola richiesta batch. */
  maxBatchEvents: 20,
  /** Quanto indietro nel tempo puo' essere datato un evento, ms (6 ore). */
  maxPastMs: 6 * 60 * 60 * 1000,
  /** Tolleranza per orologi client avanti, ms. */
  maxFutureMs: 5 * 60 * 1000,
  /** Lunghezza esatta dell'identificatore anonimo. */
  reporterIdLength: 16,
  /** Raggio massimo accettato in una query "eventi vicini", m. */
  maxQueryRadiusM: 20_000,
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPORTER_RE = /^[0-9a-f]{16}$/;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ValidateOptions {
  /**
   * Quanto indietro nel tempo puo' essere datato l'evento.
   * Default: LIMITS.maxPastMs, usato per gli eventi INVIATI da un client
   * (un client non puo' inviare un evento rilevato giorni fa).
   * Per gli eventi RICEVUTI dal backend si usa Infinity: un evento a lungo TTL
   * (una buca) e' legittimamente vecchio, e sara' il TTL a farlo scadere.
   */
  maxPastMs?: number;
}

function isEventType(v: unknown): v is EventType {
  return typeof v === 'string' && (EVENT_TYPES as readonly string[]).includes(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Valida e normalizza un evento ricevuto da un client.
 * Scarta ogni campo non previsto: il server memorizza solo cio' che conosce.
 */
export function validateEvent(
  input: unknown,
  now: number = Date.now(),
  options: ValidateOptions = {},
): ValidationResult<RoadEvent> {
  const maxPastMs = options.maxPastMs ?? LIMITS.maxPastMs;
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'payload non valido' };
  const e = input as Record<string, unknown>;

  if (typeof e.id !== 'string' || !UUID_RE.test(e.id)) return { ok: false, error: 'id non valido' };

  if (!isFiniteNumber(e.lat) || e.lat < -90 || e.lat > 90) return { ok: false, error: 'lat fuori range' };
  if (!isFiniteNumber(e.lon) || e.lon < -180 || e.lon > 180) return { ok: false, error: 'lon fuori range' };

  if (!isFiniteNumber(e.ts)) return { ok: false, error: 'ts non valido' };
  if (e.ts > now + LIMITS.maxFutureMs) return { ok: false, error: 'ts nel futuro' };
  if (e.ts < now - maxPastMs) return { ok: false, error: 'ts troppo vecchio' };

  if (!isEventType(e.type)) return { ok: false, error: 'type sconosciuto' };

  if (e.severity !== 1 && e.severity !== 2 && e.severity !== 3) {
    return { ok: false, error: 'severity non valida' };
  }

  if (e.source !== 'auto' && e.source !== 'manual') return { ok: false, error: 'source non valida' };

  if (!isFiniteNumber(e.confidence) || e.confidence < 0 || e.confidence > 1) {
    return { ok: false, error: 'confidence fuori range' };
  }

  let heading: number | null = null;
  if (e.heading !== null && e.heading !== undefined) {
    if (!isFiniteNumber(e.heading) || e.heading < 0 || e.heading >= 360) {
      return { ok: false, error: 'heading fuori range' };
    }
    heading = e.heading;
  }

  if (typeof e.reporterId !== 'string' || !REPORTER_RE.test(e.reporterId)) {
    return { ok: false, error: 'reporterId non valido' };
  }

  // Gli eventi di DEMO non devono mai raggiungere il backend.
  if (e.demo === true) return { ok: false, error: 'evento demo rifiutato' };

  const value: RoadEvent = {
    id: e.id.toLowerCase(),
    lat: round(e.lat, 5),
    lon: round(e.lon, 5),
    ts: Math.round(e.ts),
    type: e.type,
    severity: e.severity as Severity,
    source: e.source,
    confidence: round(e.confidence, 3),
    heading: heading === null ? null : round(heading, 1),
    reporterId: e.reporterId.toLowerCase(),
  };

  const sensor = sanitizeSensorData(e.sensorData);
  if (sensor) value.sensorData = sensor;

  return { ok: true, value };
}

/** Tiene solo i campi tecnici noti e li limita a valori plausibili. */
function sanitizeSensorData(input: unknown): RoadEvent['sensorData'] | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const s = input as Record<string, unknown>;
  const out: NonNullable<RoadEvent['sensorData']> = {};
  if (isFiniteNumber(s.peakVerticalAccel)) out.peakVerticalAccel = clamp(round(s.peakVerticalAccel, 2), 0, 200);
  if (isFiniteNumber(s.impulseMs)) out.impulseMs = clamp(Math.round(s.impulseMs), 0, 5000);
  if (isFiniteNumber(s.speedMps)) out.speedMps = clamp(round(s.speedMps, 1), 0, 120);
  if (isFiniteNumber(s.baselineRms)) out.baselineRms = clamp(round(s.baselineRms, 2), 0, 200);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Valida i parametri di una query "eventi vicini". */
export function validateQuery(
  lat: unknown,
  lon: unknown,
  radius: unknown,
): ValidationResult<{ lat: number; lon: number; radiusM: number }> {
  const la = typeof lat === 'string' ? Number(lat) : lat;
  const lo = typeof lon === 'string' ? Number(lon) : lon;
  const r = typeof radius === 'string' ? Number(radius) : radius;

  if (!isFiniteNumber(la) || la < -90 || la > 90) return { ok: false, error: 'lat non valida' };
  if (!isFiniteNumber(lo) || lo < -180 || lo > 180) return { ok: false, error: 'lon non valida' };
  const radiusM = isFiniteNumber(r) ? clamp(r, 100, LIMITS.maxQueryRadiusM) : 5000;

  return { ok: true, value: { lat: la, lon: lo, radiusM } };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}
