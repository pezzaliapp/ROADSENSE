/**
 * ROAD SENSE - ciclo di ascolto intermittente.
 *
 * Nasce dal primo test in auto: su iPhone, con ROAD SENSE in ascolto, l'audio
 * dell'impianto veniva praticamente azzerato. La causa e' un riconoscitore
 * tenuto aperto per tutto il viaggio, che su iOS mantiene attiva una sessione
 * audio di registrazione.
 *
 * Qui si verifica cio' che conta davvero: che fra una finestra e l'altra il
 * riconoscitore venga RILASCIATO, non solo fermato, e che non ne esista mai
 * piu' di uno vivo.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VOICE } from '../config/config';
import {
  BrowserVoiceProvider,
  resetOnDeviceState,
  type VoiceEnvironment,
} from './BrowserVoiceProvider';

/** Riconoscitore finto che registra tutto cio' che gli viene fatto. */
class FakeRecognition {
  static live = 0;
  static created: FakeRecognition[] = [];

  lang = '';
  continuous = true;
  interimResults = true;
  maxAlternatives = 0;
  processLocally?: boolean;

  started = false;
  aborted = 0;
  stopped = 0;

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
    this.stopped++;
    this.finish();
  }

  abort(): void {
    this.aborted++;
    this.finish();
  }

  /** Il browser emette `end` sia su stop sia su abort. */
  private finish(): void {
    if (!this.started) return;
    this.started = false;
    FakeRecognition.live--;
    this.onend?.();
  }

  /** Simula la chiusura spontanea dopo una frase, tipica di Android. */
  endByItself(): void {
    this.finish();
  }
}

function makeEnv(): { env: VoiceEnvironment; visible: (v: boolean) => void } {
  let isVisible = true;
  const listeners = new Set<() => void>();
  return {
    env: {
      ctor: () => FakeRecognition as unknown as new () => never,
      apiName: () => 'SpeechRecognition',
      isVisible: () => isVisible,
      onVisibilityChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle),
    },
    visible: (v: boolean) => {
      isVisible = v;
      for (const l of [...listeners]) l();
    },
  };
}

function provider(env: VoiceEnvironment) {
  // Consenso all'elaborazione remota dato: qui si verifica il ciclo, non il
  // consenso, che ha i suoi test.
  return new BrowserVoiceProvider(true, env);
}

beforeEach(() => {
  FakeRecognition.live = 0;
  FakeRecognition.created = [];
  resetOnDeviceState();
  vi.useFakeTimers();
});

describe('il microfono non resta aperto', () => {
  it('non usa l\'ascolto continuo', () => {
    const { env } = makeEnv();
    provider(env).start({});
    expect(FakeRecognition.created[0]!.continuous).toBe(false);
  });

  it('chiude la finestra da sola, se il browser non lo fa', () => {
    const { env } = makeEnv();
    provider(env).start({});
    expect(FakeRecognition.live).toBe(1);

    vi.advanceTimersByTime(VOICE.listen.windowMs + 10);
    // `stop()` e' garbato: un risultato in arrivo viene consegnato.
    expect(FakeRecognition.created[0]!.stopped).toBe(1);
    expect(FakeRecognition.live).toBe(0);
  });

  it('fra una finestra e l\'altra NESSUN riconoscitore e\' vivo', () => {
    const { env } = makeEnv();
    provider(env).start({});
    vi.advanceTimersByTime(VOICE.listen.windowMs + 10);

    // Questo e' il punto: durante la pausa la sessione audio non esiste.
    expect(FakeRecognition.live).toBe(0);
    vi.advanceTimersByTime(VOICE.listen.gapMs - 50);
    expect(FakeRecognition.live).toBe(0);
  });

  it('riapre l\'ascolto dopo la pausa, con un\'istanza NUOVA', () => {
    const { env } = makeEnv();
    provider(env).start({});
    vi.advanceTimersByTime(VOICE.listen.windowMs + VOICE.listen.gapMs + 50);
    expect(FakeRecognition.created).toHaveLength(2);
    expect(FakeRecognition.live).toBe(1);
    // La vecchia istanza e' stata abbandonata, non riusata.
    expect(FakeRecognition.created[0]).not.toBe(FakeRecognition.created[1]);
  });

  it('la chiusura spontanea del browser porta comunque a una pausa', () => {
    const { env } = makeEnv();
    provider(env).start({});
    // Android chiude dopo una frase.
    FakeRecognition.created[0]!.endByItself();
    expect(FakeRecognition.live).toBe(0);
    vi.advanceTimersByTime(VOICE.listen.gapMs + 50);
    expect(FakeRecognition.live).toBe(1);
  });

  it('mai piu\' di un riconoscitore vivo, per quanti cicli passino', () => {
    const { env } = makeEnv();
    provider(env).start({});
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(VOICE.listen.windowMs + VOICE.listen.gapMs + 20);
      expect(FakeRecognition.live).toBeLessThanOrEqual(1);
    }
    expect(FakeRecognition.created.length).toBeGreaterThan(5);
  });
});

