import { describe, expect, it } from 'vitest';
import {
  angleDeltaDeg,
  averageHeading,
  bearingDeg,
  destinationPoint,
  distanceM,
  formatDistance,
  normalizeDeg,
  roundCoord,
} from './geo';

describe('distanceM', () => {
  it('e\' nulla tra un punto e se stesso', () => {
    expect(distanceM({ lat: 45.46, lon: 9.19 }, { lat: 45.46, lon: 9.19 })).toBe(0);
  });

  it('corrisponde alla distanza nota Milano-Roma (~477 km)', () => {
    const d = distanceM({ lat: 45.4642, lon: 9.19 }, { lat: 41.9028, lon: 12.4964 });
    expect(d / 1000).toBeGreaterThan(470);
    expect(d / 1000).toBeLessThan(485);
  });

  it('e\' simmetrica', () => {
    const a = { lat: 45.1, lon: 9.1 };
    const b = { lat: 45.2, lon: 9.3 };
    expect(distanceM(a, b)).toBeCloseTo(distanceM(b, a), 6);
  });

  it('misura circa 111 km per un grado di latitudine', () => {
    const d = distanceM({ lat: 45, lon: 9 }, { lat: 46, lon: 9 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_500);
  });
});

describe('bearingDeg', () => {
  it('indica il nord', () => {
    expect(bearingDeg({ lat: 45, lon: 9 }, { lat: 46, lon: 9 })).toBeCloseTo(0, 3);
  });

  it('indica l\'est', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 3);
  });

  it('indica il sud', () => {
    expect(bearingDeg({ lat: 46, lon: 9 }, { lat: 45, lon: 9 })).toBeCloseTo(180, 3);
  });

  it('restituisce sempre un valore in [0, 360)', () => {
    const b = bearingDeg({ lat: 45, lon: 9 }, { lat: 45, lon: 8 });
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
    // Non esattamente 270: lungo un'ortodromia verso ovest alle medie
    // latitudini la direzione iniziale devia leggermente verso nord.
    expect(b).toBeCloseTo(270.35, 1);
  });
});

describe('angleDeltaDeg', () => {
  it('gestisce l\'attraversamento dello zero', () => {
    expect(angleDeltaDeg(350, 10)).toBe(20);
    expect(angleDeltaDeg(10, 350)).toBe(20);
  });

  it('non supera mai 180', () => {
    expect(angleDeltaDeg(0, 270)).toBe(90);
    expect(angleDeltaDeg(0, 180)).toBe(180);
  });
});

describe('destinationPoint', () => {
  it('produce un punto alla distanza richiesta', () => {
    const origin = { lat: 45.4642, lon: 9.19 };
    const dest = destinationPoint(origin, 45, 1000);
    expect(distanceM(origin, dest)).toBeCloseTo(1000, 0);
  });

  it('e\' coerente con bearingDeg', () => {
    const origin = { lat: 45.4642, lon: 9.19 };
    const dest = destinationPoint(origin, 123, 500);
    expect(bearingDeg(origin, dest)).toBeCloseTo(123, 1);
  });
});

describe('averageHeading', () => {
  it('media correttamente attorno allo zero', () => {
    expect(averageHeading([350, 10])).toBeCloseTo(0, 5);
  });

  it('restituisce null su direzioni opposte', () => {
    expect(averageHeading([0, 180])).toBeNull();
  });

  it('restituisce null su insieme vuoto', () => {
    expect(averageHeading([])).toBeNull();
  });
});

describe('utilita\' di formato', () => {
  it('arrotonda le coordinate', () => {
    expect(roundCoord(45.123456789, 5)).toBe(45.12346);
  });

  it('formatta metri e chilometri', () => {
    expect(formatDistance(183)).toBe('180 m');
    expect(formatDistance(1500)).toBe('1,5 km');
    expect(formatDistance(NaN)).toBe('--');
  });

  it('normalizza gli angoli negativi', () => {
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(450)).toBe(90);
  });
});
