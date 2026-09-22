/**
 * ROAD SENSE - coerenza fra cio' che si vede e cio' che il modello calcola.
 *
 * E' il requisito piu' importante della rappresentazione dinamica: non devono
 * esistere due posizioni, una grafica e una del motore. Questi test esistono
 * per impedire che tornino a divergere.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { WEATHER } from '../config/config';
import { distanceM } from '../core/geo';
import { installMemoryStorage } from '../core/testUtils';
import { routeAheadFrom } from '../demo/routeAhead';
import { positionAtDistance } from '../demo/route';
import { weatherCellsToOverlays } from '../ui/weatherOverlay';
import { DemoWeatherProvider } from './DemoWeatherProvider';
import { cellCentreAt, forecastIntersection } from './intersection';

installMemoryStorage();
const ROOT = resolve(import.meta.dirname, '..', '..');
const T0 = 1_700_000_000_000;

describe('una sola sorgente di posizione', () => {
  it('l\'area disegnata sta esattamente dove sta la cella', () => {
    const provider = new DemoWeatherProvider();
    provider.start(T0);
    const cells = provider.cells(T0 + 90_000);
    const overlays = weatherCellsToOverlays(cells, 0.3);

    expect(overlays).toHaveLength(cells.length);
    for (let i = 0; i < cells.length; i++) {
      // Non "vicino": identico. L'overlay non ricalcola nulla.
      expect(overlays[i]!.lat).toBe(cells[i]!.lat);
      expect(overlays[i]!.lon).toBe(cells[i]!.lon);
      expect(overlays[i]!.radiusM).toBe(cells[i]!.radiusM);
      expect(overlays[i]!.id).toBe(cells[i]!.id);
    }
  });

  it('App usa lo STESSO array di celle per la mappa e per la previsione', () => {
    const app = readFileSync(resolve(ROOT, 'src', 'App.tsx'), 'utf8');
    // Un unico orologio scrive celle e fase.
    expect(app).toMatch(/const cells = provider\.cells\(now\);/);
    expect(app).toMatch(/weatherCellsRef\.current = cells;\s*\n\s*setWeatherCells\(cells\);/);
    // Il motore riceve le celle aggiornate, non una copia congelata.
    expect(app).toMatch(/refresh\(\s*shownWeather,\s*cells,/);
  });

  it('MapView non possiede alcun orologio proprio', () => {
    const mapView = readFileSync(resolve(ROOT, 'src', 'ui', 'MapView.tsx'), 'utf8');
    expect(mapView).not.toMatch(/setInterval|requestAnimationFrame|Date\.now\(\)/);
  });
});

describe('movimento deterministico', () => {
  it('la stessa istanza allo stesso istante da\' sempre la stessa posizione', () => {
    const provider = new DemoWeatherProvider();
    provider.start(T0);
    const a = provider.cells(T0 + 45_000);
    const b = provider.cells(T0 + 45_000);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.lat).toBe(b[i]!.lat);
      expect(a[i]!.lon).toBe(b[i]!.lon);
    }
  });

  it('due istanze diverse producono lo stesso scenario', () => {
    const uno = new DemoWeatherProvider();
    const due = new DemoWeatherProvider();
    uno.start(T0);
    due.start(T0);
    expect(uno.cells(T0 + 30_000)).toEqual(due.cells(T0 + 30_000));
  });

  it('le celle si muovono davvero, e nella direzione della loro deriva', () => {
    const provider = new DemoWeatherProvider();
    provider.start(T0);
    const iniziali = provider.cells(T0);
    const dopo = provider.cells(T0 + 120_000);

    for (let i = 0; i < iniziali.length; i++) {
      const percorso = distanceM(iniziali[i]!, dopo[i]!);
      const atteso = iniziali[i]!.driftSpeedMps * 120;
      expect(percorso).toBeGreaterThan(10);
      expect(percorso).toBeCloseTo(atteso, -1);
    }
  });

  it('prima dell\'avvio le celle restano ferme al tempo zero', () => {
    const provider = new DemoWeatherProvider();
    expect(provider.cells(T0)).toEqual(provider.cells(T0 + 600_000));
  });

  it('lo stop riporta lo scenario al tempo zero', () => {
    const provider = new DemoWeatherProvider();
    const zero = provider.cells(T0);
    provider.start(T0);
    expect(provider.cells(T0 + 60_000)).not.toEqual(zero);
    provider.stop();
    expect(provider.cells(T0 + 60_000)).toEqual(zero);
  });

  it('la posizione della cella coincide con quella che il modello assume', () => {
    // La cella al tempo t deve essere cellCentreAt(base, t): e' la stessa
    // funzione che `forecastIntersection` usa per proiettarla nel futuro.
    const provider = new DemoWeatherProvider();
    const base = provider.cells(T0);
    provider.start(T0);
    const dopo = provider.cells(T0 + 75_000);
    for (let i = 0; i < base.length; i++) {
      const atteso = cellCentreAt(base[i]!, 75);
      expect(distanceM(dopo[i]!, atteso)).toBeLessThan(0.01);
    }
  });

  it('la previsione fatta prima si avvera con le celle effettivamente mosse', () => {
    // Previsione all'istante zero...
    const provider = new DemoWeatherProvider();
    provider.start(T0);
    const rain = provider.cells(T0).find((c) => c.kind === 'heavyRain')!;
    const p0 = positionAtDistance(0);
    const previsione = forecastIntersection(
      rain,
      { lat: p0.lat, lon: p0.lon, heading: p0.heading, speedMps: 10 },
      routeAheadFrom(p0, 0).route,
    );
    expect(previsione.roadDistanceM).not.toBeNull();

    // ...e verifica con le celle come il provider le fornira' davvero.
    const tArrivo = previsione.etaSec!;
    const cellaAllora = provider.cells(T0 + tArrivo * 1000).find((c) => c.kind === 'heavyRain')!;
    const veicoloAllora = positionAtDistance(10 * tArrivo);
    expect(distanceM(veicoloAllora, cellaAllora)).toBeLessThanOrEqual(cellaAllora.radiusM + 5);
  });
});

describe('animazioni e preferenza di movimento ridotto', () => {
  it('la fase governa solo l\'aspetto, mai la posizione', () => {
    const provider = new DemoWeatherProvider();
    provider.start(T0);
    const cells = provider.cells(T0 + 20_000);
    const a = weatherCellsToOverlays(cells, 0);
    const b = weatherCellsToOverlays(cells, 0.75);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.lat).toBe(b[i]!.lat);
      expect(a[i]!.lon).toBe(b[i]!.lon);
      expect(a[i]!.phase).not.toBe(b[i]!.phase);
    }
  });

  it('con "meno movimento" la fase resta costante, la deriva no', () => {
    const app = readFileSync(resolve(ROOT, 'src', 'App.tsx'), 'utf8');
    // La deriva e' il dato e resta; si ferma solo cio' che e' decorativo.
    expect(app).toMatch(/reducedMotion \? 0\.5 : weatherPhase/);
  });

  it('i fenomeni si distinguono per tratti visivi diversi', () => {
    const provider = new DemoWeatherProvider();
    const overlays = weatherCellsToOverlays(provider.cells(T0), 0.2);
    const byKind = new Map(provider.cells(T0).map((c, i) => [c.kind, overlays[i]!]));

    // La grandine ha granuli, il downburst raffiche, la pioggia nessuno dei due.
    expect(byKind.get('hail')!.speckles).toBeGreaterThan(0);
    expect(byKind.get('hail')!.gusts).toBe(0);
    expect(byKind.get('downburst')!.gusts).toBeGreaterThan(0);
    expect(byKind.get('downburst')!.speckles).toBe(0);
    expect(byKind.get('heavyRain')!.speckles).toBe(0);
    expect(byKind.get('heavyRain')!.gusts).toBe(0);

    // La pioggia resta la meno prominente.
    expect(byKind.get('heavyRain')!.fillOpacity).toBeLessThan(byKind.get('hail')!.fillOpacity);
    expect(byKind.get('heavyRain')!.pulse).toBeLessThan(byKind.get('downburst')!.pulse);
  });

  it('le aree restano semitrasparenti: sotto c\'e\' la strada', () => {
    const provider = new DemoWeatherProvider();
    for (const o of weatherCellsToOverlays(provider.cells(T0), 0.5)) {
      expect(o.fillOpacity).toBeGreaterThan(0);
      expect(o.fillOpacity).toBeLessThan(0.2);
    }
  });

  it('pochi elementi disegnati: niente centinaia di nodi', () => {
    const provider = new DemoWeatherProvider();
    const overlays = weatherCellsToOverlays(provider.cells(T0), 0.5);
    const totale = overlays.reduce((n, o) => n + o.speckles + o.gusts, 0);
    expect(totale).toBeLessThan(30);
  });
});

describe('nessuna rete e nessun effetto sulla modalita\' reale', () => {
  it('far avanzare l\'orologio non produce alcuna richiesta', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new DemoWeatherProvider();
    provider.start(T0);
    for (let t = 0; t < 120_000; t += WEATHER.demoTickMs) provider.cells(T0 + t);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('l\'orologio della demo gira solo in demo e solo durante il monitoraggio', () => {
    const app = readFileSync(resolve(ROOT, 'src', 'App.tsx'), 'utf8');
    expect(app).toMatch(/if \(!demo \|\| !running \|\| !provider\) return;/);
  });

  it('nessun modulo reale e\' stato toccato dalla rappresentazione', () => {
    for (const file of [
      'src/core/DetectionEngine.ts',
      'src/core/SensorEngine.ts',
      'src/core/ConfidenceEngine.ts',
      'src/core/AlertEngine.ts',
      'src/core/sensors/PhoneSensorProvider.ts',
    ]) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      expect(source).not.toMatch(/weather|Weather|areaOverlay|AreaOverlay/);
    }
  });
});
