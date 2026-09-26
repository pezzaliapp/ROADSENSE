/**
 * ROAD SENSE - la guida non puo' promettere cio' che il sistema non capisce.
 *
 * DUE DIREZIONI, ED E' LA SECONDA QUELLA CHE SI DIMENTICA
 *
 * 1. Ogni frase mostrata a chi guida viene passata al parser VERO e deve
 *    produrre esattamente il pericolo dichiarato. Una guida che suggerisce
 *    parole non riconosciute e' peggio di nessuna guida: chi e' in auto
 *    prova, non succede niente, e smette di fidarsi della voce.
 *
 * 2. Ogni capacita' vocale realmente raggiungibile deve comparire nella
 *    guida. E' il CERTIFICATO DI COPERTURA: se un giorno si aggiunge un
 *    pericolo al lessico e ci si dimentica di raccontarlo, qui si rompe.
 *    Senza questo controllo la guida invecchierebbe in silenzio, esattamente
 *    come era invecchiata la grammatica rispetto al parser.
 *
 * La copertura non si misura sui 39 pericoli teorici ma su quelli
 * effettivamente pronunciabili: la domanda giusta non e' "quanti ne conosce
 * la tassonomia" ma "quanti puo' scoprirne una persona".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HAZARD_TYPES, type HazardType } from '../hazard/taxonomy';
import { VOICE_GRAMMAR } from '../voice/local/grammar';
import { HAZARD_HINTS, normalize, RULES } from '../voice/lexicon';
import { parseVoiceReport } from '../voice/parser';
import { FAVOURITES, PRECISE_EXAMPLES, VOICE_GUIDE, type GuideItem } from './voiceGuide';

const TERMINI = new Set(VOICE_GRAMMAR.filter((v) => !v.includes(' ') && v !== '[unk]'));

/** Il decoder puo' davvero produrre questa frase? */
const dicibile = (frase: string): boolean =>
  normalize(frase)
    .split(' ')
    .every((t) => TERMINI.has(t));

/** Cosa capisce il parser, senza parola di attivazione: come fa `App.tsx`. */
const capito = (frase: string) => parseVoiceReport(frase, { requireWakeWord: false });

const TUTTI: readonly { item: GuideItem; categoria: string }[] = VOICE_GUIDE.flatMap((c) =>
  c.items.map((item) => ({ item, categoria: c.title })),
);

/**
 * I pericoli che una persona puo' davvero far scattare parlando: si generano
 * tutte le combinazioni ammesse dalle regole, si tengono quelle pronunciabili
 * e si guarda cosa produce il parser. E' una misura, non una dichiarazione.
 */
function pericoliRaggiungibili(): Set<HazardType> {
  const raggiunti = new Set<HazardType>();
  const prova = (frase: string): void => {
    if (!dicibile(frase)) return;
    const esito = capito(frase);
    if (esito.ok) raggiunti.add(esito.report.hazard);
  };
  for (const regola of RULES) {
    let combinazioni: string[] = [''];
    for (const gruppo of regola.all) {
      const successive: string[] = [];
      for (const parziale of combinazioni) {
        for (const alternativa of gruppo) {
          successive.push(parziale ? `${parziale} ${alternativa}` : alternativa);
        }
      }
      combinazioni = successive;
    }
    for (const frase of combinazioni) prova(frase);
  }
  for (const hint of HAZARD_HINTS) prova(hint);
  return raggiunti;
}

// -- 1. nessuna frase falsa -------------------------------------------------

describe('guida vocale / ogni frase mostrata funziona davvero', () => {
  it.each(TUTTI)('"$item.say" viene capita come $item.hazard', ({ item }) => {
    const esito = capito(item.say);
    expect(esito.ok, `"${item.say}" non viene capita dal parser`).toBe(true);
    if (!esito.ok) return;
    expect(esito.report.hazard).toBe(item.hazard);
  });

  it.each(TUTTI)('"$item.say" e pronunciabile dal decoder', ({ item }) => {
    expect(dicibile(item.say), `"${item.say}" contiene parole fuori grammatica`).toBe(true);
  });

  it('ogni sinonimo mostrato porta allo STESSO pericolo', () => {
    // Mostrare due modi di dire la stessa cosa e' una promessa precisa: se
    // portassero a categorie diverse, la guida insegnerebbe un errore.
    for (const { item } of TUTTI) {
      for (const sinonimo of item.also ?? []) {
        expect(dicibile(sinonimo), `sinonimo "${sinonimo}" non pronunciabile`).toBe(true);
        const esito = capito(sinonimo);
        expect(esito.ok, `sinonimo "${sinonimo}" non capito`).toBe(true);
        if (!esito.ok) continue;
        expect(esito.report.hazard, `"${sinonimo}" non equivale a "${item.say}"`).toBe(
          item.hazard,
        );
      }
    }
  });
});

// -- 2. i preferiti ---------------------------------------------------------

describe('guida vocale / le dieci parole della prima schermata', () => {
  it('sono dieci', () => {
    expect(FAVOURITES).toHaveLength(10);
  });

  it.each(FAVOURITES)('"%s" e pronunciabile e viene capita', (parola) => {
    expect(dicibile(parola), `"${parola}" non e' pronunciabile`).toBe(true);
    expect(capito(parola).ok, `"${parola}" non viene capita`).toBe(true);
  });

  it('ognuna compare anche nel catalogo completo', () => {
    // Prima schermata e catalogo non devono raccontare due cose diverse.
    const nel = new Set(TUTTI.flatMap(({ item }) => [item.say, ...(item.also ?? [])]));
    for (const parola of FAVOURITES) {
      expect(nel.has(parola), `"${parola}" non compare nel catalogo`).toBe(true);
    }
  });
});

// -- 3. le frasi piu' precise ----------------------------------------------

