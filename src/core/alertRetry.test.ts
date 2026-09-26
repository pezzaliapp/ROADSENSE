/**
 * ROAD SENSE - il secondo avviso non deve sparire.
 *
 * IL GUASTO, COME SI PRESENTAVA IN AUTO
 *
 * Sul Samsung Fold il primo avviso veniva pronunciato, il secondo compariva a
 * schermo e restava muto. Terzo e quarto pure. Non era la sintesi: era la
 * combinazione di due meccanismi che, presi uno alla volta, sembravano
 * entrambi corretti.
 *
 *   `AlertEngine.evaluate()` sceglieva un alert e nella STESSA riga ne
 *   consumava il cooldown di due minuti;
 *
 *   `AlertSpeechEngine.announce()` poteva rifiutarsi di parlare, perche'
 *   impone otto secondi fra due enunciati qualsiasi - e restituiva `false`;
 *
 *   `App.tsx` buttava via quel `false`.
 *
 * Con il GPS a circa 1 Hz il risultato era questo:
 *
 *   t=0s  A  pronunciato,  A bruciato per 120 s
 *   t=1s  B  MOSTRATO, rifiutato (1 s < 8 s), B bruciato per 120 s
 *   t=2s  C  MOSTRATO, rifiutato (2 s < 8 s), C bruciato per 120 s
 *   t=8s  la voce e' libera, ma non resta piu' nulla da dire
 *
 * A 50 km/h, entro 120 secondi si e' percorso un chilometro e mezzo: B e C non
 * tornano mai piu' rilevanti. Erano persi per sempre.
 *
 * Adesso il cooldown appartiene a chi ha PARLATO: `evaluate()` propone e basta,
 * `confirmSpoken()` consuma. Un candidato rifiutato resta eleggibile e torna al
 * tick successivo, finche' la voce non e' libera di dirlo.
 *
 * Questo file riproduce la catena come la esegue `App.tsx`, non una sua
 * imitazione: stessi due motori, stesso ordine, stessa condizione di conferma.
 */

import { describe, expect, it } from 'vitest';

import { ALERT, SPEECH } from '../config/config';
import { AlertSpeechEngine } from '../speech/AlertSpeechEngine';
import type { SpeechProvider } from '../speech/SpeechProvider';
import { AlertEngine, type DriverState } from './AlertEngine';
import { destinationPoint } from './geo';
import type { EventCluster } from './types';

const ME = { lat: 45.4642, lon: 9.19 };
const SECONDO = 1000;

function driver(overrides: Partial<DriverState> = {}): DriverState {
  return { lat: ME.lat, lon: ME.lon, heading: 0, speedMps: 14, ...overrides };
}

