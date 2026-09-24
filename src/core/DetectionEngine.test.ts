import { beforeEach, describe, expect, it } from 'vitest';
import { DETECTION } from '../config/config';
import { DetectionEngine, severityFromPeak, singleDetectionConfidence } from './DetectionEngine';
import type { EngineSample } from './SensorEngine';

/**
 * Campione di comodo: guida normale, telefono fermo nel supporto, fondo
 * tranquillo. `totalAccel` viene derivato dalla verticale quando non e'
 * indicato, perche' un urto dalla strada e' prevalentemente verticale: un
 * totale piu' piccolo della componente verticale non esiste in natura.
 */
function sample(overrides: Partial<EngineSample> = {}): EngineSample {
  const base: EngineSample = {
    ts: 0,
    verticalAccel: 0.2,
    totalAccel: null,
    rotationRate: 5,
    speedMps: 14,
    lat: 45.4642,
    lon: 9.19,
    heading: 90,
    baselineRms: 0.4,
    warm: true,
    ...overrides,
  };
  if (overrides.totalAccel === undefined) {
    const v = base.verticalAccel;
    base.totalAccel = v === null ? null : Math.abs(v) * 1.1;
  }
  return base;
}

/**
 * Porta il motore in condizioni di guida reali prima della misura.
 *
 * Serve perche' un evento stradale richiede che il veicolo sia in moto
 * CONTINUATIVAMENTE da un po': un singolo campione GPS sopra soglia non prova
 * niente, e a veicolo fermo il GPS produce velocita' fantasma.
 *
 * @returns l'istante da cui si puo' iniziare a misurare.
 */
function inMarcia(engine: DetectionEngine, startTs = 0, overrides: Partial<EngineSample> = {}): number {
  const durata = DETECTION.stability.minMotionHoldMs + 500;
  for (let t = startTs; t <= startTs + durata; t += 100) {
    engine.push(sample({ ts: t, ...overrides }));
  }
  return startTs + durata + 100;
}

/**
 * Riproduce un impulso: alcuni campioni sopra soglia seguiti dal rientro.
 * Ritorna il rilevamento prodotto, se c'e'.
 */
