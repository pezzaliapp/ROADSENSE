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

describe('riarmo controllato, non il vecchio ciclo', () => {
  it('dopo un COMANDO l\'ascolto si riapre da solo', () => {
    // E' il requisito: "buca" -> evento -> di nuovo in ascolto, senza tocco.
    const p = provider();
    p.start({});
    FakeRecognition.created[0]!.say('buca');
    expect(FakeRecognition.live).toBe(0);

    vi.advanceTimersByTime(VOICE.rearm.afterCommandMs + 20);
    expect(FakeRecognition.created).toHaveLength(2);
    expect(FakeRecognition.live).toBe(1);
  });

  it('il SILENZIO riapre, ma un numero CONTATO di volte', () => {
    // E' la differenza col ciclo che faceva suonare il Fold senza fine.
    const p = provider();
    p.start({});

    for (let i = 0; i < VOICE.rearm.maxSilentCycles; i++) {
      FakeRecognition.created.at(-1)!.endByItself();
      vi.advanceTimersByTime(VOICE.rearm.afterSilenceMs + 20);
    }
    expect(FakeRecognition.created).toHaveLength(VOICE.rearm.maxSilentCycles + 1);

    // Superato il limite si smette, e nessun timer sopravvive.
    FakeRecognition.created.at(-1)!.endByItself();
    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.created).toHaveLength(VOICE.rearm.maxSilentCycles + 1);
    expect(p.isArmed()).toBe(false);
    expect(FakeRecognition.live).toBe(0);
  });

  it('no-speech e\' silenzio, non guasto: stesso conteggio', () => {
    const p = provider();
    p.start({});
    for (let i = 0; i <= VOICE.rearm.maxSilentCycles; i++) {
      FakeRecognition.created.at(-1)!.onerror?.({ error: 'no-speech' });
      vi.advanceTimersByTime(VOICE.rearm.afterSilenceMs + 20);
    }
    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.created).toHaveLength(VOICE.rearm.maxSilentCycles + 1);
    expect(p.isArmed()).toBe(false);
  });

  it('un comando azzera il conteggio del silenzio', () => {
    // E' la conversazione a tenere vivo l'ascolto, non un timer.
    const p = provider();
    p.start({});
    FakeRecognition.created.at(-1)!.endByItself();
    vi.advanceTimersByTime(VOICE.rearm.afterSilenceMs + 20);
    FakeRecognition.created.at(-1)!.endByItself();
    vi.advanceTimersByTime(VOICE.rearm.afterSilenceMs + 20);

    FakeRecognition.created.at(-1)!.say('buca');
    vi.advanceTimersByTime(VOICE.rearm.afterCommandMs + 20);

    // Il budget di silenzio riparte da zero.
    for (let i = 0; i < VOICE.rearm.maxSilentCycles; i++) {
      FakeRecognition.created.at(-1)!.endByItself();
      vi.advanceTimersByTime(VOICE.rearm.afterSilenceMs + 20);
    }
    expect(p.isArmed()).toBe(true);
  });

  it('gli ERRORI arretrano e poi aprono il circuito', () => {
    const p = provider();
    p.start({});
    const passi = VOICE.rearm.errorBackoffMs.length;

    for (let i = 0; i < passi; i++) {
      FakeRecognition.created.at(-1)!.onerror?.({ error: 'network' });
      // Prima dell'attesa prevista non riapre nulla.
      vi.advanceTimersByTime((VOICE.rearm.errorBackoffMs[i] as number) - 50);
      expect([i, FakeRecognition.created.length]).toEqual([i, i + 1]);
      vi.advanceTimersByTime(100);
    }
    expect(FakeRecognition.created).toHaveLength(passi + 1);

    // Esaurito il budget il circuito resta aperto.
    FakeRecognition.created.at(-1)!.onerror?.({ error: 'network' });
    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.created).toHaveLength(passi + 1);
    expect(p.isArmed()).toBe(false);
  });

  it('un permesso negato non viene mai riprovato', () => {
    const p = provider();
    const stati: string[] = [];
    p.start({ onStatus: (s) => stati.push(s) });
    FakeRecognition.created[0]!.onerror?.({ error: 'not-allowed' });

    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.created).toHaveLength(1);
    expect(p.isArmed()).toBe(false);
    expect(stati.at(-1)).toBe('denied');
  });

  it('durante l\'attesa lo stato NON finge ascolto ne\' assenza', () => {
    const p = provider();
    const stati: string[] = [];
    p.start({ onStatus: (s) => stati.push(s) });
    FakeRecognition.created[0]!.say('buca');
    // "restarting" e' la terza possibilita': VOCE ~ in interfaccia.
    expect(stati.at(-1)).toBe('restarting');
    expect(p.isListening()).toBe(false);
    expect(p.isArmed()).toBe(true);
  });

  it('un solo riarmo in volo, mai due catene parallele', () => {
    const p = provider();
    p.start({});
    const r = FakeRecognition.created[0]!;
    r.say('buca');
    r.say('buca'); // risultato duplicato dal browser
    vi.advanceTimersByTime(VOICE.rearm.afterCommandMs + 20);
    expect(FakeRecognition.created).toHaveLength(2);
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

  it('dopo la frase l\'ascolto torna disponibile da solo', () => {
    const p = provider();
    p.start({});
    FakeRecognition.created[0]!.say('buca');
    vi.advanceTimersByTime(VOICE.rearm.afterCommandMs + 20);
    expect(FakeRecognition.live).toBe(1);

    // Un tocco in piu' non apre una seconda catena.
    p.start({});
    expect(FakeRecognition.live).toBe(1);
  });
});

