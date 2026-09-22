/**
 * ROAD SENSE - verifiche sulla DEMO MODE basata su percorso stradale reale.
 *
 * Coprono il tracciato, il moto del veicolo simulato e il posizionamento degli
 * eventi, piu' una guardia sul fatto che il GPS reale non sia stato toccato.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO } from '../config/config';
import { angleDeltaDeg, bearingDeg, distanceM } from '../core/geo';
import { buildDemoEvents } from '../core/demoSeed';
import { DemoSensorProvider } from '../core/sensors/DemoSensorProvider';
import { installMemoryStorage } from '../core/testUtils';
import type { GeoSample } from '../core/types';
import { DEMO_ROUTE, DEMO_ROUTE_LENGTH_M } from './demoRoute';
import {
  distanceAlongNearest,
  distanceFromRoute,
  positionAtDistance,
  ROUTE_LENGTH_M,
  wrapDistance,
} from './route';

installMemoryStorage();

/** Riquadro generoso attorno a Milano: intercetta coordinate invertite o errate. */
const MILAN_BBOX = { minLat: 45.3, maxLat: 45.6, minLon: 9.0, maxLon: 9.4 };

describe('tracciato della demo', () => {
  it('contiene abbastanza punti da seguire le strade', () => {
    expect(DEMO_ROUTE.length).toBeGreaterThan(40);
  });

  it('e\' composto da coordinate valide e plausibili', () => {
    for (const [lat, lon] of DEMO_ROUTE) {
      expect(Number.isFinite(lat)).toBe(true);
      expect(Number.isFinite(lon)).toBe(true);
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
      // Se latitudine e longitudine venissero invertite, questo fallirebbe.
      expect(lat).toBeGreaterThan(MILAN_BBOX.minLat);
      expect(lat).toBeLessThan(MILAN_BBOX.maxLat);
      expect(lon).toBeGreaterThan(MILAN_BBOX.minLon);
      expect(lon).toBeLessThan(MILAN_BBOX.maxLon);
    }
  });

  it('non contiene punti consecutivi coincidenti', () => {
    for (let i = 0; i + 1 < DEMO_ROUTE.length; i++) {
      const a = DEMO_ROUTE[i]!;
      const b = DEMO_ROUTE[i + 1]!;
      expect(distanceM({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] })).toBeGreaterThan(0.5);
    }
  });

  it('e\' un anello chiuso, quindi puo\' ricominciare senza salti', () => {
    const first = DEMO_ROUTE[0]!;
    const last = DEMO_ROUTE[DEMO_ROUTE.length - 1]!;
    expect(distanceM({ lat: first[0], lon: first[1] }, { lat: last[0], lon: last[1] })).toBeLessThan(2);
  });

  it('dichiara una lunghezza coerente con la geometria', () => {
    expect(ROUTE_LENGTH_M).toBeGreaterThan(2000);
    expect(Math.abs(ROUTE_LENGTH_M - DEMO_ROUTE_LENGTH_M)).toBeLessThan(5);
  });
});

describe('interpolazione lungo il percorso', () => {
  it('ogni posizione interpolata giace sul tracciato', () => {
    for (let d = 0; d < ROUTE_LENGTH_M; d += 37) {
      const p = positionAtDistance(d);
      // La distanza e' calcolata punto-segmento: un punto interpolato sul
      // tracciato deve risultare praticamente a distanza nulla.
      expect(distanceFromRoute(p)).toBeLessThan(0.5);
    }
  });

  it('l\'heading coincide con la direzione verso il punto successivo', () => {
    let verificati = 0;
    for (let d = 0; d < ROUTE_LENGTH_M - 10; d += 7) {
      const here = positionAtDistance(d);
      const ahead = positionAtDistance(d + 2);
      // Se fra i due campioni cade un vertice, la corda taglia l'angolo e il
      // confronto non avrebbe senso: quei casi si saltano.
      if (angleDeltaDeg(here.heading, ahead.heading) > 0.5) continue;
      expect(angleDeltaDeg(here.heading, bearingDeg(here, ahead))).toBeLessThan(5);
      verificati++;
    }
    expect(verificati).toBeGreaterThan(500);
  });

  it('riporta le distanze nell\'anello', () => {
    expect(wrapDistance(-1)).toBeCloseTo(ROUTE_LENGTH_M - 1, 3);
    expect(wrapDistance(ROUTE_LENGTH_M + 10)).toBeCloseTo(10, 3);
    expect(wrapDistance(0)).toBe(0);
  });

  it('la posizione a fine percorso coincide con quella iniziale', () => {
    const start = positionAtDistance(0);
    const end = positionAtDistance(ROUTE_LENGTH_M);
    expect(distanceM(start, end)).toBeLessThan(2);
  });
});

