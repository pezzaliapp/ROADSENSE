/**
 * ROAD SENSE - una sessione di ascolto per tocco.
 *
 * Nasce dal test su strada col Samsung Fold: il microfono si riapriva circa
 * ogni secondo e mezzo, facendo suonare il tono di attivazione di Android a
 * ripetizione, e dire "buca" non produceva nulla.
 *
 * Le due cause erano distinte e sono entrambe coperte qui:
 *   - il ciclo di riapertura automatica;
 *   - la parola di attivazione obbligatoria.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VOICE } from '../config/config';
import { hazardFamily } from '../hazard/taxonomy';
import {
  BrowserVoiceProvider,
  resetOnDeviceState,
  type VoiceEnvironment,
} from './BrowserVoiceProvider';
import { parseVoiceReport } from './parser';

const ROOT = resolve(import.meta.dirname, '..', '..');

/** Riconoscitore finto che registra tutto cio' che gli viene fatto. */
class FakeRecognition {
  static live = 0;
  static created: FakeRecognition[] = [];

  lang = '';
  continuous = true;
  interimResults = true;
  maxAlternatives = 0;
  started = false;
  aborted = 0;

  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onaudioend: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;
  onsoundend: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onnomatch: (() => void) | null = null;

  constructor() {
    FakeRecognition.created.push(this);
  }

  start(): void {
    this.started = true;
    FakeRecognition.live++;
    this.onstart?.();
  }
  stop(): void {
    this.finish();
  }
  abort(): void {
    this.aborted++;
    this.finish();
  }
  private finish(): void {
    if (!this.started) return;
    this.started = false;
    FakeRecognition.live--;
    this.onend?.();
  }
  /** Chiusura spontanea dopo una frase o un silenzio, tipica di Android. */
  endByItself(): void {
    this.finish();
  }
  /** Consegna una frase definitiva. */
  say(text: string): void {
    this.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: text } } },
    });
  }
}

function makeEnv(): VoiceEnvironment {
  return {
    ctor: () => FakeRecognition as unknown as new () => never,
    apiName: () => 'SpeechRecognition',
    isVisible: () => true,
    onVisibilityChange: () => () => undefined,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h),
  };
}

/** Consenso all'elaborazione remota dato: qui si verifica la sessione. */
function provider() {
  return new BrowserVoiceProvider(true, makeEnv());
}

beforeEach(() => {
  FakeRecognition.live = 0;
  FakeRecognition.created = [];
  resetOnDeviceState();
  vi.useFakeTimers();
});

describe('un tocco, una sessione', () => {
  it('apre un solo riconoscitore', () => {
    provider().start({});
    expect(FakeRecognition.created).toHaveLength(1);
    expect(FakeRecognition.live).toBe(1);
  });

  it('non usa l\'ascolto continuo', () => {
    provider().start({});
    expect(FakeRecognition.created[0]!.continuous).toBe(false);
  });

  it('ignora i risultati parziali', () => {
    provider().start({});
    expect(FakeRecognition.created[0]!.interimResults).toBe(false);
  });

  it('un doppio tocco NON apre un secondo microfono', () => {
    const p = provider();
    p.start({});
    p.start({});
    p.start({});
    expect(FakeRecognition.created).toHaveLength(1);
    expect(p.isListening()).toBe(true);
  });
});

describe('nessun riavvio automatico', () => {
  it('dopo onend non si riapre nulla, mai', () => {
    // E' il difetto osservato sul Fold: un tono ogni secondo e mezzo.
    const p = provider();
    p.start({});
    FakeRecognition.created[0]!.endByItself();

    vi.advanceTimersByTime(600_000); // dieci minuti
    expect(FakeRecognition.created).toHaveLength(1);
    expect(FakeRecognition.live).toBe(0);
    expect(p.isListening()).toBe(false);
  });

  it('dopo no-speech non si riapre nulla', () => {
    // `no-speech` arriva a ogni silenzio: prima era gratuito e il ciclo
    // ripartiva all'infinito.
    const p = provider();
    p.start({});
    FakeRecognition.created[0]!.onerror?.({ error: 'no-speech' });

    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.created).toHaveLength(1);
    expect(p.isListening()).toBe(false);
  });

  it('dopo un errore qualsiasi non si riapre nulla', () => {
    for (const errore of ['aborted', 'network', 'audio-capture', 'not-allowed', 'bad-grammar']) {
      FakeRecognition.created = [];
      FakeRecognition.live = 0;
      const p = provider();
      p.start({});
      FakeRecognition.created[0]!.onerror?.({ error: errore });
      vi.advanceTimersByTime(600_000);
      expect([errore, FakeRecognition.created.length]).toEqual([errore, 1]);
      expect([errore, p.isListening()]).toEqual([errore, false]);
    }
  });

  it('nel codice non esiste alcuna riapertura programmata', () => {
    const source = readFileSync(resolve(ROOT, 'src/voice/BrowserVoiceProvider.ts'), 'utf8');
    const codice = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(codice).not.toMatch(/scheduleNext|restart|gapMs|windowMs/);
    // Un solo timer programmato dalla classe, ed e' quello che CHIUDE la
    // sessione. Le altre occorrenze sono la definizione dell'ambiente.
    expect(codice.match(/this\.env\.setTimeout\(/g) ?? []).toHaveLength(1);
  });
});

