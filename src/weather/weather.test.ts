/**
 * ROAD SENSE - verifiche sulla simulazione ROAD WEATHER.
 *
 * Il punto piu' importante di questo file non e' il meteo: e' la garanzia che
 * il meteo NON esista fuori dalla DEMO MODE e che NOWCAST non sia collegato.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { angleDeltaDeg, bearingDeg, destinationPoint, distanceM } from '../core/geo';
import { installMemoryStorage } from '../core/testUtils';
import { distanceFromRoute, positionAtDistance, ROUTE_LENGTH_M } from '../demo/route';
import { DemoWeatherProvider } from './DemoWeatherProvider';
import { NowcastWeatherProvider } from './NowcastWeatherProvider';
import { approachBand, correlatedReporters, steadyEta, WeatherAlertEngine } from './weatherAlerts';
import { formatEta, formatRoadDistance } from '../ui/weatherMeta';
import { cellCentreAt, forecastIntersection, type RouteAhead } from './intersection';
import { WEATHER } from '../config/config';
import { buildClusters } from '../core/ConfidenceEngine';
import { buildDemoEvents } from '../core/demoSeed';
import { routeAheadFrom } from '../demo/routeAhead';

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
    // La legenda - etichetta meteo inclusa - sta dentro un blocco `demo &&`.
    expect(app).toMatch(/\{demo &&[\s\S]{0,120}demo-legend/);
    expect(app).toMatch(
      /weatherCells\.length > 0 && <div className="row sim">ROAD WEATHER · SIMULAZIONE<\/div>/,
    );
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

  it('ogni area incrocera\' davvero il percorso mentre il veicolo avanza', () => {
    // Non si chiede che la cella tocchi la strada ADESSO: con il modello
    // predittivo una cella puo' trovarsi lateralmente lontana e arrivare
    // sulla carreggiata proprio quando ci arriva il veicolo. Quello che deve
    // valere e' che l'incontro sia previsto.
    const p = positionAtDistance(0);
    const driver = { lat: p.lat, lon: p.lon, heading: p.heading, speedMps: 10 };
    const { route } = routeAheadFrom(p, 0);
    for (const c of cells) {
      const f = forecastIntersection(c, driver, route);
      expect(f.roadDistanceM).not.toBeNull();
      expect(f.etaSec).toBeGreaterThan(0);
    }
  });

  it('nessuna area e\' assurdamente lontana dal percorso', () => {
    // Deve restare uno scenario urbano credibile, non una cella all'orizzonte.
    for (const c of cells) expect(distanceFromRoute(c)).toBeLessThan(c.radiusM + 800);
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

describe('avvisi meteo sullo scenario demo', () => {
  const clusters = buildClusters(buildDemoEvents());

  /** Conducente sul tracciato demo a una certa distanza dall'inizio. */
  function driverAt(distance: number, speedMps = 10) {
    const p = positionAtDistance(distance);
    return { lat: p.lat, lon: p.lon, heading: p.heading, speedMps };
  }

  const routeAt = (distance: number) => routeAheadFrom(positionAtDistance(distance), distance).route;

  it('alla partenza prevede l\'incontro con distanza stradale e tempo', () => {
    const engine = new WeatherAlertEngine();
    const alert = engine.evaluate(cells, driverAt(0), routeAt(0), clusters, 1000);
    expect(alert).not.toBeNull();
    expect(alert!.forecast.inside).toBe(false);
    expect(alert!.forecast.roadDistanceM).toBeGreaterThan(300);
    expect(alert!.forecast.etaSec).toBeGreaterThan(30);
    // Distanza e tempo sono coerenti fra loro.
    expect(alert!.forecast.etaSec).toBeCloseTo(alert!.forecast.roadDistanceM! / 10, 2);
  });

  it('la distanza e il tempo DIMINUISCONO avvicinandosi', () => {
    const engine = new WeatherAlertEngine();
    const alert = engine.evaluate(cells, driverAt(0), routeAt(0), clusters, 1000)!;
    const cella = alert.cell;

    let precedente = Number.POSITIVE_INFINITY;
    let misure = 0;
    for (let d = 0; d < 900; d += 150) {
      const f = forecastIntersection(cella, driverAt(d), routeAt(d));
      if (f.inside || f.roadDistanceM === null) break;
      expect(f.roadDistanceM).toBeLessThan(precedente);
      precedente = f.roadDistanceM;
      misure++;
    }
    expect(misure).toBeGreaterThan(3);
  });

  it('la previsione si avvera: simulando il tempo, il veicolo entra davvero', () => {
    // Questo e' il test che conta: si fa scorrere il tempo muovendo SIA il
    // veicolo lungo la strada SIA la cella secondo la sua deriva, e si
    // verifica che l'incontro avvenga, e avvenga quando era stato previsto.
    const rain = cells.find((c) => c.kind === 'heavyRain')!;
    const speed = 10;
    const previsione = forecastIntersection(rain, driverAt(0, speed), routeAt(0));
    expect(previsione.inside).toBe(false);
    expect(previsione.etaSec).toBeGreaterThan(0);

    let entrataSec: number | null = null;
    for (let t = 0; t <= previsione.etaSec! * 1.5; t += 1) {
      const veicolo = positionAtDistance(speed * t);
      if (distanceM(veicolo, cellCentreAt(rain, t)) <= rain.radiusM) {
        entrataSec = t;
        break;
      }
    }

    expect(entrataSec).not.toBeNull();
    // L'istante reale coincide con quello previsto a meno di pochi secondi.
    expect(Math.abs(entrataSec! - previsione.etaSec!)).toBeLessThan(5);
  });

  it('D) l\'avviso DECADE se l\'incontro non e\' piu\' previsto', () => {
    const engine = new WeatherAlertEngine();
    const alert = engine.evaluate(cells, driverAt(0), routeAt(0), clusters, 1000)!;
    expect(alert).not.toBeNull();

    // Il veicolo imbocca un'altra strada: un percorso che si allontana e non
    // incrocera' mai la cella.
    const altrove: RouteAhead = {
      pointAt: (aheadM) =>
        aheadM > 6000 ? null : destinationPoint({ lat: 45.9, lon: 9.9 }, 0, aheadM),
    };
    const dopo = engine.refresh(
      alert,
      { lat: 45.9, lon: 9.9, heading: 0, speedMps: 10 },
      altrove,
      clusters,
    );
    expect(dopo).toBeNull();
  });

  it('l\'avviso aggiornato conserva la cella e aggiorna i numeri', () => {
    const engine = new WeatherAlertEngine();
    const alert = engine.evaluate(cells, driverAt(0), routeAt(0), clusters, 1000)!;
    const dopo = engine.refresh(alert, driverAt(300), routeAt(300), clusters)!;
    expect(dopo).not.toBeNull();
    expect(dopo.cell.id).toBe(alert.cell.id);
    expect(dopo.forecast.roadDistanceM!).toBeLessThan(alert.forecast.roadDistanceM!);
  });

  it('non ripete la stessa cella nella stessa fascia di avvicinamento', () => {
    const engine = new WeatherAlertEngine();
    const primo = engine.evaluate(cells, driverAt(0), routeAt(0), clusters, 1000);
    expect(primo).not.toBeNull();
    // Stesso punto, molto piu' tardi: la situazione non e' cambiata.
    const secondo = engine.evaluate(cells, driverAt(0), routeAt(0), clusters, 1000 + 600_000);
    expect(secondo?.cell.id).not.toBe(primo!.cell.id);
  });

  it('ri-annuncia quando si supera una soglia di avvicinamento', () => {
    const engine = new WeatherAlertEngine();
    const primo = engine.evaluate(cells, driverAt(0), routeAt(0), clusters, 1000)!;
    const cella = primo.cell;

    // Si avanza finche' la fascia cambia, e si verifica che la cella torni.
    let riannunciata = false;
    for (let d = 100; d < 1500; d += 100) {
      const t = 1000 + d * 100 + 600_000;
      const a = engine.evaluate([cella], driverAt(d), routeAt(d), clusters, t);
      if (a?.cell.id === cella.id) {
        expect(approachBand(a.forecast)).toBeGreaterThan(approachBand(primo.forecast));
        riannunciata = true;
        break;
      }
    }
    expect(riannunciata).toBe(true);
  });

  it('un avviso confermato dalla strada ha la precedenza', () => {
    const engine = new WeatherAlertEngine();
    const rain = cells.find((c) => c.kind === 'heavyRain')!;
    expect(correlatedReporters(rain, clusters)).toBeGreaterThan(0);
    const alert = engine.evaluate(cells, driverAt(0), routeAt(0), clusters, 1000);
    expect(alert?.cell.id).toBe(rain.id);
    expect(alert?.correlated).toBe(true);
  });

  it('rispetta l\'intervallo minimo fra due avvisi meteo', () => {
    const engine = new WeatherAlertEngine();
    expect(engine.evaluate(cells, driverAt(0), routeAt(0), clusters, 1000)).not.toBeNull();
    expect(
      engine.evaluate(cells, driverAt(50), routeAt(50), clusters, 1000 + WEATHER.minGapMs / 2),
    ).toBeNull();
  });

  it('reset azzera lo storico degli avvisi', () => {
    const engine = new WeatherAlertEngine();
    const primo = engine.evaluate(cells, driverAt(0), routeAt(0), clusters, 1000);
    engine.reset();
    const secondo = engine.evaluate(cells, driverAt(0), routeAt(0), clusters, 2000);
    expect(secondo?.cell.id).toBe(primo?.cell.id);
  });
});