function feedImpulse(
  engine: DetectionEngine,
  opts: {
    peak: number;
    durationMs: number;
    startTs: number;
    baselineRms?: number;
    rotation?: number;
    /** Accelerazione totale al picco: serve a distinguere un urto da sotto. */
    totalAccel?: number | null;
  },
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
          ...('totalAccel' in opts ? { totalAccel: opts.totalAccel as number | null } : {}),
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
    const t0 = inMarcia(engine, 5_000);
    const d = feedImpulse(engine, { peak: 7, durationMs: 120, startTs: t0 });
    expect(d).not.toBeNull();
    expect(d?.type).toBe('pothole');
    expect(d?.severity).toBe(2);
    expect(d?.peakVerticalAccel).toBeCloseTo(7, 1);
  });

  it('non rileva nulla sotto la velocita\' minima', () => {
    const d = feedImpulse(engine, { peak: 9, durationMs: 120, startTs: inMarcia(engine, 5_000) });
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
    const d = feedImpulse(engine, { peak: 8, durationMs: 10, startTs: inMarcia(engine, 5_000) });
    expect(d).toBeNull();
  });

  it('ignora impulsi troppo lunghi (dosso, frenata)', () => {
    const d = feedImpulse(engine, { peak: 8, durationMs: 900, startTs: inMarcia(engine, 5_000) });
    expect(d).toBeNull();
  });

  it('ignora un picco che non emerge dal rumore di fondo', () => {
    // Fondo gia' molto mosso: il picco non e\' distinguibile.
    const d = feedImpulse(engine, {
      peak: 4,
      durationMs: 120,
      startTs: inMarcia(engine, 5_000),
      baselineRms: 1.9,
    });
    expect(d).toBeNull();
  });

  it('ignora l\'impulso se il telefono sta ruotando bruscamente', () => {
    const d = feedImpulse(engine, {
      peak: 8,
      durationMs: 120,
      startTs: inMarcia(engine, 5_000),
      rotation: DETECTION.maxRotationRate + 50,
    });
    expect(d).toBeNull();
  });

  it('applica il periodo refrattario', () => {
    const t0 = inMarcia(engine, 5_000);
    const first = feedImpulse(engine, { peak: 8, durationMs: 120, startTs: t0 });
    expect(first).not.toBeNull();
    // Secondo impulso subito dopo: deve essere ignorato.
    const second = feedImpulse(engine, { peak: 8, durationMs: 120, startTs: t0 + 500 });
    expect(second).toBeNull();
    // Oltre il periodo refrattario torna a rilevare.
    const third = feedImpulse(engine, {
      peak: 8,
      durationMs: 120,
      startTs: t0 + DETECTION.refractoryMs + 500,
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
    // Il conteggio del fondo irregolare parte solo quando il veicolo e' in
    // moto da abbastanza tempo: la finestra va allungata di conseguenza.
    const fine = DETECTION.stability.minMotionHoldMs + DETECTION.rough.minDurationMs + 2000;
    for (let t = 0; t <= fine; t += 100) {
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

/**
 * ANTI-FALSO-POSITIVO.
 *
 * Il primo test su strada ha prodotto 257 eventi: bastava toccare il telefono.
 * Questi casi descrivono cosa deve succedere adesso, e sono scritti per
 * fallire se qualcuno rimuovesse i criteri di contesto.
 */
describe('manipolazione del telefono', () => {
  let engine: DetectionEngine;

  beforeEach(() => {
    engine = new DetectionEngine();
  });

  it('a veicolo fermo nessun impulso diventa evento, per quanto forte', () => {
    // Il caso piu' semplice e piu' frequente: il telefono viene preso in mano
    // da fermi. Prima bastava che il GPS dichiarasse una velocita' qualsiasi.
    let d = null;
    for (let t = 0; t <= 8000; t += 100) {
      d = engine.push(sample({ ts: t, verticalAccel: 12, speedMps: 0 })) ?? d;
    }
    expect(d).toBeNull();
    expect(engine.lastTelemetry().reason).toBe('velocita fuori range');
  });

  it('una velocita\' improvvisa non apre subito il rilevamento', () => {
    // Deriva del GPS: un campione sopra soglia non prova che il veicolo sia
    // in moto. Serve che lo sia continuativamente.
    const d = feedImpulse(engine, { peak: 9, durationMs: 120, startTs: 1000 });
    expect(d).toBeNull();
    expect(engine.lastTelemetry().stable).toBe(false);
    expect(engine.lastTelemetry().reason).toBe('veicolo fermo');
  });

  it('una rotazione da mano umana sospende gli eventi stradali', () => {
    const t0 = inMarcia(engine, 5_000);
    // Il telefono viene ruotato: rotazione ben oltre quella di un veicolo.
    const d = feedImpulse(engine, {
      peak: 9,
      durationMs: 120,
      startTs: t0,
      rotation: DETECTION.stability.manipulationDps + 50,
    });
    expect(d).toBeNull();
    expect(engine.lastTelemetry().stable).toBe(false);
  });

  it('dopo una manipolazione forte resta una quarantena', () => {
    const t0 = inMarcia(engine, 5_000);
    // Un solo campione di manipolazione.
    engine.push(sample({ ts: t0, rotationRate: DETECTION.stability.manipulationDps + 100 }));

    // Subito dopo, telefono di nuovo immobile e impulso perfetto: niente.
    const durante = feedImpulse(engine, { peak: 9, durationMs: 120, startTs: t0 + 200 });
    expect(durante).toBeNull();
    expect(engine.lastTelemetry().reason).toBe('quarantena');

    // Passata la quarantena, e tornato in marcia, si rileva di nuovo.
    const dopo = inMarcia(engine, t0 + DETECTION.stability.quarantineMs + 100);
    const d = feedImpulse(engine, { peak: 9, durationMs: 120, startTs: dopo });
    expect(d).not.toBeNull();
  });

  it('un urto non verticale non e\' una buca', () => {
    const t0 = inMarcia(engine, 5_000);
    // Picco verticale valido, ma l'accelerazione totale e' molto maggiore:
    // la spinta non viene da sotto. E' il profilo di una mano, non di una buca.
    const d = feedImpulse(engine, { peak: 9, durationMs: 120, startTs: t0, totalAccel: 40 });
    expect(d).toBeNull();
    expect(engine.lastTelemetry().reason).toBe('urto non verticale');
  });

  it('senza accelerazione totale il criterio non si applica, non si inventa', () => {
    const t0 = inMarcia(engine, 5_000);
    const d = feedImpulse(engine, { peak: 9, durationMs: 120, startTs: t0, totalAccel: null });
    expect(d).not.toBeNull();
    expect(engine.lastTelemetry().verticalShare).toBeNull();
  });
});

describe('impulso, evento stradale ed evento confermato sono cose diverse', () => {
  it('un impulso valido per forma puo\' non diventare evento', () => {
    const engine = new DetectionEngine();
    const t0 = inMarcia(engine, 5_000);
    const d = feedImpulse(engine, { peak: 9, durationMs: 120, startTs: t0, totalAccel: 40 });

    const tele = engine.lastTelemetry();
    // Forma e durata erano valide: l'IMPULSO c'e' stato.
    expect(tele.impulseDetected).toBe(true);
    // Ma il contesto lo ha escluso: nessun EVENTO STRADALE.
    expect(tele.eventEmitted).toBe(false);
    expect(d).toBeNull();
  });

  it('la telemetria riporta i valori misurati, non conclusioni', () => {
    const engine = new DetectionEngine();
    const t0 = inMarcia(engine, 5_000);
    feedImpulse(engine, { peak: 7, durationMs: 120, startTs: t0 });
    const tele = engine.lastTelemetry();

    expect(tele.speedMps).toBe(14);
    expect(tele.peak).toBeCloseTo(7, 1);
    expect(tele.baselineRms).toBeCloseTo(0.4, 1);
    expect(tele.peakOverNoise).not.toBeNull();
    expect(tele.gyroMaxDps).toBe(5);
    expect(tele.eventEmitted).toBe(true);
    expect(tele.reason).toBeNull();
  });

  it('ogni scarto ha un motivo leggibile', () => {
    const engine = new DetectionEngine();
    engine.push(sample({ ts: 100, warm: false }));
    expect(engine.lastTelemetry().reason).toBe('motore freddo');

    engine.reset();
    engine.push(sample({ ts: 100, verticalAccel: null }));
    expect(engine.lastTelemetry().reason).toBe('dato mancante');

    engine.reset();
    engine.push(sample({ ts: 100, lat: null, lon: null }));
    expect(engine.lastTelemetry().reason).toBe('posizione assente');
  });
});
