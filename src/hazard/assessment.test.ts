/**
 * ROAD SENSE - verifiche sulla separazione dei quattro concetti.
 *
 * Nascono da un audit: la prima versione usava un unico coefficiente, tarato
 * perche' i conti cadessero dalla parte giusta di una soglia. Questi test
 * esistono perche' quella scorciatoia non possa tornare.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ALERT, CONFIDENCE } from '../config/config';
import { buildClusters } from '../core/ConfidenceEngine';
import { isRelevant, type DriverState } from '../core/AlertEngine';
import { destinationPoint } from '../core/geo';
import { installMemoryStorage } from '../core/testUtils';
import type { RoadEvent } from '../core/types';
import {
  admitsAlert,
  assessCluster,
  confirmationFromReporters,
  MIN_DISTINCT_REPORTERS,
  sourceReliabilityRank,
} from './assessment';
import { hazardPriority } from './taxonomy';

installMemoryStorage();
const ROOT = resolve(import.meta.dirname, '..', '..');
const NOW = Date.now();
const HERE = { lat: 45.4642, lon: 9.19 };

let n = 0;
function ev(overrides: Partial<RoadEvent> = {}): RoadEvent {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    lat: HERE.lat,
    lon: HERE.lon,
    ts: NOW,
    type: 'vehicle',
    severity: 2,
    source: 'voice',
    confidence: 0.55,
    heading: 90,
    reporterId: String(n).padStart(16, '0'),
    hazard: 'broken_down_vehicle',
    ...overrides,
  };
}

/**
 * Conducente 100 m prima del pericolo e diretto verso di esso: dentro la
 * distanza di anticipo, cosi' il test verifica la politica di ammissione e
 * non la geometria, che ha gia' i suoi test.
 */
function driverBefore(): DriverState {
  const p = destinationPoint(HERE, 270, 100);
  return { lat: p.lat, lon: p.lon, heading: 90, speedMps: 10 };
}

const policy = (events: readonly RoadEvent[]) => (cluster: Parameters<typeof assessCluster>[0]) =>
  admitsAlert(cluster, assessCluster(cluster, events), ALERT.minConfidence);

describe('stato di conferma: e\' un conteggio di dispositivi distinti', () => {
  it('lo stesso dispositivo che segnala due volte NON conferma', () => {
    const uno = ev({ reporterId: 'aaaaaaaaaaaaaaaa' });
    const ancora = ev({ reporterId: 'aaaaaaaaaaaaaaaa' });
    const cluster = buildClusters([uno, ancora], NOW)[0]!;

    expect(cluster.count).toBe(2);
    // Due rilevamenti, un solo testimone.
    expect(cluster.reporters).toBe(1);
    expect(assessCluster(cluster, [uno, ancora]).confirmation).toBe('reported');
  });

  it('due dispositivi DISTINTI confermano', () => {
    const a = ev({ reporterId: 'aaaaaaaaaaaaaaaa' });
    const b = ev({ reporterId: 'bbbbbbbbbbbbbbbb' });
    const cluster = buildClusters([a, b], NOW)[0]!;

    expect(cluster.reporters).toBe(2);
    expect(assessCluster(cluster, [a, b]).confirmation).toBe('corroborated');
  });

  it('lo stesso dispositivo dieci volte resta una sola testimonianza', () => {
    const molti = Array.from({ length: 10 }, () => ev({ reporterId: 'aaaaaaaaaaaaaaaa' }));
    const cluster = buildClusters(molti, NOW)[0]!;
    expect(cluster.reporters).toBe(1);
    expect(assessCluster(cluster, molti).confirmation).toBe('reported');
  });

  it('la soglia e\' dichiarata, non nascosta in una formula', () => {
    expect(MIN_DISTINCT_REPORTERS).toBe(2);
    expect(confirmationFromReporters(1)).toBe('reported');
    expect(confirmationFromReporters(2)).toBe('corroborated');
  });
});

