/**
 * ROAD SENSE - onboarding del microfono.
 *
 * Nasce da un difetto trovato sul campo: al primo utilizzo la finestra nativa
 * di Android non compariva e l'app mandava l'utente nelle impostazioni del
 * sito. Due cause distinte, entrambe coperte qui:
 *   1. l'ordine - la chiamata che apre la finestra arrivava dopo un `await`,
 *      fuori dall'attivazione del tocco;
 *   2. la classificazione - ogni fallimento diventava "negato", compreso un
 *      rifiuto mai chiesto.
 *
 * Cio' che distingue "non autorizzato" da "bloccato" e' SOLO lo stato che la
 * Permissions API dichiarava prima del tocco. Nessuna soglia temporale: il
 * tempo di risposta dipende da browser e dispositivo e non puo' determinare
 * uno stato semantico dell'app.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  browserMicEnvironment,
  type MicEnvironment,
  type MicPermission,
  micMessage,
  readMicPermission,
  requestMicrophone,
} from './micPermission';

const ROOT = resolve(import.meta.dirname, '..', '..');

/** Traccia finta: serve solo a verificare che il flusso venga chiuso. */
function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }, { stop }] }, stop };
}

function err(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

/** Ambiente pilotabile: stato dichiarato dal browser, ed esito della richiesta. */
function makeEnv(options: {
  permission?: MicPermission | 'throws' | null;
  result?: 'ok' | Error | null;
}): { env: MicEnvironment; request: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } {
  const { stream, stop } = fakeStream();

  const request = vi.fn(() => {
    return new Promise((resolve_, reject) => {
      queueMicrotask(() => {
        if (options.result instanceof Error) reject(options.result);
        else resolve_(stream);
      });
    });
  });

  const env: MicEnvironment = {
    queryPermission:
      options.permission == null
        ? null
        : options.permission === 'throws'
          ? () => Promise.reject(new Error('non supportato'))
          : () => Promise.resolve(options.permission as MicPermission),
    requestStream: options.result === null ? null : (request as () => Promise<typeof stream>),
  };
  return { env, request, stop };
}

describe('prima visita: la finestra nativa deve comparire', () => {
  it('con permesso ancora da chiedere, il microfono viene richiesto', async () => {
    const { env, request } = makeEnv({ result: 'ok' });
    const result = await requestMicrophone(env, 'sconosciuto');
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.requested).toBe(true);
    expect(result.outcome).toBe('permesso');
  });

  it("la richiesta parte SUBITO, senza cedere il controllo al browser", () => {
    // E' il punto che rompeva il Fold: un solo `await` prima di questa
    // chiamata fa decadere l'attivazione del tocco. Qui si verifica che la
    // chiamata sia gia' avvenuta prima di qualsiasi microtask.
    const { env, request } = makeEnv({ result: 'ok' });
    const promise = requestMicrophone(env, 'sconosciuto');
    expect(request).toHaveBeenCalledTimes(1);
    return promise;
  });
});

describe('esiti della finestra nativa', () => {
  it('l\'utente consente: permesso concesso e flusso chiuso subito', async () => {
    const { env, stop } = makeEnv({ result: 'ok' });
    const result = await requestMicrophone(env, 'sconosciuto');
    expect(result).toEqual({ outcome: 'permesso', permission: 'permesso', requested: true });
    // L'audio non serviva: serviva il permesso.
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('autorizzazione non concessa: messaggio neutro, NON le impostazioni', async () => {
    const { env } = makeEnv({ result: err('NotAllowedError') });
    const result = await requestMicrophone(env, 'sconosciuto');
    expect(result.outcome).toBe('rifiutato');
    expect(result.requested).toBe(true);
    expect(micMessage('rifiutato')).toBe('Microfono non autorizzato. Tocca VOCE per riprovare.');
    expect(micMessage('rifiutato')).not.toMatch(/impostazioni/i);
  });

  it('da uno stato "prompt" un rifiuto non diventa MAI "bloccato"', async () => {
    // Qualunque sia la velocita' della risposta: il tempo non classifica
    // nulla. Da uno stato ancora da chiedere si esce ritentando.
    const { env } = makeEnv({ result: err('NotAllowedError') });
    for (const noto of ['sconosciuto'] as const) {
      const result = await requestMicrophone(env, noto);
      expect(result.outcome).toBe('rifiutato');
      expect(result.permission).toBe('negato');
    }
  });

  it('nessuna soglia temporale nel codice del permesso', () => {
    // Il tempo di risposta dipende da browser e dispositivo: non puo'
    // determinare uno stato dell'app.
    const modulo = readFileSync(resolve(ROOT, 'src/voice/micPermission.ts'), 'utf8');
    expect(modulo).not.toMatch(/\bnow\(\)|Date\.now|PROMPT_MIN_MS|elapsed|startedAt/);
  });
});

describe('permesso gia\' noto', () => {
  it('gia\' concesso: nessuna richiesta inutile', async () => {
    const { env, request } = makeEnv({ result: 'ok' });
    const result = await requestMicrophone(env, 'permesso');
    expect(request).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'permesso', permission: 'permesso', requested: false });
  });

  it('SOLO un denied noto prima del tocco produce le istruzioni', async () => {
    const { env, request } = makeEnv({ result: 'ok' });
    const result = await requestMicrophone(env, 'negato');
    // Richiederlo non mostrerebbe nulla: l'utente vedrebbe solo un rifiuto.
    expect(request).not.toHaveBeenCalled();
    expect(result.outcome).toBe('bloccato');
    expect(result.requested).toBe(false);
    expect(micMessage('bloccato')).toBe(
      'Microfono bloccato. Riattivalo nelle impostazioni del sito.',
    );
  });
});

