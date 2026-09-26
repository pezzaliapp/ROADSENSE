/**
 * ROAD SENSE - la voce di risposta deve uscire anche su iPhone.
 *
 * IL GUASTO
 *
 * Sull'iPhone la segnalazione vocale veniva acquisita: "Buca" riconosciuta,
 * evento creato. Ma ROAD SENSE non pronunciava niente. Sul Samsung, con lo
 * stesso codice, parlava.
 *
 * Su iOS `speechSynthesis.speak()` e' consentita solo durante un'attivazione
 * dell'utente, e la prima chiamata deve avvenire li'. I nostri avvisi arrivano
 * dopo un comando vocale - quindi senza alcun gesto - e venivano scartati **in
 * silenzio**: nessun suono, nessun errore, nemmeno `onstart`. Il watchdog
 * chiudeva l'enunciato per tempo scaduto e la catena proseguiva come se avesse
 * parlato.
 *
 * La correzione consuma l'attivazione nel momento in cui esiste: il tocco su
 * VOCE. Un enunciato vuoto a volume zero, e da li' in poi il browser accetta
 * le chiamate successive.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowserSpeechProvider } from './BrowserSpeechProvider';

interface Detta {
  text: string;
  volume: number;
  lang: string;
}

/** Sintetizzatore finto, con la contabilita' di cancel/speak. */
function sintetizzatore() {
  const dette: Detta[] = [];
  let speaking = false;
  const pending = false;
  const cancels: number[] = [];
  const utterances: Record<string, unknown>[] = [];

  class FakeUtterance {
    volume = 1;
    lang = '';
    rate = 1;
    pitch = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {
      utterances.push(this as unknown as Record<string, unknown>);
    }
  }

  const synth = {
    get speaking() {
      return speaking;
    },
    get pending() {
      return pending;
    },
    speak(u: FakeUtterance) {
      dette.push({ text: u.text, volume: u.volume, lang: u.lang });
      speaking = true;
    },
    cancel() {
      cancels.push(dette.length);
      speaking = false;
    },
  };

  vi.stubGlobal('window', { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return {
    dette,
    cancels,
    utterances,
    finisci: () => {
      speaking = false;
      const u = utterances.at(-1) as { onend?: (() => void) | null } | undefined;
      u?.onend?.();
    },
    impostaOccupato: (v: boolean) => {
      speaking = v;
    },
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('sintesi / sblocco nel gesto dell utente', () => {
  it('prime pronuncia un enunciato vuoto a volume zero', () => {
    const s = sintetizzatore();
    new BrowserSpeechProvider().prime();
    expect(s.dette).toHaveLength(1);
    expect(s.dette[0]?.volume).toBe(0);
    expect(s.dette[0]?.text.trim()).toBe('');
    // La lingua e' comunque quella giusta: su alcuni motori serve a caricare
    // la voce prima del primo avviso vero.
    expect(s.dette[0]?.lang).toBe('it-IT');
  });

  it('prime non e udibile: non pronuncia testo', () => {
    const s = sintetizzatore();
    new BrowserSpeechProvider().prime();
    expect(s.dette.every((d) => d.volume === 0)).toBe(true);
  });

  it('prime avviene una volta sola, anche a tocchi ripetuti', () => {
    const s = sintetizzatore();
    const p = new BrowserSpeechProvider();
    p.prime();
    p.prime();
    p.prime();
    expect(s.dette).toHaveLength(1);
  });

  it('dopo lo sblocco gli avvisi veri vengono pronunciati a volume pieno', () => {
    const s = sintetizzatore();
    const p = new BrowserSpeechProvider();
    p.prime();
    p.speak('Buca tra 50 metri');
    expect(s.dette).toHaveLength(2);
    expect(s.dette[1]?.text).toBe('Buca tra 50 metri');
    expect(s.dette[1]?.volume).toBe(1);
  });

  it('senza sintesi disponibile prime non esplode', () => {
    vi.stubGlobal('window', {});
    expect(() => new BrowserSpeechProvider().prime()).not.toThrow();
  });
});

describe('sintesi / cancel solo quando serve', () => {
  it('non annulla nulla se il sintetizzatore e fermo', () => {
    // Su iOS una `cancel()` a vuoto puo' lasciare il motore in uno stato in
    // cui la `speak()` immediatamente successiva viene scartata in silenzio.
    const s = sintetizzatore();
    new BrowserSpeechProvider().speak('Buca tra 50 metri');
    expect(s.cancels).toHaveLength(0);
    expect(s.dette.map((d) => d.text)).toEqual(['Buca tra 50 metri']);
  });

  it('annulla se un avviso precedente e ancora in corso', () => {
    // In auto conta l'ultimo avviso, non la coda.
    const s = sintetizzatore();
    const p = new BrowserSpeechProvider();
    p.speak('primo');
    s.impostaOccupato(true);
    p.speak('secondo');
    expect(s.cancels).toHaveLength(1);
    expect(s.dette.map((d) => d.text)).toEqual(['primo', 'secondo']);
  });
});

describe('sintesi / regressione Android: continua a parlare', () => {
  it('tre avvisi consecutivi vengono pronunciati tutti', () => {
    const s = sintetizzatore();
    const p = new BrowserSpeechProvider();
    p.prime();
    for (const t of ['Buca tra 50 metri', 'Ostacolo tra 80 metri', 'Acqua tra 120 metri']) {
      p.speak(t);
      s.finisci();
    }
    expect(s.dette.map((d) => d.text)).toEqual([
      ' ',
      'Buca tra 50 metri',
      'Ostacolo tra 80 metri',
      'Acqua tra 120 metri',
    ]);
  });

  it('ogni avviso chiude il precedente: chi attende non resta appeso', () => {
    const s = sintetizzatore();
    const p = new BrowserSpeechProvider();
    const conclusi: string[] = [];
    p.speak('primo', () => conclusi.push('primo'));
    s.finisci();
    p.speak('secondo', () => conclusi.push('secondo'));
    s.finisci();
    expect(conclusi).toEqual(['primo', 'secondo']);
  });
});
