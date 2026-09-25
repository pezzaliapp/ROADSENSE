/**
 * ROAD SENSE - il corridoio davanti al veicolo.
 *
 * Scritti PRIMA dell'implementazione (Fase 1, ROUTE-02).
 *
 * La regola che questi test difendono, piu' di ogni altra: il corridoio deve
 * dichiarare SEMPRE da dove viene. La geometria stradale puo' costituire
 * evidenza di pertinenza; una proiezione sull'heading no. Confonderle
 * significherebbe far passare per "stessa strada" una direzione presunta, ed
 * e' esattamente l'errore che oggi permette a una buca su strada parallela di
 * generare un avviso.
 */

import { describe, expect, it } from 'vitest';

import { CORRIDOR } from '../config/config';
import {
  allowsRoadRelevance,
  buildForwardCorridor,
  corridorRoute,
  type RoadPolyline,
} from './forwardCorridor';
import { angleDeltaDeg, bearingDeg, destinationPoint, distanceM } from './geo';

const ORIGINE = { lat: 45.0, lon: 9.0 };

/** Polilinea rettilinea di `n` punti da `from` verso `bearing`. */
function retta(from: { lat: number; lon: number }, bearing: number, lunghezza: number, passo = 50): RoadPolyline {
  const points = [];
  for (let d = 0; d <= lunghezza; d += passo) points.push(destinationPoint(from, bearing, d));
  return { points };
}

/** Veicolo in marcia normale: 20 m/s (72 km/h). */
function veicolo(over: Partial<Parameters<typeof buildForwardCorridor>[0]> = {}) {
  return { position: ORIGINE, heading: 0, speedMps: 20, roads: [], ...over };
}

describe('A. strada rettilinea', () => {
  it('con geometria coerente il corridoio la segue e dichiara road-geometry', () => {
    const strada = retta(destinationPoint(ORIGINE, 180, 200), 0, 2000);
    const c = buildForwardCorridor(veicolo({ roads: [strada] }));

    expect(c.source).toBe('road-geometry');
    expect(c.roadEvidence).toBe(true);
    expect(c.status).toBe('reliable');
    expect(c.points.length).toBeGreaterThan(2);
  });

  it('il corridoio parte dalla zona del veicolo', () => {
    const strada = retta(destinationPoint(ORIGINE, 180, 200), 0, 2000);
    const c = buildForwardCorridor(veicolo({ roads: [strada] }));
    expect(distanceM(ORIGINE, c.points[0]!)).toBeLessThanOrEqual(CORRIDOR.snapRadiusM);
  });

  it('procede in avanti e non torna mai indietro', () => {
    const strada = retta(destinationPoint(ORIGINE, 180, 200), 0, 2000);
    const c = buildForwardCorridor(veicolo({ roads: [strada] }));

    for (const p of c.points.slice(1)) {
      expect(angleDeltaDeg(0, bearingDeg(ORIGINE, p))).toBeLessThan(90);
    }
    // Le distanze progressive crescono in modo monotono.
    for (let i = 1; i < c.points.length; i++) {
      expect(c.points[i]!.atM).toBeGreaterThan(c.points[i - 1]!.atM);
    }
  });
});

describe('B. curva', () => {
  it('segue la curvatura della strada invece di tirare dritto', () => {
    // Strada che piega progressivamente verso est.
    const points = [destinationPoint(ORIGINE, 180, 100)];
    let cur = points[0]!;
    for (let i = 0; i < 30; i++) {
      cur = destinationPoint(cur, i * 3, 50);
      points.push(cur);
    }
    const c = buildForwardCorridor(veicolo({ roads: [{ points }] }));

    expect(c.source).toBe('road-geometry');
    const ultimo = c.points.at(-1)!;
    // Il corridoio si e' spostato a est: una proiezione rettilinea non lo farebbe.
    expect(ultimo.lon).toBeGreaterThan(ORIGINE.lon);
  });
});

