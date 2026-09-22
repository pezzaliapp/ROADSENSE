/**
 * ROAD SENSE - verifiche sulla simulazione ROAD WEATHER.
 *
 * Il punto piu' importante di questo file non e' il meteo: e' la garanzia che
 * il meteo NON esista fuori dalla DEMO MODE e che NOWCAST non sia collegato.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { WEATHER } from '../config/config';
import { buildClusters } from '../core/ConfidenceEngine';
import { buildDemoEvents } from '../core/demoSeed';
import { angleDeltaDeg, bearingDeg, destinationPoint, distanceM } from '../core/geo';
import { installMemoryStorage } from '../core/testUtils';
import { positionAtDistance, distanceFromRoute, ROUTE_LENGTH_M } from '../demo/route';
import { DemoWeatherProvider } from './DemoWeatherProvider';
import { NowcastWeatherProvider } from './NowcastWeatherProvider';
import {
  correlatedReporters,
  distanceToCellM,
  isCellRelevant,
  WeatherAlertEngine,
  weatherLookaheadM,
} from './weatherAlerts';

installMemoryStorage();

const ROOT = resolve(import.meta.dirname, '..', '..');
const provider = new DemoWeatherProvider();
const cells = provider.cells();

/** Distanza lungo il percorso del punto piu' vicino a un punto qualsiasi. */
function distanceAlong(target: { lat: number; lon: number }): number {
  let best = 0;
  let bestDist = Infinity;
  for (let d = 0; d < ROUTE_LENGTH_M; d += 5) {
    const dist = distanceM(positionAtDistance(d), target);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

describe('il meteo esiste solo in DEMO MODE', () => {
  const app = readFileSync(resolve(ROOT, 'src', 'App.tsx'), 'utf8');

  it('la sorgente meteo viene costruita solo quando la demo e\' attiva', () => {
    // La costruzione e' dentro un effetto che esce subito se `demo` e' falso.
    expect(app).toMatch(/if \(!demo\) \{[\s\S]{0,260}return;/);
    expect(app).toMatch(/new DemoWeatherProvider\(\)/);
  });

  it('le aree meteo vengono passate alla mappa solo in demo', () => {
    expect(app).toMatch(/areaOverlays=\{demo \? weatherOverlays : null\}/);
  });

  it('l\'etichetta di simulazione compare solo in demo', () => {
    expect(app).toMatch(/demo && weatherCells\.length > 0/);
    expect(app).toMatch(/ROAD WEATHER · SIMULAZIONE/);
  });

  it('nessun modulo meteo e\' importato dagli engine reali', () => {
    for (const file of [
      'src/core/DetectionEngine.ts',
      'src/core/SensorEngine.ts',
      'src/core/ConfidenceEngine.ts',
      'src/core/AlertEngine.ts',
      'src/core/sensors/PhoneSensorProvider.ts',
      'src/net/api.ts',
    ]) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      expect(source).not.toMatch(/weather|Weather|nowcast|Nowcast|NOWCAST/);
    }
  });
});

describe('DemoWeatherProvider', () => {
  it('non effettua alcuna richiesta di rete', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const p = new DemoWeatherProvider();
    p.cells();
    p.cells();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('il suo codice non contiene alcuna primitiva di rete', () => {
    const source = readFileSync(resolve(ROOT, 'src', 'weather', 'DemoWeatherProvider.ts'), 'utf8');
    expect(source).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|EventSource|import\(/);
  });

  it('e\' disponibile e produce celle marcate come simulate', () => {
    expect(provider.isAvailable()).toBe(true);
    expect(cells.length).toBeGreaterThanOrEqual(2);
    expect(cells.every((c) => c.simulated === true)).toBe(true);
  });

  it('produce coordinate valide', () => {
    for (const c of cells) {
      expect(Number.isFinite(c.lat)).toBe(true);
      expect(Number.isFinite(c.lon)).toBe(true);
      expect(c.lat).toBeGreaterThan(45.3);
      expect(c.lat).toBeLessThan(45.6);
      expect(c.lon).toBeGreaterThan(9.0);
      expect(c.lon).toBeLessThan(9.4);
      expect(c.radiusM).toBeGreaterThan(100);
      expect(c.radiusM).toBeLessThan(2000);
      expect(c.driftHeading).not.toBeNull();
      expect(c.driftHeading as number).toBeGreaterThanOrEqual(0);
      expect(c.driftHeading as number).toBeLessThan(360);
    }
  });

  it('non restituisce lo stesso oggetto a due chiamate: lo scenario e\' immutabile', () => {
    const a = provider.cells();
    const b = provider.cells();
    expect(a[0]).not.toBe(b[0]);
    expect(a[0]).toEqual(b[0]);
  });

  it('ogni area interseca realmente il percorso demo', () => {
    for (const c of cells) {
      // Il centro e' spostato a lato, ma il cerchio deve coprire la strada.
      expect(distanceFromRoute(c)).toBeLessThan(c.radiusM);
    }
  });

  it('le aree si muovono verso il percorso, non lontano da esso', () => {
    for (const c of cells) {
      const onRoute = positionAtDistance(distanceAlong(c));
      const towardsRoute = bearingDeg(c, onRoute);
      // La deriva punta grosso modo verso la strada.
      expect(angleDeltaDeg(c.driftHeading as number, towardsRoute)).toBeLessThan(75);
    }
  });

  it('le aree sono distanziate fra loro: la demo non si affolla', () => {
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        expect(distanceM(cells[i]!, cells[j]!)).toBeGreaterThan(500);
      }
    }
  });
});

describe('NowcastWeatherProvider e\' soltanto uno stub', () => {
  const nowcast = new NowcastWeatherProvider();
  const source = readFileSync(resolve(ROOT, 'src', 'weather', 'NowcastWeatherProvider.ts'), 'utf8');

  it('non e\' disponibile e non restituisce dati', () => {
    expect(nowcast.isAvailable()).toBe(false);
    expect(nowcast.cells()).toEqual([]);
  });

  it('dichiara perche\' non e\' disponibile', () => {
    expect(nowcast.unavailableReason).toMatch(/v0\.1\.0/);
  });

  it('non contiene alcuna primitiva di rete ne\' alcun indirizzo', () => {
    expect(source).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|EventSource/);
    expect(source).not.toMatch(/https?:\/\//);
  });

  it('non importa nulla da NOWCAST', () => {
    const imports = source.match(/^import .*$/gm) ?? [];
    for (const line of imports) {
      expect(line).toMatch(/from '\.\/WeatherProvider'/);
    }
  });
});

describe('avvisi meteo', () => {
  const clusters = buildClusters(buildDemoEvents());

  /** Conducente posto sul percorso a una certa distanza dall'inizio. */
  function driverAt(distance: number) {
    const p = positionAtDistance(distance);
    return { lat: p.lat, lon: p.lon, heading: p.heading, speedMps: 10 };
  }

  it('la distanza di preavviso scala con la velocita\', entro i limiti', () => {
    expect(weatherLookaheadM(0)).toBe(WEATHER.minLookaheadM);
    expect(weatherLookaheadM(100)).toBe(WEATHER.maxLookaheadM);
    expect(weatherLookaheadM(10)).toBeCloseTo(10 * WEATHER.lookaheadSec, 5);
  });

  it('la distanza e\' misurata dal bordo dell\'area, non dal centro', () => {
    const cell = cells[0]!;
    expect(distanceToCellM(cell, { lat: cell.lat, lon: cell.lon })).toBe(0);
  });

  it('avvisa quando il veicolo si avvicina, non prima e non dopo', () => {
    const engine = new WeatherAlertEngine();
    const rain = cells.find((c) => c.kind === 'heavyRain')!;
    const rainAt = distanceAlong(rain);

    // Troppo lontano per un preavviso.
    // Nota: il percorso e' un anello di poco meno di 6 km e si ripiega su se'
    // stesso, quindi arretrare lungo il tracciato NON allontana in linea
    // d'aria. Il punto lontano va quindi costruito esplicitamente, con la
    // direzione puntata verso la cella: cosi' l'unica cosa che puo' escluderla
    // e' la distanza, che e' proprio cio' che si vuole verificare.
    const away = destinationPoint({ lat: rain.lat, lon: rain.lon }, 270, 6000);
    const farBehind = {
      lat: away.lat,
      lon: away.lon,
      heading: bearingDeg(away, { lat: rain.lat, lon: rain.lon }),
      speedMps: 10,
    };
    expect(distanceToCellM(rain, farBehind)).toBeGreaterThan(weatherLookaheadM(10));
    expect(isCellRelevant(rain, farBehind)).toBeNull();

    // In avvicinamento: rilevante.
    const approaching = driverAt(rainAt - 800);
    expect(isCellRelevant(rain, approaching)).not.toBeNull();

    // Superata: l'area e' alle spalle.
    const past = driverAt(rainAt + rain.radiusM + 900);
    expect(isCellRelevant(rain, past)).toBeNull();
    expect(engine.evaluate([rain], past, clusters, 1000)).toBeNull();
  });

  it('non avvisa senza direzione di marcia, se non si e\' gia\' dentro', () => {
    const rain = cells.find((c) => c.kind === 'heavyRain')!;
    const p = positionAtDistance(distanceAlong(rain) - 800);
    expect(
      isCellRelevant(rain, { lat: p.lat, lon: p.lon, heading: null, speedMps: 10 }),
    ).toBeNull();
  });

  it('mostra una sola area alla volta: la piu\' vicina', () => {
    const engine = new WeatherAlertEngine();
    const rain = cells.find((c) => c.kind === 'heavyRain')!;
    const driver = driverAt(distanceAlong(rain) - 700);
    const alert = engine.evaluate(cells, driver, clusters, 1000);
    expect(alert).not.toBeNull();
    expect(alert?.cell.id).toBe(rain.id);
  });

  it('non ripete lo stesso avviso entro il periodo di attesa', () => {
    const engine = new WeatherAlertEngine();
    const rain = cells.find((c) => c.kind === 'heavyRain')!;
    const driver = driverAt(distanceAlong(rain) - 700);
    expect(engine.evaluate([rain], driver, clusters, 1000)).not.toBeNull();
    expect(engine.evaluate([rain], driver, clusters, 1000 + WEATHER.cooldownMs / 2)).toBeNull();
    expect(engine.evaluate([rain], driver, clusters, 1000 + WEATHER.cooldownMs + 1)).not.toBeNull();
  });

  it('CORRELA la previsione con le segnalazioni ROAD SENSE nella stessa area', () => {
    const rain = cells.find((c) => c.kind === 'heavyRain')!;
    const reporters = correlatedReporters(rain, clusters);
    // Nell'area della pioggia ROAD SENSE ha gia' segnalazioni di acqua.
    expect(reporters).toBeGreaterThan(0);

    const engine = new WeatherAlertEngine();
    const alert = engine.evaluate([rain], driverAt(distanceAlong(rain) - 700), clusters, 1000);
    expect(alert?.correlated).toBe(true);
    expect(alert?.correlatedReporters).toBe(reporters);
  });

  it('senza segnalazioni stradali l\'avviso resta una semplice previsione', () => {
    const hail = cells.find((c) => c.kind === 'hail')!;
    expect(correlatedReporters(hail, clusters)).toBe(0);
    const engine = new WeatherAlertEngine();
    const alert = engine.evaluate([hail], driverAt(distanceAlong(hail) - 700), clusters, 1000);
    expect(alert?.correlated).toBe(false);
  });

  it('una cella senza correlazione dichiarata non correla mai', () => {
    const downburst = cells.find((c) => c.kind === 'downburst')!;
    expect(downburst.correlatesWith).toBeUndefined();
    expect(correlatedReporters(downburst, clusters)).toBe(0);
  });

  it('un avviso confermato dalla strada ha la precedenza su uno piu\' vicino ma non confermato', () => {
    const engine = new WeatherAlertEngine();
    const rain = cells.find((c) => c.kind === 'heavyRain')!;
    const hail = cells.find((c) => c.kind === 'hail')!;
    const driver = driverAt(0);

    // Alla partenza entrambe le celle sono rilevanti.
    expect(isCellRelevant(rain, driver)).not.toBeNull();
    expect(isCellRelevant(hail, driver)).not.toBeNull();
    // La grandine e' piu' vicina...
    expect(distanceToCellM(hail, driver)).toBeLessThan(distanceToCellM(rain, driver));
    // ...ma solo la pioggia e' confermata da segnalazioni sulla strada.
    expect(correlatedReporters(hail, clusters)).toBe(0);
    expect(correlatedReporters(rain, clusters)).toBeGreaterThan(0);

    // Due sorgenti indipendenti che concordano valgono piu' di una previsione
    // non confermata, anche se piu' vicina.
    const alert = engine.evaluate(cells, driver, clusters, 1000);
    expect(alert?.cell.id).toBe(rain.id);
    expect(alert?.correlated).toBe(true);
  });

  it('a parita\' di conferma vince la piu\' vicina', () => {
    const engine = new WeatherAlertEngine();
    const hail = cells.find((c) => c.kind === 'hail')!;
    const downburst = cells.find((c) => c.kind === 'downburst')!;
    const driver = driverAt(0);
    const nearest =
      distanceToCellM(hail, driver) < distanceToCellM(downburst, driver) ? hail : downburst;
    // Nessuna delle due e' confermata dalla strada.
    expect(correlatedReporters(hail, clusters)).toBe(0);
    expect(correlatedReporters(downburst, clusters)).toBe(0);
    expect(engine.evaluate([hail, downburst], driver, clusters, 1000)?.cell.id).toBe(nearest.id);
  });

  it('alla partenza della demo l\'avviso correlato e\' a distanza utile', () => {
    // La narrazione della demo si regge su questo: il primo avviso deve
    // arrivare PRIMA di essere dentro al fenomeno.
    const rain = cells.find((c) => c.kind === 'heavyRain')!;
    const distance = distanceToCellM(rain, driverAt(0));
    expect(distance).toBeGreaterThan(400);
    expect(distance).toBeLessThan(weatherLookaheadM(10));
  });

  it('reset azzera lo storico degli avvisi', () => {
    const engine = new WeatherAlertEngine();
    const rain = cells.find((c) => c.kind === 'heavyRain')!;
    const driver = driverAt(distanceAlong(rain) - 700);
    engine.evaluate([rain], driver, clusters, 1000);
    engine.reset();
    expect(engine.evaluate([rain], driver, clusters, 1001)).not.toBeNull();
  });
});