/** Cluster a `dist` metri davanti, con un id proprio. */
function at(id: string, dist: number): EventCluster {
  const p = destinationPoint(ME, 0, dist);
  return {
    id,
    lat: p.lat,
    lon: p.lon,
    type: 'pothole',
    severity: 2,
    confidence: 0.8,
    count: 3,
    reporters: 3,
    lastTs: 0,
    heading: null,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
}

/**
 * La catena di `App.tsx`: valuta, mostra, prova a parlare, e conferma SOLO se
 * ha parlato davvero. Se qui e in `App.tsx` l'ordine divergesse, questo file
 * verificherebbe una fantasia; per questo la condizione di conferma e'
 * riportata identica, commento compreso.
 */
function catena(supportata = true) {
  const alert = new AlertEngine();
  const dette: { t: number; testo: string }[] = [];
  const provider: SpeechProvider = {
    id: 'test',
    isSupported: () => supportata,
    speak: (testo, onDone) => {
      dette.push({ t: -1, testo });
      onDone?.();
    },
    cancel: () => undefined,
  };
  const voce = new AlertSpeechEngine(provider);

  /** Un aggiornamento GPS. Ritorna cosa e' stato MOSTRATO e se e' stato DETTO. */
  const tick = (clusters: EventCluster[], now: number) => {
    const next = alert.evaluate(clusters, driver(), now);
    if (!next) return { mostrato: null, detto: false };
    const parlato = voce.announce(next.cluster.id, `avviso ${next.cluster.id}`, now);
    if (parlato) dette[dette.length - 1]!.t = now;
    if (parlato || !voce.isSupported()) alert.confirmSpoken(next.clusterId, now);
    return { mostrato: next.clusterId, detto: parlato };
  };

  return { tick, dette };
}

/**
 * Tre pericoli davanti, a distanze diverse. L'ordine di annuncio lo decide
 * `evaluate`, che sceglie sempre il PIU' VICINO fra quelli ancora da dire:
 * quando sono tutti gia' rilevanti, si parla prima del piu' imminente.
 */
const A = at('A', 30);
const B = at('B', 40);
const C = at('C', 50);

describe('avvisi consecutivi / il cooldown appartiene a chi ha parlato', () => {
  it('1. A pronunciato: il suo cooldown viene consumato', () => {
    const c = catena();
    expect(c.tick([A], 0)).toEqual({ mostrato: 'A', detto: true });
    // Consumato davvero: entro i 120 s A non viene piu' nemmeno proposto.
    expect(c.tick([A], SECONDO).mostrato).toBeNull();
    expect(c.tick([A], ALERT.cooldownMs - 1).mostrato).toBeNull();
  });

  it('2. B rifiutato per minGap: il suo cooldown NON viene consumato', () => {
    const c = catena();
    c.tick([A, B], 0); // A parla
    const secondo = c.tick([A, B], SECONDO);
    expect(secondo.mostrato).toBe('B'); // mostrato a schermo
    expect(secondo.detto).toBe(false); // ma rifiutato: 1 s < 8 s
  });

  it('3. B viene riproposto ai tick successivi', () => {
    const c = catena();
    c.tick([A, B], 0);
    // Ogni secondo fino agli 8: B continua a essere proposto, non sparisce.
    for (let t = SECONDO; t < SPEECH.minGapMs; t += SECONDO) {
      expect(c.tick([A, B], t).mostrato, `al secondo ${t / 1000} B non e' stato riproposto`).toBe(
        'B',
      );
    }
  });

  it('4. appena la voce e libera B viene pronunciato, e allora consuma', () => {
    const c = catena();
    c.tick([A, B], 0);
    for (let t = SECONDO; t < SPEECH.minGapMs; t += SECONDO) c.tick([A, B], t);

    const liberata = c.tick([A, B], SPEECH.minGapMs);
    expect(liberata).toEqual({ mostrato: 'B', detto: true });
    // Da qui in poi B tace, come deve.
    expect(c.tick([A, B], SPEECH.minGapMs + SECONDO).mostrato).toBeNull();
  });

  it('5. A, B e C differenti vengono pronunciati TUTTI, dal piu vicino', () => {
    // E' il requisito: tre pericoli diversi, tre avvisi. Nessuno dei tre puo'
    // essere perso perche' un altro ha parlato per primo.
    const c = catena();
    const tutti = [A, B, C];
    for (let t = 0; t <= 3 * SPEECH.minGapMs; t += SECONDO) c.tick(tutti, t);

    expect(c.dette.map((d) => d.testo)).toEqual(['avviso A', 'avviso B', 'avviso C']);
    // Distanziati almeno dal gap minimo: non si accavallano mai.
    const istanti = c.dette.map((d) => d.t);
    expect(istanti[0]).toBe(0);
    for (let i = 1; i < istanti.length; i++) {
      expect(istanti[i]! - istanti[i - 1]!).toBeGreaterThanOrEqual(SPEECH.minGapMs);
    }
  });

  it('5b. il guasto storico non torna: prima solo A parlava', () => {
    // La stessa sequenza con la vecchia regola - cooldown consumato al momento
    // della proposta - produceva un solo enunciato su tre. Qui si dimostra che
    // adesso ne produce tre, cioe' che il difetto e' davvero rimosso.
    const c = catena();
    for (let t = 0; t <= 3 * SPEECH.minGapMs; t += SECONDO) c.tick([A, B, C], t);
    expect(c.dette).toHaveLength(3);
  });

  it('6. lo STESSO avviso continua a rispettare il cooldown', () => {
    // Il fix non deve trasformarsi in una voce che ripete la stessa buca.
    const c = catena();
    c.tick([A], 0);
    for (let t = SECONDO; t < ALERT.cooldownMs; t += 5 * SECONDO) {
      expect(c.tick([A], t).detto, `A ripetuto al secondo ${t / 1000}`).toBe(false);
    }
    expect(c.dette).toHaveLength(1);
    // Superato il cooldown, e solo allora, A puo' tornare.
    expect(c.tick([A], ALERT.cooldownMs + 1).detto).toBe(true);
    expect(c.dette).toHaveLength(2);
  });
});

describe('avvisi consecutivi / come accade davvero guidando', () => {
  it('pericoli che diventano rilevanti uno dopo l altro vengono detti tutti', () => {
    // In strada i cluster non compaiono insieme: entrano nel raggio via via
    // che ci si avvicina. E' la sequenza del test reale sul Fold - "Buca tra
    // 50 metri", poi un secondo avviso un secondo dopo - che prima produceva
    // un solo enunciato.
    const c = catena();
    const visibili: EventCluster[] = [A];
    for (let t = 0; t <= 3 * SPEECH.minGapMs; t += SECONDO) {
      if (t === SECONDO) visibili.push(B);
      if (t === 2 * SECONDO) visibili.push(C);
      c.tick(visibili, t);
    }
    expect(c.dette.map((d) => d.testo)).toEqual(['avviso A', 'avviso B', 'avviso C']);
  });
});

describe('avvisi consecutivi / nessun ciclo infinito senza sintesi', () => {
  it('senza voce disponibile l alert non viene riproposto all infinito', () => {
    // `announce` non potra' MAI restituire true: senza la seconda condizione
    // della conferma, lo stesso alert tornerebbe a ogni aggiornamento GPS per
    // sempre, e il banner non si spegnerebbe mai.
    const c = catena(false);
    expect(c.tick([A], 0).mostrato).toBe('A');
    expect(c.tick([A], SECONDO).mostrato).toBeNull();
    expect(c.tick([A], 10 * SECONDO).mostrato).toBeNull();
    expect(c.dette).toHaveLength(0);
  });
});
