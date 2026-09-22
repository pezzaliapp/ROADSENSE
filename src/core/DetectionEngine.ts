/**
 * ROAD SENSE - DetectionEngine.
 *
 * ALGORITMO (euristico, locale, documentato, calibrabile da config/config.ts)
 *
 * Nessun machine learning, nessuna API cloud. Tutta l'analisi avviene sul
 * dispositivo: i campioni dei sensori non lasciano mai il telefono.
 *
 * Una buca NON e' semplicemente "un'accelerazione alta". Perche' un impulso sia
 * classificato come anomalia devono valere TUTTE queste condizioni:
 *
 *  1. VELOCITA' PLAUSIBILE
 *     minSpeedMps <= v <= maxSpeedMps. A meno di ~11 km/h uno scossone e'
 *     indistinguibile dal telefono manipolato; oltre 250 km/h il GPS mente.
 *
 *  2. MOTORE "CALDO"
 *     La stima della gravita' deve essersi stabilizzata (warmup), altrimenti
 *     la compensazione dell'orientamento non e' affidabile.
 *
 *  3. PICCO SIGNIFICATIVO IN ASSOLUTO
 *     |a_vert| >= peakThreshold.
 *
 *  4. PICCO SIGNIFICATIVO IN RELATIVO
 *     |a_vert| >= peakOverBaseline * RMS del rumore precedente, e la baseline
 *     deve essere sotto maxBaselineRms. Su pave' o sterrato ogni sobbalzo
 *     supererebbe la soglia assoluta: questo criterio evita la raffica di
 *     falsi positivi e lascia il caso al rilevatore di "fondo irregolare".
 *
 *  5. DURATA COERENTE
 *     L'impulso (permanenza sopra meta' soglia) deve durare tra minImpulseMs e
 *     maxImpulseMs. Piu' breve = rumore elettrico; piu' lungo = dosso, frenata,
 *     rotonda, cambio di pendenza.
 *
 *  6. IL TELEFONO NON SI STA MUOVENDO DA SOLO
 *     La velocita' angolare deve restare sotto maxRotationRate: se il telefono
 *     ruota bruscamente e' stato preso in mano o e' scivolato dal supporto.
 *
 *  7. MOVIMENTO PRECEDENTE E SUCCESSIVO
 *     L'impulso viene chiuso e valutato solo dopo essere rientrato: si guarda
 *     cosa succede prima (baseline) e dopo (rientro entro maxImpulseMs).
 *
 *  8. PERIODO REFRATTARIO
 *     Dopo un rilevamento si ignora tutto per refractoryMs, per non trasformare
 *     una singola buca in dieci eventi.
 *
 * SEVERITA': dal picco verticale (soglie severityMedium / severitySevere).
 * CONFIDENZA del singolo rilevamento: cresce con il rapporto picco/soglia e con
 * la qualita' del contesto (baseline bassa, velocita' nota). Resta comunque
 * limitata: la fiducia vera nasce dall'aggregazione (ConfidenceEngine).
 *
 * FONDO IRREGOLARE: se l'RMS resta sopra rough.rmsThreshold per almeno
 * rough.minDurationMs, si emette un evento 'rough' invece di decine di buche.
 */

import { DETECTION } from '../config/config';
import type { EngineSample } from './SensorEngine';
import type { EventType, Severity } from './types';

export interface Detection {
  type: Extract<EventType, 'pothole' | 'rough'>;
  ts: number;
  lat: number;
  lon: number;
  heading: number | null;
  severity: Severity;
  /** Confidenza del singolo rilevamento, 0..1. */
  confidence: number;
  peakVerticalAccel: number;
  impulseMs: number;
  speedMps: number;
  baselineRms: number;
}

/** Stato dell'impulso in corso di misurazione. */
interface ActiveImpulse {
  startTs: number;
  peak: number;
  peakTs: number;
  baselineRms: number;
  speedMps: number;
  lat: number;
  lon: number;
  heading: number | null;
}

export class DetectionEngine {
  private active: ActiveImpulse | null = null;
  // -Infinity e non 0: il primo rilevamento non deve mai essere bloccato dal
  // periodo refrattario, qualunque sia l'origine della base dei tempi.
  private lastDetectionTs = Number.NEGATIVE_INFINITY;
  private lastRoughTs = Number.NEGATIVE_INFINITY;
  private roughSince: number | null = null;
  private maxRotationSeen = 0;
  /**
   * true dopo che un impulso e' stato abbandonato perche' troppo lungo.
   * Impedisce che un'oscillazione prolungata venga spezzata in piu' "buche":
   * per ripartire il segnale deve prima tornare calmo.
   */
  private awaitingCalm = false;

  /** Azzera lo stato interno (cambio provider, stop/start). */
  reset(): void {
    this.active = null;
    this.lastDetectionTs = Number.NEGATIVE_INFINITY;
    this.lastRoughTs = Number.NEGATIVE_INFINITY;
    this.roughSince = null;
    this.maxRotationSeen = 0;
    this.awaitingCalm = false;
  }

  /**
   * Consuma un campione e restituisce un rilevamento quando le condizioni
   * sono soddisfatte, altrimenti null.
   */
  push(s: EngineSample): Detection | null {
    if (!s.warm) return null;
    if (s.verticalAccel === null || !Number.isFinite(s.verticalAccel)) return null;
    if (s.lat === null || s.lon === null) return null;

    const speed = s.speedMps;
    if (speed === null || speed < DETECTION.minSpeedMps || speed > DETECTION.maxSpeedMps) {
      // Fuori dalle condizioni di guida: si azzera ogni impulso in corso.
      this.active = null;
      this.roughSince = null;
      return null;
    }

    const rough = this.checkRough(s, speed);
    if (rough) return rough;

    return this.checkImpulse(s, speed);
  }