describe('timeout e chiusura pulita', () => {
  it('se non si dice nulla la sessione si chiude da sola', () => {
    const p = provider();
    const stati: string[] = [];
    p.start({ onStatus: (s) => stati.push(s) });

    expect(p.isListening()).toBe(true);
    vi.advanceTimersByTime(VOICE.session.timeoutMs + 10);
    // Il microfono e' chiuso: e' il punto che conta.
    expect(p.isListening()).toBe(false);
    expect(FakeRecognition.live).toBe(0);
    // Il silenzio rientra nel budget, quindi si riaprira'.
    expect(stati.at(-1)).toBe('restarting');
  });

  it('il timeout consuma il budget di silenzio, poi si ferma', () => {
    const p = provider();
    p.start({});
    // Ogni ciclo: timeout, attesa, riapertura.
    for (let i = 0; i <= VOICE.rearm.maxSilentCycles; i++) {
      vi.advanceTimersByTime(VOICE.session.timeoutMs + VOICE.rearm.afterSilenceMs + 40);
    }
    const create = FakeRecognition.created.length;
    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.created).toHaveLength(create);
    expect(p.isArmed()).toBe(false);
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

/**
 * MANI LIBERE: LA SEQUENZA CHE IL TEST SU STRADA HA VISTO FALLIRE.
 *
 * Sul Samsung Fold "buca" veniva riconosciuta, l'evento creato, e subito dopo
 * la interfaccia tornava a VOCE OFF: la sessione finiva e nessuno la
 * riapriva. Questi casi descrivono cio' che deve accadere adesso.
 */
describe('A/B. piu\' comandi senza toccare il telefono', () => {
  it('A. "buca" -> evento -> end -> riarmo -> in ascolto', () => {
    const p = provider();
    const sentite: string[] = [];
    const stati: string[] = [];
    p.start({ onTranscript: (t) => sentite.push(t), onStatus: (s) => stati.push(s) });

    FakeRecognition.created[0]!.say('buca');
    expect(sentite).toEqual(['buca']);
    expect(stati.at(-1)).toBe('restarting');

    vi.advanceTimersByTime(VOICE.rearm.afterCommandMs + 20);
    expect(stati.at(-1)).toBe('listening');
    expect(p.isListening()).toBe(true);
  });

  it('B. "buca" -> "ostacolo" -> "acqua", un solo tocco iniziale', () => {
    const p = provider();
    const sentite: string[] = [];
    p.start({ onTranscript: (t) => sentite.push(t) });

    for (const comando of ['buca', 'ostacolo', 'acqua']) {
      expect(FakeRecognition.live).toBe(1);
      FakeRecognition.created.at(-1)!.say(comando);
      vi.advanceTimersByTime(VOICE.rearm.afterCommandMs + 20);
    }

    expect(sentite).toEqual(['buca', 'ostacolo', 'acqua']);
    // Un solo `start()` in tutta la sequenza.
    expect(p.isArmed()).toBe(true);
  });

  it('B2. ogni comando apre una sessione NUOVA, mai due insieme', () => {
    const p = provider();
    p.start({});
    for (const c of ['buca', 'ostacolo', 'acqua']) {
      expect(FakeRecognition.live).toBeLessThanOrEqual(1);
      FakeRecognition.created.at(-1)!.say(c);
      vi.advanceTimersByTime(VOICE.rearm.afterCommandMs + 20);
    }
    expect(FakeRecognition.created).toHaveLength(4);
    expect(FakeRecognition.live).toBe(1);
  });
});

describe('C. STOP dopo un comando', () => {
  it('nessun riarmo dopo STOP', () => {
    const p = provider();
    p.start({});
    FakeRecognition.created[0]!.say('buca');
    // STOP arriva DURANTE l'attesa del riarmo.
    p.stop();

    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.created).toHaveLength(1);
    expect(FakeRecognition.live).toBe(0);
    expect(p.isArmed()).toBe(false);
  });

  it('STOP mentre e\' in ascolto: chiude e non riapre', () => {
    const p = provider();
    p.start({});
    p.stop();
    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.live).toBe(0);
    expect(FakeRecognition.created).toHaveLength(1);
  });
});

describe('F. ROAD SENSE parla', () => {
  it('durante la voce sintetica il riconoscitore e\' CHIUSO', () => {
    const p = provider();
    p.start({});
    p.pause();
    expect(FakeRecognition.live).toBe(0);
    // E non si riapre da solo mentre ROAD SENSE sta parlando.
    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.live).toBe(0);
  });

  it('una frase consegnata dopo la pausa non diventa segnalazione', () => {
    const p = provider();
    const sentite: string[] = [];
    p.start({ onTranscript: (t) => sentite.push(t) });
    const vecchio = FakeRecognition.created[0]!;
    p.pause();

    // Sarebbe la voce di ROAD SENSE rientrata dal microfono.
    vecchio.say('attenzione buca tra trecento metri');
    expect(sentite).toEqual([]);
  });

  it('finita la voce, l\'ascolto torna da solo', () => {
    const p = provider();
    p.start({});
    p.pause();
    p.resume();

    // Non subito: c'e' un margine per la coda dell'enunciato.
    expect(FakeRecognition.live).toBe(0);
    vi.advanceTimersByTime(VOICE.rearm.afterSpeechMs + 20);
    expect(FakeRecognition.live).toBe(1);
  });

  it('dopo uno STOP la voce sintetica non puo\' riaccendere nulla', () => {
    const p = provider();
    p.start({});
    p.stop();
    p.resume();
    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.created).toHaveLength(1);
  });
});

describe('G. callback tardive', () => {
  it('un `end` in ritardo dopo STOP non riarma', () => {
    const p = provider();
    p.start({});
    const vecchio = FakeRecognition.created[0]!;
    p.stop();

    vecchio.onend?.();
    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.created).toHaveLength(1);
  });

  it('un `error` in ritardo dopo STOP non riarma', () => {
    const p = provider();
    p.start({});
    const vecchio = FakeRecognition.created[0]!;
    p.stop();

    vecchio.onerror?.({ error: 'network' });
    vi.advanceTimersByTime(600_000);
    expect(FakeRecognition.created).toHaveLength(1);
  });

  it('un risultato di una sessione superata non consegna nulla', () => {
    const p = provider();
    const sentite: string[] = [];
    p.start({ onTranscript: (t) => sentite.push(t) });
    const prima = FakeRecognition.created[0]!;

    prima.say('buca');
    vi.advanceTimersByTime(VOICE.rearm.afterCommandMs + 20);
    // La vecchia istanza consegna in ritardo: e' gia' stata superata.
    prima.say('ostacolo');
    expect(sentite).toEqual(['buca']);
  });
});
