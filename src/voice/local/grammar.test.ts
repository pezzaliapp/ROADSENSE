/**
 * ROAD SENSE - la grammatica del decoder non puo' divergere dal parser.
 *
 * IL DIFETTO CHE QUESTI TEST RENDONO IMPOSSIBILE
 *
 * Il parser conosceva 39 pericoli. La grammatica Vosk ne ammetteva quattro:
 * `buca`, `ostacolo`, `acqua`, `incidente`. Le altre trentacinque categorie
 * erano codice irraggiungibile - "nebbia", "frana", "auto contromano" non
 * potevano essere DETTE, perche' il decoder non poteva produrre quelle parole.
 * Nulla segnalava il problema: due elenchi indipendenti, nessun legame.
 *
 * E c'e' un secondo modo, piu' silenzioso, di rompere la voce: mettere in
 * grammatica una parola che il MODELLO non conosce. Vosk la scarta con un
 * KALDI_WARN che nessuno legge (`recognizer.cc:84`) e prosegue. E' cosi' che
 * `possible_downburst` e' rimasto muto per tutta la vita del progetto: la sua
 * unica parola era "downburst", che in un modello italiano non esiste.
 *
 * I test qui sotto coprono entrambe le direzioni:
 *   LIVELLO 1  ogni parola del lessico e' pronunciabile
 *   LIVELLO 2  ogni parola della grammatica esiste nel modello
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalize, HAZARD_HINTS, RULES } from '../lexicon';
import { VOICE } from '../../config/config';
import { HAZARD_TYPES } from '../../hazard/taxonomy';
import { buildGrammar, UNKNOWN_TOKEN, VERIFIED_WORDS, VOICE_GRAMMAR } from './grammar';
import { seedPhrases, sourcePhrases, sourceTokens } from './grammarSource';
import { MODEL_VOCABULARY } from './modelVocabulary';
import { MODEL_BASE, MODEL_NAME, MODEL_PARTS } from './modelChunks';

/** I termini singoli della grammatica: l'unita' che Vosk cerca nel modello. */
const TERMINI = new Set(VOICE_GRAMMAR.filter((v) => !v.includes(' ') && v !== UNKNOWN_TOKEN));
const SEMI = VOICE_GRAMMAR.filter((v) => v.includes(' '));

/** true se l'intera espressione e' pronunciabile: serve OGNI sua parola. */
const dicibile = (frase: string): boolean => frase.split(' ').every((t) => TERMINI.has(t));

/**
 * Le parole che il modello italiano NON ha. Sono elencate qui perche' un nuovo
 * assente deve costringere a una decisione consapevole, non passare inosservato.
 *
 *   demergenza      artefatto di normalize() su "corsia d'emergenza": il parser
 *                   lo tollera in ingresso, nessuno lo pronuncia
 *   downburst       inglese. Resta nella tassonomia e nelle regole, ma NON deve
 *                   essere necessario dirlo: ci si arriva con bufera, tempesta,
 *                   burrasca, tromba d'aria
 *   incolonnamento  manca davvero fra le 200.006 parole del modello; coda,
 *                   ingorgo e rallentamento coprono lo stesso pericolo
 *   roadsense       varianti della parola di attivazione che esistono solo per
 *   rodesense       tolleranza del parser: si pronuncia "road sense", due parole
 */
const ASSENTI_ATTESI = ['demergenza', 'downburst', 'incolonnamento', 'roadsense', 'rodesense'];

// -- LIVELLO 1: la grammatica deriva dal lessico ----------------------------