describe('C. biforcazione', () => {
  it('una biforcazione incerta NON viene presentata come certezza', () => {
    const tronco = retta(destinationPoint(ORIGINE, 180, 100), 0, 400);
    const nodo = tronco.points.at(-1)!;
    // Due rami ugualmente plausibili, entrambi "avanti".
    const ramoA = retta(nodo, 340, 1000);
    const ramoB = retta(nodo, 20, 1000);

    const c = buildForwardCorridor(veicolo({ roads: [tronco, ramoA, ramoB] }));

    expect(c.source).toBe('road-geometry');
    // Il corridoio si ferma al nodo invece di sceglierne uno.
    expect(c.status).toBe('uncertain');
    expect(c.confidence).toBeLessThan(CORRIDOR.reliableConfidence);
    const fine = c.points.at(-1)!;
    expect(distanceM(fine, nodo)).toBeLessThan(120);
  });

  it('con un solo proseguimento plausibile continua', () => {
    const tronco = retta(destinationPoint(ORIGINE, 180, 100), 0, 400);
    const nodo = tronco.points.at(-1)!;
    const prosegue = retta(nodo, 10, 1000);
    // Un ramo che torna indietro non e' un candidato.
    const indietro = retta(nodo, 170, 500);

    const c = buildForwardCorridor(veicolo({ roads: [tronco, prosegue, indietro] }));
    expect(c.status).toBe('reliable');
    expect(c.lengthM).toBeGreaterThan(500);
  });
});

describe('D. strada parallela vicina', () => {
  /** Due strade parallele a 30 m: il veicolo e' sulla prima. */
  const suCui = retta(destinationPoint(ORIGINE, 180, 200), 0, 2000);
  const parallela = retta(destinationPoint(destinationPoint(ORIGINE, 180, 200), 90, 30), 0, 2000);

  it('con geometria sufficiente segue la strada coerente, non la parallela', () => {
    const c = buildForwardCorridor(veicolo({ roads: [suCui, parallela] }));
    expect(c.source).toBe('road-geometry');
    // Ogni punto resta sulla strada percorsa, non salta su quella accanto.
    for (const p of c.points) {
      const dSu = distanzaDaPolilinea(p, suCui);
      const dPar = distanzaDaPolilinea(p, parallela);
      expect(dSu).toBeLessThan(dPar);
    }
  });

  it('con il solo heading NON dichiara quale delle due strade sia percorsa', () => {
    // Nessuna geometria disponibile: resta una proiezione, non una prova.
    const c = buildForwardCorridor(veicolo({ roads: [] }));
    expect(c.source).toBe('heading');
    expect(c.roadEvidence).toBe(false);
    expect(c.status).toBe('uncertain');
    expect(c.confidence).toBeLessThan(CORRIDOR.reliableConfidence);
  });
});

describe('E. evento dietro il veicolo', () => {
  it('il corridoio non copre mai cio\' che sta dietro', () => {
    const strada = retta(destinationPoint(ORIGINE, 180, 1000), 0, 3000);
    const c = buildForwardCorridor(veicolo({ roads: [strada] }));

    const dietro = destinationPoint(ORIGINE, 180, 150);
    for (const p of c.points) {
      expect(distanceM(p, dietro)).toBeGreaterThan(50);
    }
  });
});

describe('F. heading assente o incerto', () => {
  it('senza heading il corridoio non esiste', () => {
    const c = buildForwardCorridor(veicolo({ heading: null, roads: [retta(ORIGINE, 0, 2000)] }));
    expect(c.source).toBe('none');
    expect(c.status).toBe('unavailable');
    expect(c.points).toEqual([]);
    expect(c.roadEvidence).toBe(false);
    expect(c.confidence).toBe(0);
  });
});

describe('G. velocita\' zero', () => {
  it('da fermi la direzione non e\' attendibile: nessun corridoio', () => {
    const c = buildForwardCorridor(veicolo({ speedMps: 0, roads: [retta(ORIGINE, 0, 2000)] }));
    expect(c.source).toBe('none');
    expect(c.status).toBe('unavailable');
  });

  it('sotto la soglia minima nemmeno', () => {
    const c = buildForwardCorridor(veicolo({ speedMps: CORRIDOR.minSpeedMps - 0.1 }));
    expect(c.source).toBe('none');
  });
});

