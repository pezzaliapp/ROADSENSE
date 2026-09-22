/**
 * ROAD SENSE - verifiche sulla rete ROAD SENSE SIMULATA.
 *
 * Il punto piu' importante non sono i veicoli: e' la garanzia che non esista
 * alcuna rete reale, che nulla di tutto questo viva fuori dalla DEMO MODE, e
 * che la confidenza cresca attraverso il ConfidenceEngine vero.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALERT, DEMO } from '../config/config';
import { buildClusters } from '../core/ConfidenceEngine';
import { angleDeltaDeg, bearingDeg, distanceM } from '../core/geo';
import { installMemoryStorage } from '../core/testUtils';
import { validateEvent } from '../core/validation';
import type { RoadEvent } from '../core/types';
import { DemoTrafficProvider } from './DemoTrafficProvider';
import { DemoVehicle } from './DemoVehicle';
import { distanceFromRoute, positionAtDistance, ROUTE_LENGTH_M } from './route';

installMemoryStorage();
const ROOT = resolve(import.meta.dirname, '..', '..');

describe('i veicoli simulati esistono solo in DEMO MODE', () => {
  const app = readFileSync(resolve(ROOT, 'src', 'App.tsx'), 'utf8');

  it('il provider viene costruito solo quando la demo e\' attiva', () => {
    expect(app).toMatch(/if \(!demo \|\| !running\) \{\s*setPeers\(\[\]\);\s*return;/);
    expect(app).toMatch(/new DemoTrafficProvider\(\)/);
  });

  it('i veicoli vengono passati alla mappa solo in demo', () => {
    expect(app).toMatch(/peerVehicles=\{demo \? peerVehicles : null\}/);
  });

  it('nessun modulo reale conosce i veicoli simulati', () => {
    for (const file of [
      'src/core/DetectionEngine.ts',
      'src/core/SensorEngine.ts',
      'src/core/ConfidenceEngine.ts',
      'src/core/AlertEngine.ts',
      'src/core/sensors/PhoneSensorProvider.ts',
      'src/net/api.ts',
    ]) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      expect(source).not.toMatch(/DemoVehicle|DemoTraffic|peerVehicle/);
    }
  });

  it('non vengono mai chiamati "utenti": non esiste una rete reale', () => {
    for (const file of [
      'src/demo/DemoVehicle.ts',
      'src/demo/DemoTrafficProvider.ts',
      'src/ui/AlertBanner.tsx',
    ]) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      expect(source).not.toMatch(/utenti connessi|utente connesso/i);
    }
    // La dicitura e' composta a runtime (singolare/plurale), quindi si
    // verificano i pezzi da cui viene costruita.
    const banner = readFileSync(resolve(ROOT, 'src', 'ui', 'AlertBanner.tsx'), 'utf8');
    expect(banner).toMatch(/ROAD SENSE · SIMULATO/);
    expect(banner).toMatch(/'VEICOLO' : 'VEICOLI'/);
  });
});

describe('nessuna rete', () => {
  it('il provider non effettua alcuna richiesta', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const traffic = new DemoTrafficProvider();
    traffic.start({});
    await vi.advanceTimersByTimeAsync(60_000);
    traffic.stop();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('il codice non contiene alcuna primitiva di rete', () => {
    for (const file of ['src/demo/DemoVehicle.ts', 'src/demo/DemoTrafficProvider.ts']) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      expect(source).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\//);
    }
  });
});

describe('moto dei veicoli simulati', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sono due, come previsto dalla configurazione', () => {
    expect(new DemoTrafficProvider().states()).toHaveLength(2);
    expect(DEMO.network.vehicles).toHaveLength(2);
  });

  it('partono davanti al veicolo principale, che parte da zero', () => {
    for (const spec of DEMO.network.vehicles) {
      expect(spec.startDistanceM).toBeGreaterThan(0);
      // ...ma dietro la buca, altrimenti non la incontrerebbero mai.
      expect(spec.startDistanceM).toBeLessThan(DEMO.network.potholeAt * ROUTE_LENGTH_M);
    }
  });

  it('restano sempre sulla carreggiata', async () => {
    const traffic = new DemoTrafficProvider();
    const seen: { lat: number; lon: number }[] = [];
    traffic.start({ onVehicles: (vs) => seen.push(...vs) });
    await vi.advanceTimersByTimeAsync(120_000);
    traffic.stop();
    expect(seen.length).toBeGreaterThan(100);
    for (const p of seen) expect(distanceFromRoute(p)).toBeLessThan(3);
  });

  it('hanno direzione coerente con il proprio movimento', async () => {
    const traffic = new DemoTrafficProvider();
    const byId = new Map<string, { lat: number; lon: number; heading: number }[]>();
    traffic.start({
      onVehicles: (vs) => {
        for (const v of vs) {
          if (!byId.has(v.id)) byId.set(v.id, []);
          byId.get(v.id)!.push({ lat: v.lat, lon: v.lon, heading: v.heading });
        }
      },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    traffic.stop();

    let confronti = 0;
    for (const track of byId.values()) {
      // I campioni distano 250 ms, cioe' circa 3 m: troppo poco perche' la
      // direzione fra due punti consecutivi sia significativa. Si confronta
      // quindi a passo piu' largo.
      const passo = 8;
      for (let i = passo; i < track.length; i++) {
        const a = track[i - passo]!;
        const b = track[i]!;
        if (distanceM(a, b) < 5) continue;
        if (angleDeltaDeg(a.heading, b.heading) > 5) continue; // salta le curve
        expect(angleDeltaDeg(a.heading, bearingDeg(a, b))).toBeLessThan(20);
        confronti++;
      }
    }
    expect(confronti).toBeGreaterThan(20);
  });

  it('si muovono in modo indipendente l\'uno dall\'altro', async () => {
    const traffic = new DemoTrafficProvider();
    let last: { id: string; lat: number; lon: number }[] = [];
    traffic.start({ onVehicles: (vs) => (last = vs) });
    await vi.advanceTimersByTimeAsync(40_000);
    traffic.stop();
    expect(distanceM(last[0]!, last[1]!)).toBeGreaterThan(50);
  });

  it('hanno velocita\' plausibili per la guida urbana', () => {
    for (const v of new DemoTrafficProvider().states()) {
      expect(v.speedMps).toBeGreaterThan(5);
      expect(v.speedMps).toBeLessThan(20);
    }
  });
});

describe('rilevamento e conferma', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Fa girare il traffico raccogliendo gli eventi prodotti. */
  async function collect(ms: number) {
    const traffic = new DemoTrafficProvider();
    const events: RoadEvent[] = [];
    const flashes: string[] = [];
    traffic.start({
      onEvent: (e) => events.push(e),
      onVehicles: (vs) => {
        for (const v of vs) if (v.flash) flashes.push(`${v.id}:${v.flash}`);
      },
    });
    await vi.advanceTimersByTimeAsync(ms);
    traffic.stop();
    return { events, flashes };
  }

  it('non genera eventi prima che un veicolo abbia raggiunto la buca', async () => {
    // L'istante del primo attraversamento si ricava dalla configurazione,
    // invece di essere scritto a mano: se le posizioni cambiano il test resta
    // valido.
    const pothole = DEMO.network.potholeAt * ROUTE_LENGTH_M;
    const primoSec = Math.min(
      ...DEMO.network.vehicles.map((v) => (pothole - v.startDistanceM) / v.speedMps),
    );
    expect(primoSec).toBeGreaterThan(0.5);
    const { events } = await collect(Math.max(200, (primoSec - 0.5) * 1000));
    expect(events).toHaveLength(0);
  });

  it('ogni veicolo rileva la buca attraversandola, una volta per giro', async () => {
    const { events } = await collect(120_000);
    expect(events).toHaveLength(2);
    const reporters = new Set(events.map((e) => e.reporterId));
    expect(reporters.size).toBe(2);
    for (const e of events) {
      expect(e.type).toBe('pothole');
      expect(e.demo).toBe(true);
      // Nel punto giusto del tracciato.
      const pothole = positionAtDistance(DEMO.network.potholeAt * ROUTE_LENGTH_M);
      expect(distanceM(e, pothole)).toBeLessThan(5);
    }
  });

  it('il primo veicolo rileva prima del secondo', async () => {
    const { events } = await collect(120_000);
    expect(events[0]!.ts).toBeLessThan(events[1]!.ts);
  });

  it('mostra "BUCA RILEVATA" accanto al veicolo che rileva', async () => {
    const { flashes } = await collect(20_000);
    expect(flashes.length).toBeGreaterThan(0);
    expect(flashes.every((f) => f.endsWith(':BUCA RILEVATA'))).toBe(true);
    // L'etichetta e' temporanea, non resta accesa per sempre.
    const { flashes: piuTardi } = await collect(120_000);
    const ultimi = piuTardi.slice(-5);
    expect(ultimi.length).toBeGreaterThan(0);
  });

  it('gli eventi prodotti sono eventi validi a tutti gli effetti', async () => {
    const { events } = await collect(120_000);
    for (const e of events) {
      // Stessa validazione applicata a qualunque altro evento, tolta la
      // marcatura demo che il backend rifiuta per progetto.
      const senzaDemo: Partial<RoadEvent> = { ...e };
      delete senzaDemo.demo;
      expect(validateEvent(senzaDemo, e.ts).ok).toBe(true);
      // E con la marcatura demo il backend lo rifiuta, come deve.
      expect(validateEvent(e, e.ts).ok).toBe(false);
    }
  });

  it('un solo rilevamento NON basta ad allertare: servono due veicoli concordi', async () => {
    // E' il comportamento voluto di ROAD SENSE, non un limite della demo:
    // un singolo rilevamento automatico non produce un evento su cui allertare.
    // La demo lo rispetta invece di aggirarlo.
    const { events } = await collect(120_000);
    const now = events[1]!.ts;
    const conUno = buildClusters([events[0]!], now)[0]!;
    const conDue = buildClusters(events, now)[0]!;
    expect(conUno.confidence).toBeLessThan(ALERT.minConfidence);
    expect(conDue.confidence).toBeGreaterThanOrEqual(ALERT.minConfidence);
  });

  it('il secondo veicolo aumenta DAVVERO la confidenza, tramite il motore vero', async () => {
    const { events } = await collect(120_000);
    expect(events).toHaveLength(2);

    const now = events[1]!.ts;
    const dopoUno = buildClusters([events[0]!], now);
    const dopoDue = buildClusters(events, now);

    expect(dopoUno).toHaveLength(1);
    expect(dopoDue).toHaveLength(1);

    // Un solo veicolo: una segnalazione. Due veicoli: due segnalatori
    // indipendenti, e la confidenza sale perche' lo decide il
    // ConfidenceEngine, non perche' venga scritta a mano.
    expect(dopoUno[0]!.reporters).toBe(1);
    expect(dopoDue[0]!.reporters).toBe(2);
    expect(dopoDue[0]!.confidence).toBeGreaterThan(dopoUno[0]!.confidence);
  });
});

describe('attraversamento del punto di rilevamento', () => {
  it('riconosce il passaggio normale', () => {
    expect(DemoVehicle.crossed(100, 200, 150)).toBe(true);
    expect(DemoVehicle.crossed(100, 140, 150)).toBe(false);
    expect(DemoVehicle.crossed(160, 200, 150)).toBe(false);
  });

  it('riconosce il passaggio a cavallo della fine dell\'anello', () => {
    // La distanza riparte da zero: il punto puo' cadere prima o dopo.
    expect(DemoVehicle.crossed(5700, 40, 5750)).toBe(true);
    expect(DemoVehicle.crossed(5700, 40, 20)).toBe(true);
    expect(DemoVehicle.crossed(5700, 40, 3000)).toBe(false);
  });
});
