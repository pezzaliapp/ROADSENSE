/**
 * ROAD SENSE - test di integrazione della DEMO MODE.
 *
 * Percorre l'intera catena senza browser e senza guidare:
 *   DemoSensorProvider -> SensorEngine -> DetectionEngine -> EventStore
 *                                                        -> ConfidenceEngine
 *                                                        -> AlertEngine
 * E' la verifica che il requisito "provare ROAD SENSE dal Mac" funzioni davvero.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertEngine } from './AlertEngine';
import { buildClusters } from './ConfidenceEngine';
import { DetectionEngine, type Detection } from './DetectionEngine';
import { EventStore } from './EventStore';
import { SensorEngine } from './SensorEngine';
import { newEventId } from './anonId';
import { buildDemoEvents } from './demoSeed';
import { DemoSensorProvider } from './sensors/DemoSensorProvider';
import { installMemoryStorage } from './testUtils';
import type { GeoSample, RoadEvent } from './types';

const storage = installMemoryStorage();
const CENTER = { lat: 45.4642, lon: 9.19 };
const RADIUS = 900;

describe('catena completa in DEMO MODE', () => {
  beforeEach(() => {
    storage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rileva automaticamente le anomalie simulate lungo il percorso', async () => {
    const provider = new DemoSensorProvider({ center: CENTER, radiusM: RADIUS, speedMps: 14 });
    const engine = new SensorEngine(provider);
    const detector = new DetectionEngine();
    const detections: Detection[] = [];
    const positions: GeoSample[] = [];

    await engine.start({
      onSample: (s) => {
        const d = detector.push(s);
        if (d) detections.push(d);
      },
      onGeo: (g) => positions.push(g),
    });

    // Due minuti di guida simulata: si supera la prima anomalia dell'anello.
    await vi.advanceTimersByTimeAsync(120_000);
    engine.stop();

    expect(positions.length).toBeGreaterThan(100);
    expect(detections.length).toBeGreaterThan(0);
    expect(detections.every((d) => d.type === 'pothole')).toBe(true);
    // Ogni rilevamento porta con se' posizione e direzione utilizzabili.
    for (const d of detections) {
      expect(Number.isFinite(d.lat)).toBe(true);
      expect(Number.isFinite(d.lon)).toBe(true);
      expect(d.speedMps).toBeGreaterThan(0);
      expect(d.confidence).toBeGreaterThan(0);
      expect(d.confidence).toBeLessThanOrEqual(0.6);
    }
  });

  it('non genera rilevamenti a veicolo fermo', async () => {
    const provider = new DemoSensorProvider({ center: CENTER, radiusM: RADIUS, speedMps: 0 });
    const engine = new SensorEngine(provider);
    const detector = new DetectionEngine();
    let detected = 0;

    await engine.start({
      onSample: (s) => {
        if (detector.push(s)) detected++;
      },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    engine.stop();

    expect(detected).toBe(0);
  });

  it('gli eventi demo restano isolati dall\'archivio reale', async () => {
    const demoStore = new EventStore(true);
    const realStore = new EventStore(false);

    demoStore.add(buildDemoEvents(CENTER, RADIUS, Date.now()));
    expect(demoStore.all().length).toBeGreaterThan(0);
    expect(realStore.all()).toHaveLength(0);
  });

  it('produce alert avvicinandosi a un evento demo davanti al veicolo', async () => {
    const now = Date.now();
    const store = new EventStore(true);
    store.add(buildDemoEvents(CENTER, RADIUS, now), now);

    const provider = new DemoSensorProvider({ center: CENTER, radiusM: RADIUS, speedMps: 14 });
    const engine = new SensorEngine(provider);
    const alertEngine = new AlertEngine();
    const alerts: string[] = [];

    await engine.start({
      onGeo: (g) => {
        const clusters = buildClusters(store.all(g.ts), g.ts);
        const alert = alertEngine.evaluate(
          clusters,
          { lat: g.lat, lon: g.lon, heading: g.heading, speedMps: g.speedMps },
          g.ts,
        );
        if (alert) alerts.push(alert.cluster.type);
      },
    });

    // Un giro completo dell'anello (~404 s a 14 m/s).
    await vi.advanceTimersByTimeAsync(420_000);
    engine.stop();

    expect(alerts.length).toBeGreaterThan(0);
  });

  it('un rilevamento demo confluisce nell\'archivio e diventa un cluster', () => {
    const now = Date.now();
    const store = new EventStore(true);
    const event: RoadEvent = {
      id: newEventId(),
      lat: CENTER.lat,
      lon: CENTER.lon,
      ts: now,
      type: 'pothole',
      severity: 2,
      source: 'auto',
      confidence: 0.45,
      heading: 90,
      reporterId: '0123456789abcdef',
      demo: true,
    };
    store.add([event], now);

    const clusters = buildClusters(store.all(now), now);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.demo).toBe(true);
    expect(clusters[0]?.confidence).toBeGreaterThan(0);
  });
});