describe('H. GPS fuori dalla geometria stradale', () => {
  it('troppo lontano da qualsiasi strada: si ripiega sull\'heading, senza fingere', () => {
    const lontana = retta(destinationPoint(ORIGINE, 90, 500), 0, 2000);
    const c = buildForwardCorridor(veicolo({ roads: [lontana] }));
    expect(c.source).toBe('heading');
    expect(c.roadEvidence).toBe(false);
  });

  it('una polilinea disegnata al contrario e\' comunque la strada percorsa', () => {
    // Una polilinea stradale non ha verso di marcia: una strada digitalizzata
    // da nord a sud e' la stessa che si percorre da sud a nord. Va agganciata
    // e percorsa all'indietro, non scartata.
    const stessaStrada = retta(destinationPoint(ORIGINE, 0, 2000), 180, 2200);
    const c = buildForwardCorridor(veicolo({ roads: [stessaStrada] }));
    expect(c.source).toBe('road-geometry');
    // E il corridoio punta comunque verso nord, cioe' dove si sta andando.
    const fine = c.points.at(-1)!;
    expect(angleDeltaDeg(0, bearingDeg(ORIGINE, fine))).toBeLessThan(30);
  });

  it('una strada trasversale non viene agganciata', () => {
    // Un incrocio: la strada perpendicolare non e' quella che si percorre.
    const trasversale = retta(destinationPoint(ORIGINE, 270, 1000), 90, 2000);
    const c = buildForwardCorridor(veicolo({ roads: [trasversale] }));
    expect(c.source).toBe('heading');
    expect(c.roadEvidence).toBe(false);
  });
});

describe('I. nessuna geometria disponibile', () => {
  it('il corridoio heading esiste, e\' lungo e dichiarato incerto', () => {
    const c = buildForwardCorridor(veicolo({ roads: [] }));
    expect(c.source).toBe('heading');
    expect(c.points.length).toBeGreaterThan(2);
    expect(c.lengthM).toBeGreaterThan(0);
    expect(c.status).toBe('uncertain');
  });

  it('`roads` non fornito equivale a nessuna geometria', () => {
    const c = buildForwardCorridor({ position: ORIGINE, heading: 0, speedMps: 20 });
    expect(c.source).toBe('heading');
  });
});

describe('J. continuita\' oltre il segmento corrente', () => {
  it('prosegue su una polilinea successiva che continua la stessa strada', () => {
    const primo = retta(destinationPoint(ORIGINE, 180, 100), 0, 300);
    const secondo = retta(primo.points.at(-1)!, 5, 1500);
    const c = buildForwardCorridor(veicolo({ roads: [primo, secondo] }));

    expect(c.source).toBe('road-geometry');
    // Ha superato la fine del primo tratto.
    expect(c.lengthM).toBeGreaterThan(400);
  });

  it('non si unisce a una polilinea scollegata', () => {
    const primo = retta(destinationPoint(ORIGINE, 180, 100), 0, 300);
    const staccata = retta(destinationPoint(primo.points.at(-1)!, 0, 400), 0, 1000);
    const c = buildForwardCorridor(veicolo({ roads: [primo, staccata] }));
    expect(c.lengthM).toBeLessThan(450);
  });
});

describe('lunghezza coerente con la velocita\'', () => {
  it('piu\' veloce, corridoio piu\' lungo', () => {
    const lento = buildForwardCorridor(veicolo({ speedMps: 8 }));
    const veloce = buildForwardCorridor(veicolo({ speedMps: 36 }));
    expect(veloce.lengthM).toBeGreaterThan(lento.lengthM);
  });

  it('non esiste un raggio universale: minimo e massimo sono dichiarati', () => {
    const quasiFermo = buildForwardCorridor(veicolo({ speedMps: CORRIDOR.minSpeedMps }));
    const lanciato = buildForwardCorridor(veicolo({ speedMps: 200 }));
    expect(quasiFermo.lengthM).toBeGreaterThanOrEqual(CORRIDOR.minLengthM);
    expect(lanciato.lengthM).toBeLessThanOrEqual(CORRIDOR.maxLengthM);
  });

  it('la geometria stradale e\' limitata dal viewport, l\'heading no', () => {
    // Il corridoio da geometria non puo' superare cio' che la mappa ha in
    // memoria; quello da heading e' una proiezione e puo' andare oltre.
    const c = buildForwardCorridor(veicolo({ speedMps: 40, roads: [] }));
    expect(c.lengthM).toBeGreaterThan(CORRIDOR.roadMaxLengthM);
  });
});