describe('grammatica / derivata dalla fonte semantica, non scritta a mano', () => {
  it('ogni parola del lessico e pronunciabile, o e dichiarata assente dal modello', () => {
    const assenti = new Set<string>(MODEL_VOCABULARY.absent);
    for (const token of sourceTokens()) {
      expect(
        TERMINI.has(token) || assenti.has(token),
        `"${token}" e' nel lessico ma il decoder non puo' produrlo, e non risulta assente dal modello`,
      ).toBe(true);
    }
  });

  it('la grammatica non contiene parole estranee al lessico', () => {
    // Il senso della derivazione: niente entra qui che non venga da lexicon.ts.
    const candidati = new Set(sourceTokens());
    for (const t of TERMINI) {
      expect(candidati.has(t), `"${t}" e' in grammatica ma nessuna regola lo usa`).toBe(true);
    }
  });

  it('usa la STESSA normalize() del parser', () => {
    // Se le due normalizzazioni divergessero, la grammatica ammetterebbe una
    // forma che il parser non riconosce piu': un accento di troppo basterebbe.
    for (const voce of VOICE_GRAMMAR) {
      if (voce === UNKNOWN_TOKEN) continue;
      expect(normalize(voce), `"${voce}" non e' in forma normalizzata`).toBe(voce);
    }
  });

  it('nessuna voce vuota e nessun duplicato', () => {
    expect(VOICE_GRAMMAR.every((v) => v.trim().length > 0)).toBe(true);
    expect(new Set(VOICE_GRAMMAR).size).toBe(VOICE_GRAMMAR.length);
  });

  it('[unk] c e: al decoder resta il diritto di dire "non era nessuna di queste"', () => {
    expect(VOICE_GRAMMAR).toContain(UNKNOWN_TOKEN);
  });

  it('la parola di attivazione e pronunciabile', () => {
    // Senza di lei il decoder non puo' trascriverla, e in guida NESSUNA
    // segnalazione supera `stripWakeWord`: la voce sarebbe muta per intero.
    expect(dicibile(normalize('road sense'))).toBe(true);
    expect(VOICE.wakeWords.some((w) => dicibile(normalize(w)))).toBe(true);
  });

  it('le frasi-seme sono tutte multi-parola e interamente pronunciabili', () => {
    expect(SEMI.length).toBeGreaterThan(50);
    for (const frase of SEMI) {
      expect(frase).toContain(' ');
      expect(dicibile(frase), `il seme "${frase}" contiene una parola indicibile`).toBe(true);
    }
  });

  it('non enumera il prodotto pericolo x corsia', () => {
    // Misurato sul decoder: il modello di linguaggio e' di ORDINE 2 con backoff
    // (`language_model.cc:199`), quindi 1081 frasi enumerate producono un FST
    // piu' piccolo (42 stati) di 185 parole singole (186 stati). Enumerare non
    // aumenta la copertura: la comprime. Il numero di semi deve restare
    // dell'ordine delle espressioni del lessico, non del loro prodotto.
    expect(SEMI.length).toBeLessThan(120);
  });
});

describe('grammatica / la tassonomia e raggiungibile con la voce', () => {
  const conRegola = new Map<string, boolean>();
  for (const rule of RULES) {
    const ok = rule.all.every((gruppo) => gruppo.some(dicibile));
    conRegola.set(rule.hazard, (conRegola.get(rule.hazard) ?? false) || ok);
  }

  it.each(HAZARD_TYPES)('%s si puo dire', (hazard) => {
    if (hazard === 'unknown_hazard') {
      // Non ha regola: nasce da una frase che parla di pericolo senza dire quale.
      expect(HAZARD_HINTS.some(dicibile)).toBe(true);
      return;
    }
    expect(conRegola.get(hazard), `nessuna frase pronunciabile attiva ${hazard}`).toBe(true);
  });

  it('tutti e 39 i pericoli, non una parte', () => {
    expect(HAZARD_TYPES).toHaveLength(39);
  });

  it('le corsie da prima a quinta si possono dire', () => {
    for (const ordinale of ['prima', 'seconda', 'terza', 'quarta', 'quinta']) {
      expect(dicibile(`${ordinale} corsia`), `"${ordinale} corsia" non e' pronunciabile`).toBe(true);
    }
  });

  it('possible_downburst NON richiede di pronunciare "downburst"', () => {
    // E' la ragione per cui questo intervento esiste: la parola inglese non
    // esiste nel modello italiano, quindi il pericolo era muto.
    expect(TERMINI.has('downburst')).toBe(false);
    for (const italiano of ['bufera', 'tempesta', 'burrasca']) {
      expect(dicibile(italiano), `"${italiano}" non e' pronunciabile`).toBe(true);
    }
  });
});