describe('veicolo simulato', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Raccoglie le posizioni emesse per un certo tempo simulato. */
  async function drive(ms: number, options = {}) {
    const provider = new DemoSensorProvider({ motionHz: 20, ...options });
    const samples: GeoSample[] = [];
    await provider.start({ onGeo: (g) => samples.push(g) });
    await vi.advanceTimersByTimeAsync(ms);
    provider.stop();
    return { provider, samples };
  }

  it('resta sempre sulla carreggiata, non taglia gli isolati', async () => {
    const { samples } = await drive(180_000);
    expect(samples.length).toBeGreaterThan(100);
    for (const s of samples) {
      expect(distanceFromRoute({ lat: s.lat, lon: s.lon })).toBeLessThan(3);
    }
  });

  it('percorre i punti del tracciato nell\'ordine previsto', async () => {
    const { samples } = await drive(180_000, { startDistanceM: 400 });
    // Ogni posizione emessa si trova piu' avanti della precedente lungo il
    // tracciato: il veicolo non salta indietro ne' taglia da un punto a un
    // altro. Il suggerimento evita l'ambiguita' fra inizio e fine dell'anello.
    let previous = 400;
    let avanzamento = 0;
    for (const s of samples) {
      const d = distanceAlongNearest(s, previous);
      expect(d).toBeGreaterThanOrEqual(previous - 2);
      avanzamento += d - previous;
      previous = d;
    }
    expect(avanzamento).toBeGreaterThan(500);
  });

  it('mantiene una velocita\' da guida urbana', async () => {
    const { samples } = await drive(240_000);
    for (const s of samples) {
      expect(s.speedMps).not.toBeNull();
      expect(s.speedMps as number).toBeGreaterThanOrEqual(DEMO.minSpeedMps - 0.01);
      expect(s.speedMps as number).toBeLessThanOrEqual(DEMO.maxSpeedMps + 0.01);
    }
    // La velocita' deve variare davvero, non essere costante.
    const speeds = samples.map((s) => s.speedMps as number);
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeGreaterThan(1);
  });

  it('varia la velocita\' in modo graduale', async () => {
    const { samples } = await drive(240_000);
    for (let i = 1; i < samples.length; i++) {
      const delta = Math.abs((samples[i]!.speedMps as number) - (samples[i - 1]!.speedMps as number));
      // Meno di 2 m/s al secondo: circa 0.2 g, una variazione confortevole.
      expect(delta).toBeLessThan(2);
    }
  });

  it('ricava la direzione dai punti consecutivi del tracciato', async () => {
    const { samples } = await drive(180_000, { startDistanceM: 400 });
    let previous = 400;
    for (const s of samples) {
      expect(s.heading).not.toBeNull();
      const d = distanceAlongNearest(s, previous);
      previous = d;
      // La direzione emessa e' quella del segmento su cui il veicolo si trova.
      // `d` e' una stima al paio di metri: proprio sopra un vertice puo'
      // cadere sul segmento precedente o su quello seguente, che hanno
      // direzioni diverse. Si accetta la corrispondenza con uno dei due.
      const candidati = [d - 3, d, d + 3].map((x) => positionAtDistance(x).heading);
      const scarto = Math.min(
        ...candidati.map((h) => angleDeltaDeg(s.heading as number, h)),
      );
      expect(scarto).toBeLessThan(10);
    }
  });

  it('la direzione concorda con lo spostamento sui tratti rettilinei', async () => {
    const { samples } = await drive(180_000, { startDistanceM: 400 });
    let confronti = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      if (distanceM(a, b) < 5) continue;
      // Su un tratto curvo la corda fra due posizioni taglia l'angolo: si
      // confrontano solo i tratti in cui la direzione non e' cambiata.
      if (angleDeltaDeg(a.heading as number, b.heading as number) > 5) continue;
      expect(angleDeltaDeg(a.heading as number, bearingDeg(a, b))).toBeLessThan(15);
      confronti++;
    }
    expect(confronti).toBeGreaterThan(40);
  });

  it('ricomincia dall\'inizio al termine del percorso', async () => {
    // Si parte a 60 m dalla fine: bastano pochi secondi per chiudere il giro.
    const { provider, samples } = await drive(30_000, {
      startDistanceM: ROUTE_LENGTH_M - 60,
      fixedSpeedMps: 10,
    });
    expect(provider.laps()).toBe(1);
    // Dopo il giro la distanza e' ripartita da zero, non e' esplosa.
    expect(provider.distanceTravelled()).toBeLessThan(ROUTE_LENGTH_M);
    expect(provider.distanceTravelled()).toBeGreaterThan(0);
    // E nessuna posizione e' uscita dal tracciato durante il ricongiungimento.
    for (const s of samples) {
      expect(distanceFromRoute({ lat: s.lat, lon: s.lon })).toBeLessThan(3);
    }
  });

  it('non avanza a veicolo fermo', async () => {
    const { provider } = await drive(30_000, { fixedSpeedMps: 0 });
    expect(provider.distanceTravelled()).toBe(0);
  });
});

