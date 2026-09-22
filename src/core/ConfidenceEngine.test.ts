import { describe, expect, it } from 'vitest';
import { CONFIDENCE, MERGE_RADIUS_M, TTL_MS } from '../config/config';
import { buildClusters, clusterConfidence, confidenceLevel, isExpired } from './ConfidenceEngine';
import { destinationPoint } from './geo';
import type { EventType, RoadEvent } from './types';

const BASE = { lat: 45.4642, lon: 9.19 };
const NOW = 1_700_000_000_000;

let counter = 0;
function ev(overrides: Partial<RoadEvent> = {}): RoadEvent {
  counter++;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    lat: BASE.lat,
    lon: BASE.lon,
    ts: NOW,
    type: 'pothole' as EventType,
    severity: 1,
    source: 'auto',
    confidence: 0.4,
    heading: 90,
    reporterId: String(counter).padStart(16, '0'),
    ...overrides,
  };
}

describe('aggregazione', () => {
  it('unisce rilevamenti vicini dello stesso tipo', () => {
    const near = destinationPoint(BASE, 0, 10); // 10 m, dentro il raggio buca (20 m)
    const clusters = buildClusters([ev(), ev({ lat: near.lat, lon: near.lon })], NOW);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.count).toBe(2);
    expect(clusters[0]?.reporters).toBe(2);
  });

  it('non unisce rilevamenti oltre il raggio della categoria', () => {
    const far = destinationPoint(BASE, 0, MERGE_RADIUS_M.pothole + 30);
    const clusters = buildClusters([ev(), ev({ lat: far.lat, lon: far.lon })], NOW);
    expect(clusters).toHaveLength(2);
  });

  it('non unisce tipi diversi nello stesso punto', () => {
    const clusters = buildClusters([ev(), ev({ type: 'water' })], NOW);
    expect(clusters).toHaveLength(2);
  });

  it('usa un raggio piu\' ampio per i lavori che per le buche', () => {
    const p = destinationPoint(BASE, 0, 60);
    const buche = buildClusters([ev(), ev({ lat: p.lat, lon: p.lon })], NOW);
    const lavori = buildClusters(
      [ev({ type: 'roadworks' }), ev({ type: 'roadworks', lat: p.lat, lon: p.lon })],
      NOW,
    );
    expect(buche).toHaveLength(2);
    expect(lavori).toHaveLength(1);
  });

  it('eredita una direzione quando i rilevamenti sono concordi', () => {
    const clusters = buildClusters([ev({ heading: 88 }), ev({ heading: 92 })], NOW);
    expect(clusters[0]?.heading).toBeCloseTo(90, 0);
  });

  it('non assegna direzione quando i rilevamenti sono opposti', () => {
    const clusters = buildClusters([ev({ heading: 0 }), ev({ heading: 180 })], NOW);
    expect(clusters[0]?.heading).toBeNull();
  });

  it('assegna la severita\' massima del gruppo', () => {
    const clusters = buildClusters([ev({ severity: 1 }), ev({ severity: 3 })], NOW);
    expect(clusters[0]?.severity).toBe(3);
  });
});

describe('confidenza', () => {
  it('cresce con il numero di segnalatori indipendenti', () => {
    const uno = clusterConfidence([ev({ source: 'manual' })], NOW, TTL_MS.pothole, NOW);
    const due = clusterConfidence(
      [ev({ source: 'manual' }), ev({ source: 'manual' })],
      NOW,
      TTL_MS.pothole,
      NOW,
    );
    const cinque = clusterConfidence(
      Array.from({ length: 5 }, () => ev({ source: 'manual' })),
      NOW,
      TTL_MS.pothole,
      NOW,
    );
    expect(due).toBeGreaterThan(uno);
    expect(cinque).toBeGreaterThan(due);
    expect(cinque).toBeLessThanOrEqual(1);
  });

  it('satura: il decimo segnalatore aggiunge meno del secondo', () => {
    const conf = (n: number) =>
      clusterConfidence(
        Array.from({ length: n }, () => ev({ source: 'manual' })),
        NOW,
        TTL_MS.pothole,
        NOW,
      );
    expect(conf(2) - conf(1)).toBeGreaterThan(conf(10) - conf(9));
  });

  it('un solo segnalatore che ripassa non puo\' produrre un evento confermato', () => {
    const stesso = Array.from({ length: 12 }, () =>
      ev({ source: 'manual', reporterId: 'aaaaaaaaaaaaaaaa' }),
    );
    const confidence = clusterConfidence(stesso, NOW, TTL_MS.pothole, NOW);
    expect(confidence).toBeLessThan(CONFIDENCE.confirmed);
  });

  it('pesa di piu\' una segnalazione manuale di una automatica', () => {
    const manuale = clusterConfidence([ev({ source: 'manual' })], NOW, TTL_MS.pothole, NOW);
    const automatica = clusterConfidence(
      [ev({ source: 'auto', confidence: 0.4 })],
      NOW,
      TTL_MS.pothole,
      NOW,
    );
    expect(manuale).toBeGreaterThan(automatica);
  });

  it('decade con il passare del tempo', () => {
    const fresco = clusterConfidence([ev({ source: 'manual' })], NOW, TTL_MS.water, NOW);
    const vecchio = clusterConfidence(
      [ev({ source: 'manual' })],
      NOW - TTL_MS.water * 0.9,
      TTL_MS.water,
      NOW,
    );
    expect(vecchio).toBeLessThan(fresco);
    expect(vecchio).toBeGreaterThan(0);
  });

  it('resta sempre nell\'intervallo [0, 1]', () => {
    const molti = Array.from({ length: 200 }, () => ev({ source: 'manual', severity: 3 }));
    const c = clusterConfidence(molti, NOW, TTL_MS.pothole, NOW);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});

describe('livelli', () => {
  it('mappa la confidenza sui tre livelli', () => {
    expect(confidenceLevel(0.1)).toBe('possible');
    expect(confidenceLevel(CONFIDENCE.probable)).toBe('probable');
    expect(confidenceLevel(CONFIDENCE.confirmed)).toBe('confirmed');
  });
});

describe('TTL', () => {
  it('considera scaduto un evento oltre il proprio TTL', () => {
    const vecchio = ev({ type: 'accident', ts: NOW - TTL_MS.accident - 1 });
    expect(isExpired(vecchio, NOW)).toBe(true);
  });

  it('applica TTL diversi per categoria', () => {
    const eta = TTL_MS.accident + 60_000;
    expect(isExpired(ev({ type: 'accident', ts: NOW - eta }), NOW)).toBe(true);
    expect(isExpired(ev({ type: 'pothole', ts: NOW - eta }), NOW)).toBe(false);
  });

  it('esclude gli eventi scaduti dai cluster', () => {
    const clusters = buildClusters(
      [ev({ type: 'water', ts: NOW - TTL_MS.water - 1 }), ev({ type: 'water' })],
      NOW,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.count).toBe(1);
  });

  it('espone la scadenza del cluster', () => {
    const clusters = buildClusters([ev({ type: 'accident' })], NOW);
    expect(clusters[0]?.expiresAt).toBe(NOW + TTL_MS.accident);
  });
});