describe('guasti che non sono rifiuti', () => {
  it('nessun microfono sul dispositivo', async () => {
    const { env } = makeEnv({ result: err('NotFoundError') });
    const result = await requestMicrophone(env, 'sconosciuto');
    expect(result.outcome).toBe('assente');
    // Non deve risultare negato: il permesso non c'entra.
    expect(result.permission).toBe('sconosciuto');
    expect(micMessage('assente')).not.toMatch(/impostazioni/i);
  });

  it('microfono occupato da un\'altra app', async () => {
    const { env } = makeEnv({ result: err('NotReadableError') });
    const result = await requestMicrophone(env, 'sconosciuto');
    expect(result.outcome).toBe('occupato');
    expect(result.permission).toBe('sconosciuto');
  });

  it('API assente: non si dichiara un rifiuto mai avvenuto', async () => {
    const { env } = makeEnv({ result: null });
    const result = await requestMicrophone(env, 'sconosciuto');
    expect(result).toEqual({ outcome: 'sconosciuto', permission: 'sconosciuto', requested: false });
    expect(micMessage('sconosciuto')).toBeNull();
  });
});

describe('lettura passiva del permesso', () => {
  it('legge lo stato senza aprire niente', async () => {
    const { env, request } = makeEnv({ permission: 'permesso', result: 'ok' });
    expect(await readMicPermission(env)).toBe('permesso');
    expect(request).not.toHaveBeenCalled();
  });

  it('senza API, o se solleva, resta sconosciuto: mai "negato"', async () => {
    expect(await readMicPermission(makeEnv({ permission: null, result: 'ok' }).env)).toBe(
      'sconosciuto',
    );
    expect(await readMicPermission(makeEnv({ permission: 'throws', result: 'ok' }).env)).toBe(
      'sconosciuto',
    );
  });

  it('"prompt" del browser non e\' un rifiuto', () => {
    vi.stubGlobal('navigator', {
      permissions: { query: () => Promise.resolve({ state: 'prompt' }) },
      mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) },
    });
    const env = browserMicEnvironment();
    return expect(readMicPermission(env)).resolves.toBe('sconosciuto');
  });
});

describe('il consenso al microfono e\' distinto dal consenso all\'elaborazione remota', () => {
  const app = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8');
  const toggle = app.slice(
    app.indexOf('const toggleVoice = useCallback'),
    app.indexOf('// -- START / STOP'),
  );

  it('sono due decisioni diverse, prese in momenti diversi', () => {
    // Il microfono e' un permesso del SISTEMA. L'elaborazione remota e' un
    // consenso a ROAD SENSE. Concedere il primo non concede il secondo.
    const mic = toggle.indexOf('requestMicrophone(');
    const consent = toggle.indexOf("setVoiceConsent('granted')");
    expect(mic).toBeGreaterThan(-1);
    expect(consent).toBeGreaterThan(-1);
    expect(mic).toBeLessThan(consent);
    // requestMicrophone non tocca il consenso all'elaborazione remota.
    const micModule = readFileSync(resolve(ROOT, 'src/voice/micPermission.ts'), 'utf8');
    expect(micModule).not.toMatch(/voiceConsent|allowRemote|processLocally/);
  });

  it('la finestra del microfono precede ogni altra attesa', () => {
    // La garanzia che il gesto non venga consumato: fra l'inizio della
    // funzione e la richiesta del microfono non ci sono `await`.
    // I commenti vanno tolti: parlano di `await`, non ne eseguono.
    const senzaCommenti = toggle
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const prima = senzaCommenti.slice(0, senzaCommenti.indexOf('await requestMicrophone('));
    expect(prima).not.toMatch(/\bawait\b/);
    // E la verifica del motore locale, che prima veniva per prima, ora segue.
    expect(toggle.indexOf('await requestMicrophone(')).toBeLessThan(
      toggle.indexOf('await probeOnDevice('),
    );
  });

  it('le impostazioni del sito si nominano SOLO per il blocco', () => {
    // Il requisito e' questo: "vai nelle impostazioni" non e' un onboarding.
    // Un solo esito fra tutti puo' dirlo.
    const esiti = ['permesso', 'rifiutato', 'bloccato', 'assente', 'occupato', 'sconosciuto'] as const;
    const conIstruzioni = esiti.filter((e) => (micMessage(e) ?? '').includes('impostazioni'));
    expect(conIstruzioni).toEqual(['bloccato']);
  });
});