describe('adattamento al contratto RouteAhead', () => {
  it('un corridoio inesistente non produce percorso', () => {
    const c = buildForwardCorridor(veicolo({ heading: null }));
    expect(corridorRoute(c)).toBeNull();
  });

  it('pointAt segue il corridoio e si ferma alla fine', () => {
    const strada = retta(destinationPoint(ORIGINE, 180, 100), 0, 2000);
    const c = buildForwardCorridor(veicolo({ roads: [strada] }));
    const route = corridorRoute(c)!;

    expect(route.pointAt(0)).not.toBeNull();
    const a100 = route.pointAt(100)!;
    expect(distanceM(ORIGINE, a100)).toBeGreaterThan(50);
    expect(route.pointAt(c.lengthM + 500)).toBeNull();
  });

  it('interpola fra due punti, non salta', () => {
    const strada = retta(destinationPoint(ORIGINE, 180, 100), 0, 2000);
    const route = corridorRoute(buildForwardCorridor(veicolo({ roads: [strada] })))!;
    const a = route.pointAt(120)!;
    const b = route.pointAt(130)!;
    expect(distanceM(a, b)).toBeLessThan(20);
  });
});

/** Distanza minima di un punto da una polilinea, per le asserzioni. */
function distanzaDaPolilinea(p: { lat: number; lon: number }, linea: RoadPolyline): number {
  let min = Infinity;
  for (const q of linea.points) min = Math.min(min, distanceM(p, q));
  return min;
}

/**
 * PERTINENZA STRADALE: CHI PUO' AFFERMARLA.
 *
 * Regressione introdotta dalla Fase 1 e corretta qui. Prima del corridoio,
 * fuori dalla demo il meteo non poteva dire "sul percorso": il percorso non
 * esisteva. Con il corridoio puo' - e con un corridoio costruito sul solo
 * heading direbbe una cosa che nessuno ha dimostrato: a trenta metri da una
 * strada parallela quella proiezione comprende entrambe.
 *
 * `allowsRoadRelevance` e' il punto unico in cui si decide. Non e' dedotto da
 * `status`: e' dedotto da DOVE viene la geometria.
 */
describe('affermare la pertinenza stradale', () => {
  const stradaDritta = retta(destinationPoint(ORIGINE, 180, 200), 0, 2000);

  it('1. road-geometry con evidenza: la pertinenza puo\' essere affermata', () => {
    const c = buildForwardCorridor(veicolo({ roads: [stradaDritta] }));
    expect(c.source).toBe('road-geometry');
    expect(c.roadEvidence).toBe(true);
    expect(allowsRoadRelevance(c)).toBe(true);
  });

  it('2. heading senza evidenza: la pertinenza NON puo\' essere affermata', () => {
    const c = buildForwardCorridor(veicolo({ roads: [] }));
    expect(c.source).toBe('heading');
    expect(c.roadEvidence).toBe(false);
    expect(allowsRoadRelevance(c)).toBe(false);
  });

  it('3. uncertain da heading non diventa automaticamente pertinente', () => {
    const c = buildForwardCorridor(veicolo({ roads: [] }));
    expect(c.status).toBe('uncertain');
    // La sola incertezza non basta a escludere; e' l'assenza di geometria a
    // farlo. Qui coincidono, ed e' il caso che conta.
    expect(allowsRoadRelevance(c)).toBe(false);
  });

  it('3b. uncertain da BIFORCAZIONE resta pertinente: il tratto percorso e\' strada vera', () => {
    // Il corridoio si ferma al nodo, ma i punti che contiene sono geometria
    // stradale reale. Un'intersezione dentro quel tratto e' davvero sulla
    // strada. La decisione e' esplicita, non implicita.
    const tronco = retta(destinationPoint(ORIGINE, 180, 100), 0, 400);
    const nodo = tronco.points.at(-1)!;
    const c = buildForwardCorridor(
      veicolo({ roads: [tronco, retta(nodo, 340, 800), retta(nodo, 20, 800)] }),
    );
    expect(c.status).toBe('uncertain');
    expect(c.source).toBe('road-geometry');
    expect(allowsRoadRelevance(c)).toBe(true);
  });

  it('4. none: nessuna falsa pertinenza', () => {
    const senzaHeading = buildForwardCorridor(veicolo({ heading: null }));
    const fermo = buildForwardCorridor(veicolo({ speedMps: 0 }));
    expect(allowsRoadRelevance(senzaHeading)).toBe(false);
    expect(allowsRoadRelevance(fermo)).toBe(false);
  });

  it('assenza di corridoio: nessuna pertinenza', () => {
    expect(allowsRoadRelevance(null)).toBe(false);
    expect(allowsRoadRelevance(undefined)).toBe(false);
  });
});