describe('avviso prudenziale per i pericoli critici', () => {
  it('un CRITICO non confermato genera comunque un avviso', () => {
    const solo = ev({ type: 'wrong_way', hazard: 'wrong_way_truck', reporterId: 'aaaaaaaaaaaaaaaa' });
    const cluster = buildClusters([solo], NOW)[0]!;
    const valutazione = assessCluster(cluster, [solo]);

    // Non confermato, e sotto la soglia storica di confidenza...
    expect(valutazione.confirmation).toBe('reported');
    expect(cluster.confidence).toBeLessThan(ALERT.minConfidence);
    // ...ma critico, quindi si avvisa lo stesso.
    expect(valutazione.priority).toBe('critical');
    expect(admitsAlert(cluster, valutazione, ALERT.minConfidence)).toBe(true);
    expect(isRelevant(cluster, driverBefore(), policy([solo]))).not.toBeNull();
  });

  it('un pericolo NON critico e non confermato resta in silenzio', () => {
    const solo = ev({ type: 'pothole', hazard: 'pothole', source: 'auto', confidence: 0.4 });
    const cluster = buildClusters([solo], NOW)[0]!;
    const valutazione = assessCluster(cluster, [solo]);

    expect(valutazione.priority).toBe('medium');
    expect(valutazione.confirmation).toBe('reported');
    expect(cluster.confidence).toBeLessThan(ALERT.minConfidence);
    expect(admitsAlert(cluster, valutazione, ALERT.minConfidence)).toBe(false);
    expect(isRelevant(cluster, driverBefore(), policy([solo]))).toBeNull();
  });

  it('lo stesso critico, una volta corroborato, resta ammesso e cambia stato', () => {
    const a = ev({ type: 'wrong_way', hazard: 'wrong_way_truck', reporterId: 'aaaaaaaaaaaaaaaa' });
    const b = ev({ type: 'wrong_way', hazard: 'wrong_way_truck', reporterId: 'bbbbbbbbbbbbbbbb' });

    const prima = buildClusters([a], NOW)[0]!;
    const dopo = buildClusters([a, b], NOW)[0]!;
    const vPrima = assessCluster(prima, [a]);
    const vDopo = assessCluster(dopo, [a, b]);

    expect(vPrima.confirmation).toBe('reported');
    expect(vDopo.confirmation).toBe('corroborated');
    // L'avviso c'era gia' e resta; cambia cio' che se ne dice.
    expect(admitsAlert(prima, vPrima, ALERT.minConfidence)).toBe(true);
    expect(admitsAlert(dopo, vDopo, ALERT.minConfidence)).toBe(true);
    expect(dopo.confidence).toBeGreaterThan(prima.confidence);
  });

  it('una zona corroborata passa anche sotto la soglia di confidenza', () => {
    const a = ev({ reporterId: 'aaaaaaaaaaaaaaaa' });
    const b = ev({ reporterId: 'bbbbbbbbbbbbbbbb' });
    const cluster = buildClusters([a, b], NOW)[0]!;
    expect(cluster.confidence).toBeLessThan(ALERT.minConfidence);
    expect(admitsAlert(cluster, assessCluster(cluster, [a, b]), ALERT.minConfidence)).toBe(true);
  });
});

describe('priorita\' != confidenza != conferma', () => {
  it('sono tre grandezze indipendenti', () => {
    const critico = ev({ type: 'wrong_way', hazard: 'wrong_way_truck' });
    const banale = ev({ type: 'pothole', hazard: 'pothole' });

    const cCritico = buildClusters([critico], NOW)[0]!;
    const cBanale = buildClusters([banale], NOW)[0]!;

    // Stessa confidenza, stessa conferma, priorita' opposte.
    expect(cCritico.confidence).toBeCloseTo(cBanale.confidence, 6);
    expect(assessCluster(cCritico, [critico]).confirmation).toBe(
      assessCluster(cBanale, [banale]).confirmation,
    );
    expect(hazardPriority('wrong_way_truck')).toBe('critical');
    expect(hazardPriority('pothole')).toBe('medium');
  });

  it('la priorita\' non cambia con la conferma', () => {
    const a = ev({ type: 'wrong_way', hazard: 'wrong_way_truck', reporterId: 'aaaaaaaaaaaaaaaa' });
    const b = ev({ type: 'wrong_way', hazard: 'wrong_way_truck', reporterId: 'bbbbbbbbbbbbbbbb' });
    expect(assessCluster(buildClusters([a], NOW)[0]!, [a]).priority).toBe('critical');
    expect(assessCluster(buildClusters([a, b], NOW)[0]!, [a, b]).priority).toBe('critical');
  });

  it('l\'affidabilita\' della sorgente e\' un ordinamento, non una percentuale', () => {
    expect(sourceReliabilityRank('manual')).toBeLessThan(sourceReliabilityRank('voice'));
    expect(sourceReliabilityRank('voice')).toBeLessThan(sourceReliabilityRank('auto'));
  });

  it('la sorgente piu\' affidabile della zona viene riportata', () => {
    const sensore = ev({ source: 'auto', confidence: 0.4, reporterId: 'aaaaaaaaaaaaaaaa' });
    const voce = ev({ source: 'voice', reporterId: 'bbbbbbbbbbbbbbbb' });
    const cluster = buildClusters([sensore, voce], NOW)[0]!;
    expect(assessCluster(cluster, [sensore, voce]).bestSource).toBe('voice');
  });
});

describe('il ConfidenceEngine non e\' stato piegato alla voce', () => {
  it('non esiste alcun peso dedicato alla sorgente vocale', () => {
    const engine = readFileSync(resolve(ROOT, 'src', 'core', 'ConfidenceEngine.ts'), 'utf8');
    expect(engine).not.toMatch(/voiceWeight|'voice'/);
    expect(CONFIDENCE).not.toHaveProperty('voiceWeight');
  });

  it('la formula della confidenza resta quella dei rilevamenti automatici', () => {
    const engine = readFileSync(resolve(ROOT, 'src', 'core', 'ConfidenceEngine.ts'), 'utf8');
    expect(engine).toMatch(
      /ev\.source === 'manual' \? CONFIDENCE\.manualWeight : CONFIDENCE\.autoWeight \* ev\.confidence/,
    );
  });

  it('la decisione di avvisare non dipende da un coefficiente per sorgente', () => {
    const assessment = readFileSync(resolve(ROOT, 'src', 'hazard', 'assessment.ts'), 'utf8');
    // `admitsAlert` guarda confidenza, conferma e priorita': nessun peso.
    const body = assessment.slice(assessment.indexOf('export function admitsAlert'));
    expect(body).not.toMatch(/Weight|reliability|RELIABILITY/);
  });
});