// -- LIVELLO 2: ogni parola esiste nel modello ------------------------------

describe('grammatica / ammissibilita nel vocabolario Vosk', () => {
  it('ogni termine della grammatica e verificato nel certificato', () => {
    // E' il test che impedisce di introdurre una parola che Vosk scarterebbe in
    // silenzio: nessun errore in produzione, solo un pericolo che non si dice.
    for (const t of TERMINI) {
      expect(VERIFIED_WORDS.has(t), `"${t}" non risulta verificato nel modello`).toBe(true);
    }
  });

  it('il certificato e aggiornato: ogni candidato e classificato', () => {
    // Se qualcuno aggiunge un sinonimo al lessico senza rigenerare il
    // certificato, quella parola non e' ne' presente ne' assente: qui si rompe.
    const classificati = new Set<string>([...MODEL_VOCABULARY.present, ...MODEL_VOCABULARY.absent]);
    for (const token of sourceTokens()) {
      expect(
        classificati.has(token),
        `"${token}" non e' nel certificato: esegui "node scripts/verify-model-vocabulary.mjs"`,
      ).toBe(true);
    }
  });

  it('il certificato e legato allo SHA-256 del modello su disco', () => {
    // Un altro modello ha un altro vocabolario: il certificato non varrebbe piu'.
    const hash = createHash('sha256');
    for (let i = 0; i < MODEL_PARTS; i++) {
      const parte = join(process.cwd(), 'public', MODEL_BASE, `part-${String(i).padStart(2, '0')}`);
      hash.update(readFileSync(parte));
    }
    expect(hash.digest('hex')).toBe(MODEL_VOCABULARY.sha256);
    expect(MODEL_VOCABULARY.model).toBe(MODEL_NAME);
  });

  it('le parole assenti dal modello sono quelle dichiarate, e nessun altra', () => {
    expect([...MODEL_VOCABULARY.absent].sort()).toEqual(ASSENTI_ATTESI);
  });

  it('il modello resta un vocabolario italiano ampio, non ristretto', () => {
    // 200.006 parole: la copertura lessicale non e' il vincolo. Lo e' il fatto
    // che un token assente venga scartato senza dirlo.
    expect(MODEL_VOCABULARY.modelWords).toBeGreaterThan(100_000);
  });
});

describe('grammatica / il filtro sul vocabolario funziona davvero', () => {
  it('scarta i termini che il modello non conosce', () => {
    const finto = new Set(['buca', 'ostacolo', 'in', 'prima', 'corsia']);
    const g = buildGrammar(finto);
    expect(g).toContain('buca');
    expect(g).toContain('prima corsia');
    expect(g).toContain(UNKNOWN_TOKEN);
    expect(g).not.toContain('incidente');
  });

  it('scarta una frase-seme se le manca una sola parola', () => {
    // Un seme incompleto sarebbe indecodificabile: peso morto in grammatica.
    const senzaCorsia = new Set(['prima', 'buca']);
    expect(buildGrammar(senzaCorsia)).not.toContain('prima corsia');
  });

  it('con vocabolario vuoto resta solo [unk]', () => {
    expect(buildGrammar(new Set())).toEqual([UNKNOWN_TOKEN]);
  });

  it('e deterministica: due costruzioni danno lo stesso elenco', () => {
    expect(buildGrammar(VERIFIED_WORDS)).toEqual([...VOICE_GRAMMAR]);
  });

  it('la fonte espone frasi normalizzate e non vuote', () => {
    for (const f of sourcePhrases()) {
      expect(f.length).toBeGreaterThan(0);
      expect(normalize(f)).toBe(f);
    }
    expect(seedPhrases().every((f) => f.includes(' '))).toBe(true);
  });
});
