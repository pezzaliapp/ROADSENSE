/**
 * ROAD SENSE - la traccia TTS osserva e non interferisce.
 *
 * Due promesse, e la seconda conta piu' della prima.
 *
 * 1. La traccia distingue davvero i due guasti possibili su iPhone:
 *    "l'enunciato non e' mai partito" contro "e' partito e non si sente".
 *    Senza `onstart` erano indistinguibili, ed e' il motivo per cui la causa
 *    su iPhone non si e' ancora potuta stabilire.
 *
 * 2. La strumentazione NON cambia il comportamento della sintesi. Sarebbe il
 *    modo peggiore di indagare un guasto: modificare cio' che si sta
 *    osservando. Qui si verifica che le chiamate a `speechSynthesis` restino
 *    identiche, nello stesso ordine, e che la `onDone` arrivi come prima.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowserSpeechProvider, estimatedSpeechMs } from './BrowserSpeechProvider';
import { clearTtsTrace, traceTts, ttsTrace } from './ttsTrace';

/** Sintesi finta: registra le chiamate e lascia guidare il test agli eventi. */
function sintesiFinta() {
  const chiamate: string[] = [];
  let ultima: {
    text: string;
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onerror: ((e: { error: string }) => void) | null;
  } | null = null;

  class Utterance {
    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    constructor(readonly text: string) {}
  }

  const speechSynthesis = {
    speaking: false,
    pending: false,
    cancel: () => chiamate.push('cancel'),
    speak: (u: Utterance) => {
      chiamate.push('speak');
      ultima = u as unknown as NonNullable<typeof ultima>;
    },
  };

  vi.stubGlobal('window', { speechSynthesis });
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  return { chiamate, sintesi: speechSynthesis, ultimaUtterance: () => ultima };
}

beforeEach(() => {
  clearTtsTrace();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearTtsTrace();
});

describe('traccia TTS / registra il percorso dell enunciato', () => {
  it('enunciato riuscito: request, start, end', () => {
    const f = sintesiFinta();
    const provider = new BrowserSpeechProvider();
    provider.speak('Buca tra 50 metri.');

    f.ultimaUtterance()?.onstart?.();
    vi.advanceTimersByTime(1400);
    f.ultimaUtterance()?.onend?.();

    expect(ttsTrace().map((e) => e.kind)).toEqual(['request', 'start', 'end']);
    expect(ttsTrace()[0]?.text).toBe('Buca tra 50 metri.');
  });

  it('la richiesta riporta speaking e pending, come li vede il browser', () => {
    const f = sintesiFinta();
    f.sintesi.speaking = true;
    f.sintesi.pending = true;
    new BrowserSpeechProvider().speak('prova');
    expect(ttsTrace()[0]?.detail).toBe('speaking=true pending=true');
  });

  it('IL CASO IPHONE: watchdog senza start lo dichiara apertamente', () => {
    // E' la firma di "WebKit non ha mai avviato l'enunciato": nessun evento
    // fra la richiesta e il watchdog.
    sintesiFinta();
    const testo = 'Buca tra 50 metri.';
    new BrowserSpeechProvider().speak(testo);
    vi.advanceTimersByTime(estimatedSpeechMs(testo) + 1);

    const eventi = ttsTrace();
    expect(eventi.map((e) => e.kind)).toEqual(['request', 'watchdog']);
    expect(eventi[1]?.detail).toBe('NESSUN START');
  });

  it('L ALTRO CASO: partito ma senza end, il watchdog lo distingue', () => {
    // Firma opposta: la sintesi e' partita. Se non si sente, il guasto e'
    // nell'uscita audio, non nell'avvio.
    const f = sintesiFinta();
    const testo = 'Buca tra 50 metri.';
    new BrowserSpeechProvider().speak(testo);
    f.ultimaUtterance()?.onstart?.();
    vi.advanceTimersByTime(estimatedSpeechMs(testo) + 1);

    expect(ttsTrace().map((e) => e.kind)).toEqual(['request', 'start', 'watchdog']);
    expect(ttsTrace()[2]?.detail).toBe('era partito, nessun end');
  });

  it('un errore viene registrato con il suo codice', () => {
    const f = sintesiFinta();
    new BrowserSpeechProvider().speak('prova');
    f.ultimaUtterance()?.onerror?.({ error: 'not-allowed' });
    expect(ttsTrace().map((e) => e.kind)).toEqual(['request', 'error']);
    expect(ttsTrace()[1]?.detail).toBe('not-allowed');
  });

  it('conserva solo le ultime dieci righe', () => {
    for (let i = 0; i < 25; i++) traceTts('request', { text: `numero ${i}` });
    expect(ttsTrace()).toHaveLength(10);
    expect(ttsTrace()[9]?.text).toBe('numero 24');
  });
});

describe('traccia TTS / non cambia il comportamento della sintesi', () => {
  it('le chiamate a speechSynthesis restano cancel poi speak, e nient altro', () => {
    const f = sintesiFinta();
    new BrowserSpeechProvider().speak('prova');
    expect(f.chiamate).toEqual(['cancel', 'speak']);
  });

  it('nessun enunciato aggiuntivo: niente priming, niente speak silenziosi', () => {
    const f = sintesiFinta();
    const provider = new BrowserSpeechProvider();
    provider.speak('uno');
    f.ultimaUtterance()?.onend?.();
    expect(f.chiamate.filter((c) => c === 'speak')).toHaveLength(1);
  });

  it('onDone arriva una volta sola, con end e con watchdog', () => {
    const f = sintesiFinta();
    const provider = new BrowserSpeechProvider();
    let fatti = 0;
    provider.speak('uno', () => (fatti += 1));
    f.ultimaUtterance()?.onend?.();
    vi.advanceTimersByTime(estimatedSpeechMs('uno') + 1);
    expect(fatti).toBe(1);
  });

  it('i parametri della voce non sono stati toccati dalla strumentazione', () => {
    const f = sintesiFinta();
    new BrowserSpeechProvider().speak('prova');
    const u = f.ultimaUtterance();
    expect(u?.text).toBe('prova');
    expect((u as unknown as { lang: string }).lang).toBe('it-IT');
  });
});
