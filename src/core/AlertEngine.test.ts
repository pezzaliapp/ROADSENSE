import { describe, expect, it } from 'vitest';
import { ALERT } from '../config/config';
import { AlertEngine, isRelevant, lookaheadMeters, type DriverState } from './AlertEngine';
import { destinationPoint } from './geo';
import type { EventCluster } from './types';

const ME = { lat: 45.4642, lon: 9.19 };

function cluster(overrides: Partial<EventCluster> = {}): EventCluster {
  return {
    id: 'pothole:45.4642:9.1900',
    lat: ME.lat,
    lon: ME.lon,
    type: 'pothole',
    severity: 2,
    confidence: 0.8,
    count: 3,
    reporters: 3,
    lastTs: 0,
    heading: null,
    expiresAt: Number.MAX_SAFE_INTEGER,
    ...overrides,
  };
}

/** Conducente che viaggia verso nord a 50 km/h. */
function driver(overrides: Partial<DriverState> = {}): DriverState {
  return { lat: ME.lat, lon: ME.lon, heading: 0, speedMps: 14, ...overrides };
}

/** Cluster posto a `dist` metri in direzione `bearing` dal conducente. */
function at(dist: number, bearing: number, overrides: Partial<EventCluster> = {}): EventCluster {
  const p = destinationPoint(ME, bearing, dist);
  return cluster({ lat: p.lat, lon: p.lon, id: `c-${dist}-${bearing}`, ...overrides });
}

describe('lookaheadMeters', () => {
  it('scala con la velocita\' entro i limiti', () => {
    expect(lookaheadMeters(0)).toBe(ALERT.minLookaheadM);
    expect(lookaheadMeters(100)).toBe(ALERT.maxLookaheadM);
    expect(lookaheadMeters(14)).toBeCloseTo(14 * ALERT.lookaheadSec, 5);
  });

  it('usa il minimo quando la velocita\' e\' sconosciuta', () => {
    expect(lookaheadMeters(null)).toBe(ALERT.minLookaheadM);
  });
});

describe('isRelevant', () => {
  it('segnala un evento davanti entro la distanza di anticipo', () => {
    expect(isRelevant(at(150, 0), driver())).not.toBeNull();
  });

  it('non segnala un evento alle spalle', () => {
    expect(isRelevant(at(150, 180), driver())).toBeNull();
  });

  it('non segnala un evento lateralmente fuori dal cono', () => {
    expect(isRelevant(at(150, 90), driver())).toBeNull();
  });

  it('non segnala un evento oltre la distanza di anticipo', () => {
    expect(isRelevant(at(1000, 0), driver())).toBeNull();
  });

  it('non segnala eventi poco affidabili', () => {
    expect(isRelevant(at(150, 0, { confidence: ALERT.minConfidence - 0.1 }), driver())).toBeNull();
  });

  it('allarga il cono a distanza ravvicinata', () => {
    const laterale = at(40, 55);
    expect(isRelevant(laterale, driver())).not.toBeNull();
  });

  it('non segnala un evento della carreggiata opposta', () => {
    // Evento davanti, ma rilevato da chi viaggiava in direzione opposta.
    expect(isRelevant(at(150, 0, { heading: 180 }), driver())).toBeNull();
  });

  it('segnala un evento con direzione concorde', () => {
    expect(isRelevant(at(150, 0, { heading: 10 }), driver())).not.toBeNull();
  });

  it('senza direzione di marcia segnala solo a distanza ravvicinata', () => {
    const senzaHeading = driver({ heading: null });
    expect(isRelevant(at(40, 200), senzaHeading)).not.toBeNull();
    expect(isRelevant(at(300, 0), senzaHeading)).toBeNull();
  });

  it('la distanza di anticipo cresce con la velocita\'', () => {
    const lontano = at(400, 0);
    expect(isRelevant(lontano, driver({ speedMps: 10 }))).toBeNull();
    expect(isRelevant(lontano, driver({ speedMps: 36 }))).not.toBeNull();
  });
});

describe('AlertEngine', () => {
  it('sceglie l\'evento piu\' vicino', () => {
    const engine = new AlertEngine();
    const alert = engine.evaluate([at(300, 0), at(120, 0)], driver({ speedMps: 30 }), 1000);
    expect(alert?.distanceM).toBeLessThan(200);
  });

  it('non ripete lo stesso alert entro il cooldown', () => {
    const engine = new AlertEngine();
    const clusters = [at(150, 0)];
    expect(engine.evaluate(clusters, driver(), 1000)).not.toBeNull();
    expect(engine.evaluate(clusters, driver(), 1000 + ALERT.cooldownMs / 2)).toBeNull();
    expect(engine.evaluate(clusters, driver(), 1000 + ALERT.cooldownMs + 1)).not.toBeNull();
  });

  it('non genera alert quando non c\'e\' nulla di rilevante', () => {
    const engine = new AlertEngine();
    expect(engine.evaluate([at(150, 180)], driver(), 1000)).toBeNull();
  });

  it('dimentica i cluster non piu\' esistenti', () => {
    const engine = new AlertEngine();
    const c = at(150, 0);
    engine.evaluate([c], driver(), 1000);
    engine.prune(new Set());
    // Dopo la potatura lo stesso cluster puo\' essere riproposto subito.
    expect(engine.evaluate([c], driver(), 1001)).not.toBeNull();
  });

  it('reset azzera lo storico', () => {
    const engine = new AlertEngine();
    const clusters = [at(150, 0)];
    engine.evaluate(clusters, driver(), 1000);
    engine.reset();
    expect(engine.evaluate(clusters, driver(), 1001)).not.toBeNull();
  });
});
