/**
 * ROAD SENSE - verifiche sulla previsione dell'incontro veicolo/cella meteo.
 *
 * I casi sono costruiti su una geometria artificiale e controllata: un
 * percorso rettilineo verso est. Cosi' le distanze attese si calcolano a mano
 * e i test verificano la LOGICA, non le curve di Milano.
 */

import { describe, expect, it } from 'vitest';

import { WEATHER } from '../config/config';
import { destinationPoint, distanceM } from '../core/geo';
import {
  cellCentreAt,
  cellRadiusAt,
  forecastIntersection,
  type RouteAhead,
} from './intersection';
import { approachBand } from './weatherAlerts';
import type { WeatherCell } from './WeatherProvider';

const ORIGIN = { lat: 45.4642, lon: 9.19 };
/** Percorso rettilineo verso est a partire dal veicolo. */
const STRAIGHT_EAST: RouteAhead = {
  pointAt: (aheadM) => (aheadM > 8000 ? null : destinationPoint(ORIGIN, 90, aheadM)),
};

function driver(speedMps: number | null = 10) {
  return { lat: ORIGIN.lat, lon: ORIGIN.lon, heading: 90, speedMps };
}

/** Cella collocata a `distM` metri in direzione `bearing` dal veicolo. */
function cell(overrides: Partial<WeatherCell> & { distM?: number; bearing?: number } = {}): WeatherCell {
  const { distM = 2000, bearing = 90, ...rest } = overrides;
  const centre = destinationPoint(ORIGIN, bearing, distM);
  return {
    id: 'c',
    kind: 'hail',
    lat: centre.lat,
    lon: centre.lon,
    radiusM: 300,
    driftHeading: null,
    driftSpeedMps: 0,
    etaMin: 5,
    severity: 2,
    announce: true,
    simulated: true,
    ...rest,
  };
}

describe('distanza lungo il percorso', () => {
  it('misura la strada, non la linea d\'aria', () => {
    // Cella ferma 2 km davanti, raggio 300 m: si incontra a 1700 m di strada.
    const f = forecastIntersection(cell({ distM: 2000 }), driver(10), STRAIGHT_EAST);
    expect(f.inside).toBe(false);
    expect(f.roadDistanceM).toBeGreaterThan(1650);
    expect(f.roadDistanceM).toBeLessThan(1750);
  });

  it('una cella vicina in linea d\'aria ma lontana di strada resta lontana', () => {
    // Percorso che prima si allontana e poi torna: la cella e' a 200 m in
    // linea d'aria, ma la si raggiunge solo dopo 3 km di strada.
    const target = destinationPoint(ORIGIN, 0, 200);
    const detour: RouteAhead = {
      pointAt: (aheadM) =>
        aheadM > 4000 ? null : aheadM < 3000 ? destinationPoint(ORIGIN, 180, aheadM) : target,
    };
    const c = cell({ distM: 200, bearing: 0, radiusM: 60 });
    expect(distanceM(driver(), c)).toBeLessThan(250);
    const f = forecastIntersection(c, driver(10), detour);
    expect(f.roadDistanceM).toBeGreaterThan(2900);
  });

  it('senza percorso non si puo\' prevedere nulla', () => {
    const f = forecastIntersection(cell({ distM: 2000 }), driver(10), null);
    expect(f.roadDistanceM).toBeNull();
  });
});

describe('tempo previsto', () => {
  it('dipende dalla velocita\' del veicolo', () => {
    const c = cell({ distM: 2000 });
    const lento = forecastIntersection(c, driver(5), STRAIGHT_EAST);
    const veloce = forecastIntersection(c, driver(20), STRAIGHT_EAST);
    expect(lento.etaSec).toBeGreaterThan(0);
    expect(veloce.etaSec).toBeGreaterThan(0);
    // Stessa distanza, velocita' quadrupla: tempo circa un quarto.
    expect(lento.etaSec! / veloce.etaSec!).toBeGreaterThan(3.5);
    expect(lento.etaSec! / veloce.etaSec!).toBeLessThan(4.5);
  });

  it('e\' coerente con distanza e velocita\'', () => {
    const f = forecastIntersection(cell({ distM: 2000 }), driver(10), STRAIGHT_EAST);
    expect(f.etaSec).toBeCloseTo(f.roadDistanceM! / 10, 3);
  });

  it('da fermi non si prevede alcun incontro', () => {
    expect(forecastIntersection(cell({ distM: 2000 }), driver(0), STRAIGHT_EAST).roadDistanceM).toBeNull();
    expect(forecastIntersection(cell({ distM: 2000 }), driver(null), STRAIGHT_EAST).roadDistanceM).toBeNull();
  });

  it('non guarda oltre l\'orizzonte temporale', () => {
    // A 3 m/s una cella a 5 km richiederebbe oltre 27 minuti.
    const f = forecastIntersection(cell({ distM: 5000 }), driver(3), STRAIGHT_EAST);
    expect(f.roadDistanceM).toBeNull();
    expect(WEATHER.maxEtaSec).toBeLessThan(5000 / 3);
  });
});

