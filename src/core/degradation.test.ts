/**
 * ROAD SENSE - test dei percorsi degradati.
 *
 * Verificano il principio di progressive enhancement: l'assenza di un sensore,
 * di un permesso o della rete non deve mai produrre un errore, ma solo una
 * funzionalita' ridotta.
 */

import { describe, expect, it, vi } from 'vitest';

import { computeMotionSample } from './sensors/PhoneSensorProvider';
import { BleSensorProvider, CyberTyreProvider, ObdSensorProvider, SmartTyreProvider } from './sensors/stubs';
import { SensorEngine } from './SensorEngine';
import { buildDemoEvents } from './demoSeed';
import { buildClusters } from './ConfidenceEngine';
import { installMemoryStorage } from './testUtils';
import type { SensorProvider, SensorProviderEvents } from './sensors/SensorProvider';
import type { SensorCapabilities } from './types';

installMemoryStorage();

/** Provider che simula un dispositivo senza alcun sensore. */
class EmptyProvider implements SensorProvider {
  readonly id = 'empty';
  readonly label = 'nessun sensore';
  errors: string[] = [];

  async probe(): Promise<SensorCapabilities> {
    return {
      geolocation: false,
      accelerometer: false,
      gyroscope: false,
      orientation: false,
      needsMotionPermission: false,
    };
  }
  async requestPermissions(): Promise<SensorCapabilities> {
    return this.probe();
  }
  async start(handlers: SensorProviderEvents): Promise<void> {
    handlers.onError?.({ kind: 'unsupported', message: 'nessun sensore disponibile' });
  }
  stop(): void {}
}

describe('sensori mancanti', () => {
  it('computeMotionSample non esplode senza accelerometro', () => {
    const r = computeMotionSample(0, null, null, null, 0.95);
    expect(r.verticalAccel).toBeNull();
    expect(r.totalAccel).toBeNull();
  });

  it('ricava l\'accelerazione lineare quando il browser non la fornisce', () => {
    // Telefono fermo in verticale: gravita' tutta sull'asse y.
    let gravity: { x: number; y: number; z: number } | null = null;
    let last = null;
    for (let i = 0; i < 200; i++) {
      last = computeMotionSample(i, { x: 0, y: 9.81, z: 0 }, null, gravity, 0.95);
      gravity = last.gravity;
    }
    // A regime la gravita' e' interamente filtrata: nessuna accelerazione residua.
    expect(Math.abs(last?.verticalAccel ?? 99)).toBeLessThan(0.05);
  });

  it('compensa l\'orientamento: telefono inclinato, urto verticale reale', () => {
    // Telefono inclinato a 45 gradi: la gravita' si distribuisce su due assi.
    const g = 9.81 / Math.SQRT2;
    let gravity: { x: number; y: number; z: number } | null = null;
    for (let i = 0; i < 300; i++) {
      gravity = computeMotionSample(i, { x: 0, y: g, z: g }, null, gravity, 0.95).gravity;
    }
    // Urto di 5 m/s^2 lungo la verticale reale (stessa direzione della gravita').
    const urto = computeMotionSample(
      999,
      { x: 0, y: g, z: g },
      { x: 0, y: 5 / Math.SQRT2, z: 5 / Math.SQRT2 },
      gravity,
      0.95,
    );
    // L'ampiezza viene ricostruita correttamente nonostante l'inclinazione.
    expect(urto.verticalAccel).toBeCloseTo(5, 1);
  });

  it('SensorEngine parte anche senza alcun sensore', async () => {
    const provider = new EmptyProvider();
    const engine = new SensorEngine(provider);
    const errors: string[] = [];
    const caps = await engine.start({ onError: (e) => errors.push(e.message) });
    expect(caps.geolocation).toBe(false);
    expect(errors).toHaveLength(1);
    expect(engine.isRunning()).toBe(true);
    engine.stop();
    expect(engine.isRunning()).toBe(false);
  });

  it('gli stub dei provider futuri segnalano l\'indisponibilita\' senza lanciare', async () => {
    for (const provider of [
      new BleSensorProvider(),
      new ObdSensorProvider(),
      new SmartTyreProvider(),
      new CyberTyreProvider(),
    ]) {
      const messages: string[] = [];
      await expect(provider.probe()).resolves.toBeTruthy();
      await provider.start({ onError: (e) => messages.push(e.message) });
      expect(messages).toHaveLength(1);
      expect(() => provider.stop()).not.toThrow();
    }
  });
});

describe('backend non disponibile', () => {
  it('senza VITE_API_BASE non viene effettuata alcuna chiamata di rete', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { backendEnabled, fetchNearby, postEvents } = await import('../net/api');

    expect(backendEnabled()).toBe(false);
    await expect(fetchNearby(45, 9, 1000)).resolves.toEqual([]);
    await expect(
      postEvents([
        {
          id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
          lat: 45,
          lon: 9,
          ts: Date.now(),
          type: 'pothole',
          severity: 2,
          source: 'auto',
          confidence: 0.4,
          heading: null,
          reporterId: '0123456789abcdef',
        },
      ]),
    ).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('modalita\' demo', () => {
  it('genera eventi marcati demo e aggregabili', () => {
    const center = { lat: 45.4642, lon: 9.19 };
    const events = buildDemoEvents(center, 900);
    expect(events.length).toBeGreaterThan(5);
    expect(events.every((e) => e.demo === true)).toBe(true);

    const clusters = buildClusters(events);
    // Cinque punti distinti lungo l'anello.
    expect(clusters).toHaveLength(5);
    // Il punto con piu' segnalatori indipendenti deve risultare piu' affidabile.
    const sorted = [...clusters].sort((a, b) => b.reporters - a.reporters);
    expect(sorted[0]!.confidence).toBeGreaterThan(sorted[sorted.length - 1]!.confidence);
  });

  it('gli eventi demo sono tutti riconoscibili come tali nei cluster', () => {
    const clusters = buildClusters(buildDemoEvents({ lat: 45.4642, lon: 9.19 }, 900));
    expect(clusters.every((c) => c.demo === true)).toBe(true);
  });
});
