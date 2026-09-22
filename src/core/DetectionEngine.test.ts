import { beforeEach, describe, expect, it } from 'vitest';
import { DETECTION } from '../config/config';
import { DetectionEngine, severityFromPeak, singleDetectionConfidence } from './DetectionEngine';
import type { EngineSample } from './SensorEngine';

/** Campione di comodo: guida normale, fondo tranquillo. */
function sample(overrides: Partial<EngineSample> = {}): EngineSample {
  return {
    ts: 0,
    verticalAccel: 0.2,
    totalAccel: 0.4,
    rotationRate: 5,
    speedMps: 14,
    lat: 45.4642,
    lon: 9.19,
    heading: 90,
    baselineRms: 0.4,
    warm: true,
    ...overrides,
  };
}

/**
 * Riproduce un impulso: alcuni campioni sopra soglia seguiti dal rientro.
 * Ritorna il rilevamento prodotto, se c'e'.
 */
function feedImpulse(
  engine: DetectionEngine,
  opts: { peak: number; durationMs: number; startTs: number; baselineRms?: number; rotation?: number },
) {
  // Passo fine (5 ms) per poter riprodurre anche impulsi piu' corti della
  // durata minima ammessa.
  const step = 5;
  let result = null;
  let t = opts.startTs;
  for (; t < opts.startTs + opts.durationMs; t += step) {
    result =
      engine.push(
        sample({
          ts: t,
          verticalAccel: opts.peak,
          baselineRms: opts.baselineRms ?? 0.4,
          rotationRate: opts.rotation ?? 5,
        }),
      ) ?? result;
  }
  // Rientro sotto la soglia di uscita.
  result =
    engine.push(
      sample({ ts: t, verticalAccel: 0.3, baselineRms: opts.baselineRms ?? 0.4 })
    ) ?? result;
  return result;
}

describe('DetectionEngine', () => {
  let engine: DetectionEngine;

  beforeEach(() => {
    engine = new DetectionEngine();
  });

  it('rileva una buca da un impulso netto a velocita\' di marcia', () => {
    const d = feedImpulse(engine, { peak: 7, durationMs: 120, startTs: 10_000 });
    expect(d).not.toBeNull();
    expect(d?.type).toBe('pothole');
    expect(d?.severity).toBe(2);
    expect(d?.peakVerticalAccel).toBeCloseTo(7, 1);
  });

  it('non rileva nulla sotto la velocita\' minima', () => {
    const d = feedImpulse(engine, { peak: 9, durationMs: 120, startTs: 10_000 });
    engine.reset();
    const slow = engine.push(sample({ ts: 1000, verticalAccel: 9, speedMps: 1 }));
    expect(d).not.toBeNull(); // controllo che l'impulso di per se' sia valido
    expect(slow).toBeNull();
  });

  it('non rileva nulla prima del warmup', () => {
    const d = engine.push(sample({ ts: 100, verticalAccel: 9, warm: false }));
    expect(d).toBeNull();
  });

  it('ignora impulsi troppo brevi', () => {
    const d = feedImpulse(engine, { peak: 8, durationMs: 10, startTs: 10_000 });
    expect(d).toBeNull();
  });

  it('ignora impulsi troppo lunghi (dosso, frenata)', () => {
    const d = feedImpulse(engine, { peak: 8, durationMs: 900, startTs: 10_000 });
    expect(d).toBeNull();
  });

  it('ignora un picco che non emerge dal rumore di fondo', () => {
    // Fondo gia' molto mosso: il picco non e\' distinguibile.
    const d = feedImpulse(engine, { peak: 4, durationMs: 120, startTs: 10_000, baselineRms: 1.9 });
    expect(d).toBeNull();
  });

  it('ignora l\'impulso se il telefono sta ruotando bruscamente', () => {
    const d = feedImpulse(engine, {
      peak: 8,
      durationMs: 120,
      startTs: 10_000,
      rotation: DETECTION.maxRotationRate + 50,
    });
    expect(d).toBeNull();
  });

  it('applica il periodo refrattario', () => {
    const first = feedImpulse(engine, { peak: 8, durationMs: 120, startTs: 10_000 });
    expect(first).not.toBeNull();
    // Secondo impulso subito dopo: deve essere ignorato.
    const second = feedImpulse(engine, { peak: 8, durationMs: 120, startTs: 10_500 });
    expect(second).toBeNull();
    // Oltre il periodo refrattario torna a rilevare.
    const third = feedImpulse(engine, {
      peak: 8,
      durationMs: 120,
      startTs: 10_000 + DETECTION.refractoryMs + 500,
    });
    expect(third).not.toBeNull();
  });

  it('non rileva senza posizione', () => {
    const d = engine.push(sample({ ts: 10_000, verticalAccel: 9, lat: null, lon: null }));
    expect(d).toBeNull();
  });

  it('non rileva se l\'accelerometro manca', () => {
    const d = engine.push(sample({ ts: 10_000, verticalAccel: null }));
    expect(d).toBeNull();
  });

  it('segnala fondo irregolare dopo un tratto sostenuto di rumore', () => {
    let detection = null;
    for (let t = 0; t <= 6000; t += 100) {
      detection =
        engine.push(
          sample({ ts: t, verticalAccel: 1.5, baselineRms: DETECTION.rough.rmsThreshold + 0.3 }),
        ) ?? detection;
    }
    expect(detection?.type).toBe('rough');
  });

  it('non segnala fondo irregolare per un tratto breve', () => {
    let detection = null;
    for (let t = 0; t <= 1500; t += 100) {
      detection =
        engine.push(
          sample({ ts: t, verticalAccel: 1.5, baselineRms: DETECTION.rough.rmsThreshold + 0.3 }),
        ) ?? detection;
    }
    expect(detection).toBeNull();
  });
});

describe('severityFromPeak', () => {
  it('classifica i tre livelli', () => {
    expect(severityFromPeak(3.5)).toBe(1);
    expect(severityFromPeak(6)).toBe(2);
    expect(severityFromPeak(12)).toBe(3);
  });
});

describe('singleDetectionConfidence', () => {
  it('non supera mai 0.6: un solo passaggio non fa una certezza', () => {
    expect(singleDetectionConfidence(50, 0, 120)).toBeLessThanOrEqual(0.6);
  });

  it('cresce con l\'intensita\' del picco', () => {
    const debole = singleDetectionConfidence(3.5, 0.4, 120);
    const forte = singleDetectionConfidence(9, 0.4, 120);
    expect(forte).toBeGreaterThan(debole);
  });

  it('e\' piu\' alta su fondo tranquillo', () => {
    const pulito = singleDetectionConfidence(6, 0.1, 120);
    const rumoroso = singleDetectionConfidence(6, 1.9, 120);
    expect(pulito).toBeGreaterThan(rumoroso);
  });
});