describe('movimento della cella', () => {
  it('la cella si sposta nel tempo', () => {
    const c = cell({ distM: 2000, driftHeading: 270, driftSpeedMps: 10 });
    const dopo = cellCentreAt(c, 60);
    // 10 m/s per 60 s verso ovest: 600 m piu' vicina al veicolo.
    expect(distanceM(driver(), dopo)).toBeCloseTo(2000 - 600, -1);
  });

  it('A) una cella che viene incontro si incrocia PRIMA che se fosse ferma', () => {
    const ferma = forecastIntersection(cell({ distM: 3000 }), driver(10), STRAIGHT_EAST);
    const incontro = forecastIntersection(
      cell({ distM: 3000, driftHeading: 270, driftSpeedMps: 8 }),
      driver(10),
      STRAIGHT_EAST,
    );
    expect(incontro.roadDistanceM).toBeLessThan(ferma.roadDistanceM!);
  });

  it('B) una cella che si allontana piu\' veloce del veicolo non si raggiunge', () => {
    const f = forecastIntersection(
      // Davanti, ma fugge verso est a 15 m/s mentre il veicolo va a 10.
      cell({ distM: 2000, driftHeading: 90, driftSpeedMps: 15 }),
      driver(10),
      STRAIGHT_EAST,
    );
    expect(f.inside).toBe(false);
    expect(f.roadDistanceM).toBeNull();
  });

  it('C) una cella lateralmente lontana che si muove verso la strada viene prevista', () => {
    // 1200 m a nord del percorso, quindi mai raggiungibile se restasse ferma.
    const laterale = cell({ distM: 1200, bearing: 0, radiusM: 300 });
    expect(forecastIntersection(laterale, driver(10), STRAIGHT_EAST).roadDistanceM).toBeNull();

    // La stessa cella, che scende verso la strada, viene invece incontrata.
    const inMovimento = { ...laterale, driftHeading: 135, driftSpeedMps: 12 };
    const f = forecastIntersection(inMovimento, driver(10), STRAIGHT_EAST);
    expect(f.roadDistanceM).not.toBeNull();
    expect(f.etaSec).toBeGreaterThan(0);
  });

  it('una cella vicina ma che non incrocera\' mai il percorso non produce previsione', () => {
    // Affiancata al percorso e in allontanamento laterale.
    const f = forecastIntersection(
      cell({ distM: 500, bearing: 0, radiusM: 200, driftHeading: 0, driftSpeedMps: 6 }),
      driver(10),
      STRAIGHT_EAST,
    );
    expect(f.roadDistanceM).toBeNull();
  });
});

describe('ingresso effettivo nella cella', () => {
  it('E) dentro l\'area non si calcola alcuna distanza', () => {
    const f = forecastIntersection(cell({ distM: 0, radiusM: 400 }), driver(10), STRAIGHT_EAST);
    expect(f.inside).toBe(true);
    expect(f.roadDistanceM).toBe(0);
  });

  it('lo stato "dentro" vale anche da fermi e senza percorso', () => {
    const c = cell({ distM: 0, radiusM: 400 });
    expect(forecastIntersection(c, driver(0), null).inside).toBe(true);
  });

  it('appena fuori dal bordo non e\' ancora "dentro"', () => {
    const f = forecastIntersection(cell({ distM: 420, radiusM: 400 }), driver(10), STRAIGHT_EAST);
    expect(f.inside).toBe(false);
    expect(f.roadDistanceM).toBeGreaterThan(0);
  });
});

describe('fasce di avvicinamento', () => {
  it('crescono man mano che ci si avvicina', () => {
    const lontano = approachBand({ inside: false, roadDistanceM: 5000, etaSec: 500 });
    const medio = approachBand({ inside: false, roadDistanceM: 2000, etaSec: 200 });
    const vicino = approachBand({ inside: false, roadDistanceM: 400, etaSec: 40 });
    const dentro = approachBand({ inside: true, roadDistanceM: 0, etaSec: 0 });
    expect(lontano).toBeLessThan(medio);
    expect(medio).toBeLessThan(vicino);
    expect(vicino).toBeLessThan(dentro);
  });

  it('nessuna previsione, nessuna fascia', () => {
    expect(approachBand({ inside: false, roadDistanceM: null, etaSec: null })).toBe(-1);
  });
});