describe('STOP non lascia niente acceso', () => {
  it('ferma il riconoscitore e non ne riapre altri', () => {
    const { env } = makeEnv();
    const p = provider(env);
    p.start({});
    p.stop();
    expect(FakeRecognition.live).toBe(0);

    // Nessun timer superstite puo' riaprire l'ascolto.
    vi.advanceTimersByTime(VOICE.listen.windowMs + VOICE.listen.gapMs + 5000);
    expect(FakeRecognition.live).toBe(0);
    expect(FakeRecognition.created).toHaveLength(1);
  });

  it('uno STOP durante la pausa non lascia timer pendenti', () => {
    const { env } = makeEnv();
    const p = provider(env);
    p.start({});
    vi.advanceTimersByTime(VOICE.listen.windowMs + 10);
    p.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeRecognition.created).toHaveLength(1);
    expect(FakeRecognition.live).toBe(0);
  });

  it('un evento in ritardo da un riconoscitore chiuso non riapre nulla', () => {
    const { env } = makeEnv();
    const p = provider(env);
    p.start({});
    const vecchio = FakeRecognition.created[0]!;
    p.stop();

    // Il browser emette `end` in ritardo sull'istanza gia' abbandonata.
    vecchio.onend?.();
    vi.advanceTimersByTime(60_000);
    expect(FakeRecognition.created).toHaveLength(1);
  });
});

describe('quando ROAD SENSE parla, non ascolta', () => {
  it('la pausa RILASCIA il riconoscitore', () => {
    const { env } = makeEnv();
    const p = provider(env);
    p.start({});
    expect(FakeRecognition.live).toBe(1);

    p.pause();
    // Non "ignora i risultati": e' proprio chiuso.
    expect(FakeRecognition.live).toBe(0);
  });

  it('durante la voce di ROAD SENSE non si riapre da solo', () => {
    const { env } = makeEnv();
    const p = provider(env);
    p.start({});
    p.pause();
    vi.advanceTimersByTime(VOICE.listen.windowMs + VOICE.listen.gapMs + 10_000);
    expect(FakeRecognition.live).toBe(0);
  });

  it('riprende dopo la voce, con un margine per la coda dell\'enunciato', () => {
    const { env } = makeEnv();
    const p = provider(env);
    p.start({});
    p.pause();
    p.resume();

    // Non subito: la coda della voce sintetica non deve entrare nel microfono.
    expect(FakeRecognition.live).toBe(0);
    vi.advanceTimersByTime(VOICE.listen.afterSpeechMs + 20);
    expect(FakeRecognition.live).toBe(1);
  });

  it('una trascrizione prodotta dopo la pausa viene ignorata', () => {
    const { env } = makeEnv();
    const p = provider(env);
    const sentite: string[] = [];
    p.start({ onTranscript: (t) => sentite.push(t) });
    const vecchio = FakeRecognition.created[0]!;
    p.pause();

    // Il riconoscitore chiuso consegna comunque un risultato in ritardo:
    // sarebbe la voce di ROAD SENSE, e non deve diventare una segnalazione.
    vecchio.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: 'ROAD SENSE buca' } } },
    });
    expect(sentite).toEqual([]);
  });
});

describe('pagina nascosta', () => {
  it('a pagina nascosta il microfono viene rilasciato', () => {
    const { env, visible } = makeEnv();
    provider(env).start({});
    visible(false);
    expect(FakeRecognition.live).toBe(0);
  });

  it('a pagina nascosta non si riapre nulla', () => {
    const { env, visible } = makeEnv();
    provider(env).start({});
    visible(false);
    vi.advanceTimersByTime(60_000);
    expect(FakeRecognition.live).toBe(0);
  });

  it('tornando visibile l\'ascolto riprende', () => {
    const { env, visible } = makeEnv();
    provider(env).start({});
    visible(false);
    visible(true);
    vi.advanceTimersByTime(VOICE.listen.gapMs + 20);
    expect(FakeRecognition.live).toBe(1);
  });
});

describe('primo avvio dal tocco su VOCE', () => {
  it('prime apre una sola finestra e poi si ferma', () => {
    const { env } = makeEnv();
    const p = provider(env);
    p.prime({});
    // La chiamata e' avvenuta subito: e' cio' che fa comparire la richiesta
    // del microfono su Android.
    expect(FakeRecognition.created).toHaveLength(1);
    expect(FakeRecognition.created[0]!.started).toBe(true);

    FakeRecognition.created[0]!.endByItself();
    vi.advanceTimersByTime(60_000);
    // Nessun ciclo: non si resta in ascolto a monitoraggio fermo.
    expect(FakeRecognition.created).toHaveLength(1);
    expect(FakeRecognition.live).toBe(0);
  });
});

describe('diagnosi: gli eventi reali del browser', () => {
  it('riporta la sequenza degli eventi e il codice di errore', () => {
    const { env } = makeEnv();
    const p = provider(env);
    let events = '';
    let lastError: string | null = null;
    p.start({
      onDiagnostics: (patch) => {
        if (patch.events !== undefined) events = patch.events;
        if (patch.lastError !== undefined) lastError = patch.lastError;
      },
    });

    const r = FakeRecognition.created[0]!;
    r.onaudiostart?.();
    r.onsoundstart?.();
    r.onspeechstart?.();
    r.onerror?.({ error: 'no-speech' });

    expect(events).toContain('start');
    expect(events).toContain('audiostart');
    expect(events).toContain('soundstart');
    expect(events).toContain('speechstart');
    expect(events).toContain('error:no-speech');
    expect(lastError).toBe('no-speech');
  });
});
