/**
 * ROAD SENSE - mentre parla, non ascolta.
 *
 * Senza questo, la voce sintetica rientra dal microfono: "Attenzione, buca
 * segnalata" verrebbe riconosciuta come una segnalazione di buca, che genera
 * un avviso, che viene pronunciato, che viene riconosciuto. Un anello chiuso.
 *
 * E su iOS c'e' un secondo motivo: sintesi e riconoscimento si contendono la
 * stessa sessione audio.
 */

import { describe, expect, it, vi } from 'vitest';

import { SPEECH } from '../config/config';
import { AlertSpeechEngine } from './AlertSpeechEngine';
import { BrowserSpeechProvider, estimatedSpeechMs } from './BrowserSpeechProvider';
import type { SpeechProvider } from './SpeechProvider';

/** Sintesi pilotabile: si decide quando l'enunciato finisce. */
class ControlledSpeech implements SpeechProvider {
  readonly id = 'controlled';
  spoken: string[] = [];
  private done: (() => void) | null = null;

  isSupported(): boolean {
    return true;
  }
  speak(text: string, onDone?: () => void): void {
    this.spoken.push(text);
    this.done = onDone ?? null;
  }
  cancel(): void {
    this.finish();
  }
  /** Il browser dichiara concluso l'enunciato. */
  finish(): void {
    const d = this.done;
    this.done = null;
    d?.();
  }
}

function setup() {
  const provider = new ControlledSpeech();
  const transizioni: boolean[] = [];
  const engine = new AlertSpeechEngine(provider, {
    onSpeakingChange: (speaking) => transizioni.push(speaking),
  });
  return { provider, engine, transizioni };
}

describe('il riconoscitore viene avvisato', () => {
  it('annuncia l\'inizio e la fine di ogni enunciato', () => {
    const { provider, engine, transizioni } = setup();
    expect(engine.announce('c1', 'Buca tra 300 metri.', 0)).toBe(true);
    expect(transizioni).toEqual([true]);
    expect(engine.isSpeaking()).toBe(true);

    provider.finish();
    expect(transizioni).toEqual([true, false]);
    expect(engine.isSpeaking()).toBe(false);
  });

  it('un avviso non pronunciato non chiude l\'ascolto', () => {
    // Deduplicato o troppo ravvicinato: se avvisasse comunque, il
    // riconoscitore verrebbe chiuso per un enunciato che non esiste.
    const { engine, transizioni } = setup();
    engine.announce('c1', 'Buca tra 300 metri.', 0);
    transizioni.length = 0;

    expect(engine.announce('c1', 'Buca tra 250 metri.', 1000)).toBe(false);
    expect(transizioni).toEqual([]);
  });

  it('una doppia conferma di fine non riapre l\'ascolto due volte', () => {
    // Il watchdog e l'evento reale possono arrivare entrambi.
    const { provider, engine, transizioni } = setup();
    engine.announce('c1', 'Buca tra 300 metri.', 0);
    provider.finish();
    provider.finish();
    expect(transizioni).toEqual([true, false]);
  });

  it('reset riapre l\'ascolto: nessun enunciato resta in sospeso', () => {
    const { engine, transizioni } = setup();
    engine.announce('c1', 'Buca tra 300 metri.', 0);
    engine.reset();
    expect(transizioni).toEqual([true, false]);
    expect(engine.isSpeaking()).toBe(false);
  });

  it('senza sintesi non si dichiara mai di stare parlando', () => {
    const transizioni: boolean[] = [];
    const muto: SpeechProvider = {
      id: 'muto',
      isSupported: () => false,
      speak: (_t, onDone) => onDone?.(),
      cancel: () => undefined,
    };
    const engine = new AlertSpeechEngine(muto, {
      onSpeakingChange: (s) => transizioni.push(s),
    });
    expect(engine.announce('c1', 'Buca tra 300 metri.', 0)).toBe(false);
    expect(transizioni).toEqual([]);
  });
});

describe('deduplicazione degli avvisi parlati', () => {
  it('lo stesso evento non viene ripetuto di continuo', () => {
    const { provider, engine } = setup();
    let t = 0;
    engine.announce('c1', 'Buca tra 300 metri.', t);
    provider.finish();

    // Per tutto il periodo di attesa, la stessa buca resta muta.
    for (t = SPEECH.minGapMs; t < SPEECH.cooldownMs; t += SPEECH.minGapMs) {
      engine.announce('c1', `Buca tra ${300 - t / 100} metri.`, t);
    }
    expect(provider.spoken).toHaveLength(1);

    // Passato il periodo, si puo' ridire.
    engine.announce('c1', 'Buca tra 100 metri.', SPEECH.cooldownMs + 1);
    expect(provider.spoken).toHaveLength(2);
  });

  it('due avvisi diversi non si accavallano', () => {
    const { provider, engine } = setup();
    engine.announce('c1', 'Buca tra 300 metri.', 0);
    provider.finish();
    expect(engine.announce('c2', 'Acqua tra 500 metri.', SPEECH.minGapMs - 1)).toBe(false);
    expect(engine.announce('c2', 'Acqua tra 500 metri.', SPEECH.minGapMs + 1)).toBe(true);
  });
});

describe('rete di sicurezza sulla durata', () => {
  it('un enunciato si considera finito anche se il browser tace', () => {
    // Su iOS `onend` a volte non arriva. Senza limite, l'ascolto resterebbe
    // chiuso per sempre: la voce smetterebbe di funzionare del tutto.
    vi.useFakeTimers();
    class Utterance {
      lang = '';
      rate = 1;
      pitch = 1;
      volume = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    // Una sintesi che accetta l'enunciato ma non emette mai `end`.
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    vi.stubGlobal('window', {
      speechSynthesis: { cancel: () => undefined, speak: () => undefined },
    });

    const provider = new BrowserSpeechProvider();
    const testo = 'Attenzione. Buca tra 300 metri.';
    let finito = false;
    provider.speak(testo, () => {
      finito = true;
    });
    expect(finito).toBe(false);

    vi.advanceTimersByTime(estimatedSpeechMs(testo) + 10);
    expect(finito).toBe(true);

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('la durata stimata resta entro limiti ragionevoli', () => {
    expect(estimatedSpeechMs('')).toBe(SPEECH.minUtteranceMs);
    expect(estimatedSpeechMs('x'.repeat(10_000))).toBe(SPEECH.maxUtteranceMs);
    const media = estimatedSpeechMs('Attenzione. Buca tra 300 metri.');
    expect(media).toBeGreaterThanOrEqual(SPEECH.minUtteranceMs);
    expect(media).toBeLessThanOrEqual(SPEECH.maxUtteranceMs);
  });
});