/**
 * IL CONO DI NOWCAST.
 *
 * Il punto dell'integrazione: la traiettoria meteorologica appartiene a chi
 * la calcola. Quando il cono c'e', ROAD SENSE lo LEGGE; quando non c'e' -
 * la demo non ne ha - resta la deriva lineare di sempre.
 */
describe('traiettoria dal cono', () => {
  /** Cella con cono: si muove verso nord e il raggio si allarga. */
  const conCono: WeatherCell = {
    id: 'n1',
    kind: 'hail',
    lat: 45.0,
    lon: 9.0,
    radiusM: 2500,
    // Deriva DELIBERATAMENTE incoerente con il cono: se venisse usata,
    // i test se ne accorgono.
    driftHeading: 90,
    driftSpeedMps: 50,
    cone: [
      { minutes: 0, lat: 45.0, lon: 9.0, radiusM: 2000 },
      { minutes: 10, lat: 45.1, lon: 9.0, radiusM: 6000 },
      { minutes: 20, lat: 45.2, lon: 9.0, radiusM: 10000 },
    ],
    severity: 2,
    announce: true,
    simulated: false,
  };

  it('ai minuti esatti restituisce il punto di NOWCAST', () => {
    expect(cellCentreAt(conCono, 0)).toEqual({ lat: 45.0, lon: 9.0 });
    expect(cellCentreAt(conCono, 600).lat).toBeCloseTo(45.1, 6);
    expect(cellCentreAt(conCono, 1200).lat).toBeCloseTo(45.2, 6);
  });

  it('fra due punti interpola linearmente', () => {
    expect(cellCentreAt(conCono, 300).lat).toBeCloseTo(45.05, 6);
    expect(cellCentreAt(conCono, 900).lat).toBeCloseTo(45.15, 6);
  });

  it('il cono vince sulla deriva: la traiettoria NON viene ricostruita', () => {
    // La deriva direbbe "verso est a 50 m/s": il centro resta sul meridiano.
    const p = cellCentreAt(conCono, 600);
    expect(p.lon).toBeCloseTo(9.0, 6);
    expect(p.lat).toBeGreaterThan(45.0);
  });

  it('il raggio cresce lungo il cono, ed e\' interpolato', () => {
    expect(cellRadiusAt(conCono, 0)).toBe(2000);
    expect(cellRadiusAt(conCono, 300)).toBeCloseTo(4000, 6);
    expect(cellRadiusAt(conCono, 600)).toBe(6000);
  });

  it('a t=0 vale cone[0], non radiusM dichiarato sulla cella', () => {
    // Nei dati reali i due numeri non coincidono.
    expect(conCono.radiusM).toBe(2500);
    expect(cellRadiusAt(conCono, 0)).toBe(2000);
  });

  it('oltre l\'ultimo punto si usa l\'ultimo: mai estrapolazione', () => {
    const oltre = cellCentreAt(conCono, 99_999);
    expect(oltre.lat).toBeCloseTo(45.2, 6);
    expect(cellRadiusAt(conCono, 99_999)).toBe(10000);
  });

  it('prima del primo punto si usa il primo', () => {
    expect(cellCentreAt(conCono, -100)).toEqual({ lat: 45.0, lon: 9.0 });
    expect(cellRadiusAt(conCono, -100)).toBe(2000);
  });

  it('un cono disordinato viene comunque letto in ordine di minuti', () => {
    const disordinato: WeatherCell = {
      ...conCono,
      cone: [conCono.cone![2]!, conCono.cone![0]!, conCono.cone![1]!],
    };
    // L'ordinamento avviene nel provider; qui si verifica che la ricerca del
    // segmento non produca comunque un risultato assurdo.
    expect(cellRadiusAt(disordinato, 0)).toBeGreaterThan(0);
  });
});

describe('senza cono il comportamento resta quello della demo', () => {
  const senzaCono: WeatherCell = {
    id: 'd1',
    kind: 'hail',
    lat: 45.0,
    lon: 9.0,
    radiusM: 3000,
    driftHeading: 0,
    driftSpeedMps: 10,
    severity: 2,
    announce: true,
    simulated: true,
  };

  it('la deriva lineare e\' ancora quella', () => {
    const p = cellCentreAt(senzaCono, 60);
    // 600 m verso nord: circa 0.0054 gradi di latitudine.
    expect(p.lat).toBeGreaterThan(45.0);
    expect(p.lon).toBeCloseTo(9.0, 4);
  });

  it('il raggio resta costante', () => {
    expect(cellRadiusAt(senzaCono, 0)).toBe(3000);
    expect(cellRadiusAt(senzaCono, 600)).toBe(3000);
  });

  it('senza direzione la cella resta ferma', () => {
    const ferma = { ...senzaCono, driftHeading: null };
    expect(cellCentreAt(ferma, 600)).toEqual({ lat: 45.0, lon: 9.0 });
  });
});