describe('la frase chiude la sessione', () => {
  it('consegna la trascrizione e spegne il microfono', () => {
    const p = provider();
    const sentite: string[] = [];
    p.start({ onTranscript: (t) => sentite.push(t) });

    FakeRecognition.created[0]!.say('buca');
    expect(sentite).toEqual(['buca']);
    expect(FakeRecognition.live).toBe(0);
    expect(p.isListening()).toBe(false);
  });

  it('un risultato duplicato produce UNA sola trascrizione', () => {
    const p = provider();
    const sentite: string[] = [];
    p.start({ onTranscript: (t) => sentite.push(t) });

    const r = FakeRecognition.created[0]!;
    r.say('buca');
    r.say('buca'); // il browser ripete il risultato finale
    r.say('buca');
    expect(sentite).toEqual(['buca']);
  });

  it('dopo la frase serve un nuovo tocco per riascoltare', () => {
    const p = provider();
    p.start({});
    FakeRecognition.created[0]!.say('buca');
    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.created).toHaveLength(1);

    p.start({}); // nuovo tocco
    expect(FakeRecognition.created).toHaveLength(2);
  });
});

describe('timeout e chiusura pulita', () => {
  it('se non si dice nulla la sessione si chiude da sola', () => {
    const p = provider();
    const stati: string[] = [];
    p.start({ onStatus: (s) => stati.push(s) });

    expect(p.isListening()).toBe(true);
    vi.advanceTimersByTime(VOICE.session.timeoutMs + 10);
    expect(p.isListening()).toBe(false);
    expect(FakeRecognition.live).toBe(0);
    expect(stati.at(-1)).toBe('off');
  });

  it('e non riapre nulla dopo il timeout', () => {
    provider().start({});
    vi.advanceTimersByTime(VOICE.session.timeoutMs + 600_000);
    expect(FakeRecognition.created).toHaveLength(1);
  });

  it('stop() chiude e non lascia timer pendenti', () => {
    const p = provider();
    p.start({});
    p.stop();
    expect(FakeRecognition.live).toBe(0);
    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.created).toHaveLength(1);
  });

  it('un evento in ritardo da una sessione chiusa non produce nulla', () => {
    const p = provider();
    const sentite: string[] = [];
    p.start({ onTranscript: (t) => sentite.push(t) });
    const vecchio = FakeRecognition.created[0]!;
    p.stop();

    vecchio.say('buca');
    vecchio.onend?.();
    vi.advanceTimersByTime(600_000);
    expect(sentite).toEqual([]);
    expect(FakeRecognition.created).toHaveLength(1);
  });

  it('permesso negato: sessione chiusa e stato dichiarato', () => {
    const p = provider();
    const stati: string[] = [];
    p.start({ onStatus: (s) => stati.push(s) });
    FakeRecognition.created[0]!.onerror?.({ error: 'not-allowed' });
    expect(stati.at(-1)).toBe('denied');
    expect(p.isListening()).toBe(false);
  });

  it('microfono non disponibile: nessuna sessione, nessun errore', () => {
    const senza: VoiceEnvironment = { ...makeEnv(), ctor: () => null };
    const p = new BrowserVoiceProvider(true, senza);
    const stati: string[] = [];
    expect(() => p.start({ onStatus: (s) => stati.push(s) })).not.toThrow();
    expect(stati).toEqual(['unsupported']);
    expect(p.isListening()).toBe(false);
  });
});

describe('nessuna parola di attivazione', () => {
  it('"buca" da sola basta', () => {
    const parsed = parseVoiceReport('buca', { requireWakeWord: false });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(hazardFamily(parsed.report.hazard)).toBe('pothole');
  });

  it('"Road Sense" non e\' piu\' necessario', () => {
    // Prima era obbligatorio, ed era la ragione per cui dire solo "buca"
    // non produceva nessuna segnalazione.
    expect(parseVoiceReport('buca', { requireWakeWord: true }).ok).toBe(false);
    expect(parseVoiceReport('buca', { requireWakeWord: false }).ok).toBe(true);
  });

  it('ma se viene detta per abitudine resta riconosciuta', () => {
    const conWake = parseVoiceReport('road sense buca', { requireWakeWord: false });
    expect(conWake.ok).toBe(true);
    if (conWake.ok) expect(hazardFamily(conWake.report.hazard)).toBe('pothole');
  });

  it('App non richiede mai la parola di attivazione', () => {
    const app = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8');
    expect(app).toMatch(/parseVoiceReport\(transcript, \{ requireWakeWord: false \}\)/);
  });
});

describe('voce e pulsante convergono sulla stessa logica', () => {
  const app = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8');

  it('la voce chiama la STESSA funzione del pulsante SEGNALA', () => {
    // Nessuna logica parallela: una sola funzione registra le segnalazioni
    // fatte da una persona, comunque siano arrivate.
    expect(app).toMatch(/report\(hazardFamily\(parsed\.report\.hazard\), 'voice'\)/);
    expect(app).toMatch(/onSelect=\{report\}/);
    // Il vecchio percorso parallelo non esiste piu'.
    expect(app).not.toMatch(/buildVoiceEvent/);
  });

  it('la segnalazione vocale non dipende da velocita\' o sensori', () => {
    const inizio = app.indexOf('const startVoice = useCallback');
    const fine = app.indexOf('  }, [', inizio);
    const corpo = app.slice(inizio, fine);
    expect(corpo).not.toMatch(/speedMps|running|DetectionEngine|sensorRef|minSpeed/);
  });

  it('un fallimento di riconoscimento non e\' mai muto', () => {
    const inizio = app.indexOf('const handleTranscript = useCallback');
    const fine = app.indexOf('    [report, showToast],', inizio);
    const corpo = app.slice(inizio, fine);
    // Prima c'era un `return` silenzioso: era indistinguibile da un
    // microfono che non sente.
    expect(corpo).toMatch(/showToast/);
    expect(corpo).not.toMatch(/if \(!parsed\.ok\) return;/);
  });
});