  // -- fondo irregolare -----------------------------------------------------

  private checkRough(s: EngineSample, speed: number): Detection | null {
    if (s.baselineRms >= DETECTION.rough.rmsThreshold) {
      if (this.roughSince === null) this.roughSince = s.ts;
      const elapsed = s.ts - this.roughSince;
      const cooled = s.ts - this.lastRoughTs > DETECTION.rough.refractoryMs;
      if (elapsed >= DETECTION.rough.minDurationMs && cooled) {
        this.lastRoughTs = s.ts;
        this.roughSince = s.ts;
        return {
          type: 'rough',
          ts: s.ts,
          lat: s.lat as number,
          lon: s.lon as number,
          heading: s.heading,
          severity: s.baselineRms >= DETECTION.rough.rmsThreshold * 1.6 ? 2 : 1,
          // Il fondo irregolare e' misurato su piu' secondi: e' un'evidenza
          // piu' solida di un singolo picco, ma resta un'euristica.
          confidence: 0.55,
          peakVerticalAccel: s.baselineRms,
          impulseMs: elapsed,
          speedMps: speed,
          baselineRms: s.baselineRms,
        };
      }
    } else {
      this.roughSince = null;
    }
    return null;
  }

  // -- impulso singolo (buca / urto) ---------------------------------------

  private checkImpulse(s: EngineSample, speed: number): Detection | null {
    const magnitude = Math.abs(s.verticalAccel as number);
    const rotation = s.rotationRate ?? 0;

    if (s.ts - this.lastDetectionTs < DETECTION.refractoryMs) {
      this.active = null;
      return null;
    }

    // Soglia di rientro: meta' della soglia di ingresso (isteresi).
    const exitThreshold = DETECTION.peakThreshold / 2;

    if (this.active === null) {
      if (this.awaitingCalm) {
        // Si riparte solo quando il segnale e' davvero rientrato.
        if (magnitude < exitThreshold) this.awaitingCalm = false;
        return null;
      }
      if (magnitude < DETECTION.peakThreshold) return null;
      // Criterio relativo: l'impulso deve emergere da un fondo tranquillo.
      if (s.baselineRms > DETECTION.maxBaselineRms) return null;
      if (s.baselineRms > 0.05 && magnitude < s.baselineRms * DETECTION.peakOverBaseline) return null;

      this.active = {
        startTs: s.ts,
        peak: magnitude,
        peakTs: s.ts,
        baselineRms: s.baselineRms,
        speedMps: speed,
        lat: s.lat as number,
        lon: s.lon as number,
        heading: s.heading,
      };
      this.maxRotationSeen = rotation;
      return null;
    }

    // Impulso in corso.
    this.maxRotationSeen = Math.max(this.maxRotationSeen, rotation);
    if (magnitude > this.active.peak) {
      this.active.peak = magnitude;
      this.active.peakTs = s.ts;
    }

    const duration = s.ts - this.active.startTs;

    if (magnitude >= exitThreshold) {
      // Ancora sopra soglia: se dura troppo non e' una buca (dosso, frenata).
      if (duration > DETECTION.maxImpulseMs) {
        this.active = null;
        this.awaitingCalm = true;
      }
      return null;
    }

    // Impulso rientrato: si valuta.
    const impulse = this.active;
    this.active = null;

    if (duration < DETECTION.minImpulseMs || duration > DETECTION.maxImpulseMs) return null;
    if (this.maxRotationSeen > DETECTION.maxRotationRate) return null;

    this.lastDetectionTs = s.ts;

    return {
      type: 'pothole',
      ts: impulse.peakTs,
      lat: impulse.lat,
      lon: impulse.lon,
      heading: impulse.heading,
      severity: severityFromPeak(impulse.peak),
      confidence: singleDetectionConfidence(impulse.peak, impulse.baselineRms, duration),
      peakVerticalAccel: round(impulse.peak, 2),
      impulseMs: Math.round(duration),
      speedMps: round(impulse.speedMps, 1),
      baselineRms: round(impulse.baselineRms, 2),
    };
  }
}

/** Severita' derivata dal picco verticale. */
export function severityFromPeak(peak: number): Severity {
  if (peak >= DETECTION.severitySevere) return 3;
  if (peak >= DETECTION.severityMedium) return 2;
  return 1;
}

/**
 * Confidenza del SINGOLO rilevamento automatico.
 *
 * Deliberatamente conservativa: un solo passaggio non puo' mai dare certezza.
 * Il valore massimo e' 0.6; per superarlo servono rilevamenti indipendenti,
 * che e' esattamente il compito del ConfidenceEngine.
 */
export function singleDetectionConfidence(
  peak: number,
  baselineRms: number,
  impulseMs: number,
): number {
  // Quanto il picco supera la soglia (0 = appena sopra, 1 = molto sopra).
  const strength = clamp01((peak - DETECTION.peakThreshold) / (DETECTION.severitySevere - DETECTION.peakThreshold));
  // Fondo tranquillo = contesto pulito = piu' fiducia.
  const cleanliness = clamp01(1 - baselineRms / DETECTION.maxBaselineRms);
  // Durata "tipica" da buca: campana centrata a 120 ms.
  const shape = clamp01(1 - Math.abs(impulseMs - 120) / 200);

  const score = 0.25 + 0.2 * strength + 0.1 * cleanliness + 0.05 * shape;
  return round(Math.min(0.6, score), 3);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function round(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