describe('eventi demo', () => {
  it('sono collocati sulla carreggiata o a ridosso di essa', () => {
    for (const e of buildDemoEvents()) {
      // Scostamento laterale piu' dispersione tra segnalatori.
      expect(distanceFromRoute({ lat: e.lat, lon: e.lon })).toBeLessThan(15);
    }
  });

  it('ereditano la direzione della strada su cui si trovano', () => {
    for (const e of buildDemoEvents()) {
      expect(e.heading).not.toBeNull();
      const nearest = positionAtDistance(distanceAlongNearest(e));
      expect(angleDeltaDeg(e.heading as number, nearest.heading)).toBeLessThan(45);
    }
  });

  it('sono tutti marcati come demo', () => {
    expect(buildDemoEvents().every((e) => e.demo === true)).toBe(true);
  });

  it('sono distribuiti lungo tutto il percorso, non ammassati', () => {
    const distances = buildDemoEvents().map((e) => distanceAlongNearest(e));
    expect(Math.max(...distances) - Math.min(...distances)).toBeGreaterThan(ROUTE_LENGTH_M * 0.5);
  });
});

describe('GPS reale non toccato', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '..', 'core', 'sensors', 'PhoneSensorProvider.ts'),
    'utf8',
  );

  it('PhoneSensorProvider non conosce la demo', () => {
    expect(source).not.toMatch(/demoRoute|demo\/route|DemoSensorProvider|DEMO_ROUTE/);
  });

  it('PhoneSensorProvider continua a usare la geolocalizzazione del dispositivo', () => {
    expect(source).toMatch(/navigator\.geolocation\.watchPosition/);
    expect(source).toMatch(/navigator\.geolocation\.clearWatch/);
  });

  it('nessun aggancio alla rete stradale e\' stato introdotto nel percorso reale', () => {
    // Il GPS reale deve restituire la posizione fornita dal dispositivo,
    // senza correzioni verso una strada.
    expect(source).not.toMatch(/mapMatch|snapToRoad|matchToRoute/i);
  });
});