describe('guida vocale / dire la corsia', () => {
  it.each(PRECISE_EXAMPLES)('"$say" da $hazard in $lane', ({ say, hazard, lane }) => {
    expect(dicibile(say), `"${say}" non pronunciabile`).toBe(true);
    const esito = capito(say);
    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    expect(esito.report.hazard).toBe(hazard);
    // La corsia non viene MAI dedotta: se compare, e' perche' e' stata detta.
    expect(esito.report.lane).toBe(lane);
  });

  it('copre tutte e cinque le corsie numerate', () => {
    const corsie = new Set(PRECISE_EXAMPLES.map((e) => e.lane));
    for (const attesa of ['first_lane', 'second_lane', 'third_lane', 'fourth_lane', 'fifth_lane']) {
      expect(corsie.has(attesa as never), `manca un esempio per ${attesa}`).toBe(true);
    }
  });
});

// -- 4. CERTIFICATO DI COPERTURA -------------------------------------------

describe('guida vocale / certificato di copertura', () => {
  const raggiungibili = pericoliRaggiungibili();
  const rappresentati = new Set(TUTTI.map(({ item }) => item.hazard));

  it('tutti i pericoli della tassonomia sono raggiungibili con la voce', () => {
    // Se un giorno non fosse piu' vero, il numero qui sotto lo direbbe.
    expect(raggiungibili.size).toBe(HAZARD_TYPES.length);
  });

  it('OGNI capacita vocale reale e rappresentata nella guida', () => {
    // E' il controllo che invecchia bene: aggiungere un pericolo al lessico
    // senza raccontarlo qui fa fallire questo test.
    const dimenticati = [...raggiungibili].filter((h) => !rappresentati.has(h));
    expect(dimenticati, `capacita' vocali non raccontate: ${dimenticati.join(', ')}`).toEqual([]);
  });

  it('la guida non racconta capacita inesistenti', () => {
    const inventati = [...rappresentati].filter((h) => !raggiungibili.has(h));
    expect(inventati, `pericoli mostrati ma non pronunciabili: ${inventati.join(', ')}`).toEqual(
      [],
    );
  });

  it('nessuna categoria e vuota', () => {
    for (const categoria of VOICE_GUIDE) {
      expect(categoria.items.length, `categoria vuota: ${categoria.title}`).toBeGreaterThan(0);
    }
  });

  it('nessun pericolo compare due volte, nessuna frase duplicata', () => {
    expect(rappresentati.size).toBe(TUTTI.length);
    const frasi = TUTTI.flatMap(({ item }) => [item.say, ...(item.also ?? [])]);
    expect(new Set(frasi).size).toBe(frasi.length);
  });
});

// -- 5. il pannello e' informativo, non operativo --------------------------

describe('guida vocale / il pannello non puo generare segnalazioni', () => {
  const pannello = readFileSync(join(process.cwd(), 'src', 'ui', 'VoiceGuidePanel.tsx'), 'utf8');
  const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

  it('le parole di PROVA A DIRE sono span, non pulsanti', () => {
    // Se diventassero `button` qualcuno prima o poi ci attaccherebbe una
    // segnalazione, e la guida inviterebbe a toccare lo schermo guidando.
    const chips = /FAVOURITES\.map\([\s\S]*?\)\)/.exec(pannello)?.[0] ?? '';
    expect(chips).toContain('<span className="guide-chip"');
    expect(chips).not.toContain('<button');
    expect(chips).not.toContain('onClick');
  });

  it('non riceve ne puo invocare la funzione di segnalazione', () => {
    // Nessun accesso al percorso che crea eventi: non e' una questione di
    // disciplina, non ha proprio i mezzi.
    expect(pannello).not.toContain('onSelect');
    expect(pannello).not.toContain('report');
    expect(pannello).not.toContain('recordEvent');
    expect(pannello).not.toContain('EventStore');
  });

  it('i soli gestori di tocco sono chiudere e aprire il catalogo', () => {
    // Tre in tutto: sfondo che chiude, "vedi tutto", CHIUDI. Nessun quarto.
    const gestori = [...pannello.matchAll(/onClick=\{([\s\S]*?)\}\s*[>\n]/g)].map((m) =>
      (m[1] ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(gestori).toHaveLength(3);
    for (const gestore of gestori) {
      const lecito = /onClose|setTutto\(true\)/.test(gestore);
      expect(lecito, `gestore inatteso: ${gestore}`).toBe(true);
    }
  });

  it('non e una pagina nuova e non tocca l indirizzo', () => {
    expect(pannello).not.toContain('pushState');
    expect(pannello).not.toContain('location');
    expect(pannello).not.toContain('href');
  });

  it('dice quando consultarla', () => {
    expect(pannello).toContain('prima di partire o a veicolo fermo');
  });

  it('spiega la sequenza d uso, VOCE prima di START', () => {
    const passi = /guide-steps[\s\S]*?<\/ol>/.exec(pannello)?.[0] ?? '';
    expect(passi.indexOf('Attiva VOCE')).toBeGreaterThan(-1);
    expect(passi.indexOf('Attiva VOCE')).toBeLessThan(passi.indexOf('Premi START'));
    expect(passi).toContain('segnala parlando');
  });

  it('il catalogo completo non e aperto in partenza', () => {
    // Prima schermata semplice: dieci parole, non trentanove voci.
    expect(pannello).toContain('useState(false)');
    expect(pannello).toContain('Vedi tutto quello che puoi segnalare');
  });

  it('l applicazione lo apre da un punto discreto e lo puo chiudere', () => {
    expect(app).toContain('Cosa posso dire?');
    expect(app).toContain('setGuideOpen(true)');
    expect(app).toContain('onClose={() => setGuideOpen(false)}');
  });
});