describe('stabilita\' del testo mostrato', () => {
  it('il tempo mostrato non insegue ogni minima variazione', () => {
    // Variazione piccola: resta quello di prima, cosi' il testo non balla.
    expect(steadyEta(200, 205)).toBe(200);
    expect(steadyEta(200, 190)).toBe(200);
    // Variazione apprezzabile: si aggiorna.
    expect(steadyEta(200, 160)).toBe(160);
    expect(steadyEta(200, 250)).toBe(250);
  });

  it('parte dal primo valore disponibile e si azzera senza previsione', () => {
    expect(steadyEta(null, 180)).toBe(180);
    expect(steadyEta(200, null)).toBeNull();
  });

  it('la distanza mostrata e\' arrotondata a passi stabili', () => {
    expect(formatRoadDistance(812)).toBe(formatRoadDistance(824));
    expect(formatRoadDistance(1249)).toBe('1,2 km');
    expect(formatRoadDistance(20)).toBe('50 m');
  });

  it('il tempo mostrato e\' arrotondato al minuto', () => {
    expect(formatEta(30)).toBe('meno di 1 min');
    expect(formatEta(185)).toBe('circa 3 min');
    expect(formatEta(200)).toBe('circa 3 min');
  });

  it('avvicinandosi il tempo mostrato scende in modo monotono', () => {
    let mostrato: number | null = null;
    const letti: number[] = [];
    // Stima che scende con un po' di rumore, come nella realta'.
    for (let vero = 300; vero > 20; vero -= 4) {
      const rumore = (vero % 3) - 1;
      mostrato = steadyEta(mostrato, vero + rumore * 6);
      letti.push(mostrato!);
    }
    for (let i = 1; i < letti.length; i++) expect(letti[i]!).toBeLessThanOrEqual(letti[i - 1]!);
  });
});
