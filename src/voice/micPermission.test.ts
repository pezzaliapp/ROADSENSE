/**
 * ROAD SENSE - onboarding del microfono.
 *
 * Nasce da due difetti trovati sul campo, in sequenza:
 *   1. la finestra nativa non compariva, perche' `getUserMedia` arrivava dopo
 *      un `await` e fuori dall'attivazione del tocco;
 *   2. un solo `NotAllowedError` lasciava l'app convinta che il permesso
 *      fosse negato, e da quel momento non chiedeva piu' nulla - nemmeno dopo
 *      che il permesso era stato concesso davvero.
 *
 * La regola verificata qui: `permissions.query()` informa, `getUserMedia()`
 * decide. Uno stato dichiarato non puo' impedire una verifica, e nessun
 * fallimento viene memorizzato.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  attemptOf,
  browserMicEnvironment,
  interpretPermission,
  type MicEnvironment,
  micMessage,
  readMicPermission,
  readMicPermissionRaw,
  requestMicrophone,
} from './micPermission';

const ROOT = resolve(import.meta.dirname, '..', '..');

function err(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

/**
 * Ambiente pilotabile.
 *
 * `permission` e' il valore GREZZO della Permissions API ('granted' |
 * 'prompt' | 'denied', o qualcosa di inatteso). `script` permette di far
 * fallire il primo tentativo e riuscire il secondo, che e' il caso che
 * interessa di piu': un errore non deve chiudere la porta.
 */
function makeEnv(options: {
  permission?: string | 'throws' | null;
  result?: 'ok' | Error | null;
  script?: Array<'ok' | Error>;
}) {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }, { stop }] };
  let step = 0;

  const request = vi.fn(
    () =>
      new Promise<typeof stream>((resolveStream, reject) => {
        const esito = options.script ? (options.script[step++] ?? 'ok') : options.result;
        queueMicrotask(() => {
          if (esito instanceof Error) reject(esito);
          else resolveStream(stream);
        });
      }),
  );

  const env: MicEnvironment = {
    queryPermission:
      options.permission == null
        ? null
        : options.permission === 'throws'
          ? () => Promise.reject(new Error('non supportato'))
          : () => Promise.resolve(options.permission as string),
    requestStream: options.result === null ? null : request,
  };
  return { env, request, stop };
}

describe('la verifica e\' getUserMedia, non la Permissions API', () => {
  it('denied + getUserMedia riuscita => microfono permesso', async () => {
    // Il caso del Samsung Fold: i permessi risultano concessi sul telefono,
    // ma la Permissions API dichiara 'denied'. Vince il microfono che si apre.
    const { env, request } = makeEnv({ permission: 'denied', result: 'ok' });
    const result = await requestMicrophone(env);
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('permesso');
    expect(result.usable).toBe(true);
  });

  it('denied non salta mai la richiesta', async () => {
    const { env, request } = makeEnv({ permission: 'denied', result: err('NotAllowedError') });
    await requestMicrophone(env);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('la richiesta parte SUBITO, senza cedere il controllo al browser', () => {
    // Un solo `await` prima di questa chiamata fa decadere l'attivazione del
    // tocco: la chiamata deve essere gia' avvenuta prima di ogni microtask.
    const { env, request } = makeEnv({ result: 'ok' });
    const promise = requestMicrophone(env);
    expect(request).toHaveBeenCalledTimes(1);
    return promise;
  });

  it('riuscita: tracce chiuse subito, niente audio trattenuto', async () => {
    const { env, stop } = makeEnv({ result: 'ok' });
    const result = await requestMicrophone(env);
    expect(result.requested).toBe(true);
    expect(stop).toHaveBeenCalledTimes(2);
  });
});

describe('un fallimento non chiude la porta', () => {
  it('dopo un NotAllowedError il tocco successivo riprova', async () => {
    const { env, request } = makeEnv({
      permission: 'prompt',
      script: [err('NotAllowedError'), 'ok'],
    });

    const primo = await requestMicrophone(env, { verified: false });
    expect(primo.outcome).toBe('rifiutato');
    expect(primo.usable).toBe(false);

    // Nulla di negativo viene memorizzato: il secondo tentativo parte.
    const secondo = await requestMicrophone(env, { verified: primo.usable });
    expect(request).toHaveBeenCalledTimes(2);
    expect(secondo.outcome).toBe('permesso');
    expect(secondo.usable).toBe(true);
  });

  it('il successo cancella lo stato negativo precedente', async () => {
    const { env } = makeEnv({ permission: 'denied', script: [err('NotAllowedError'), 'ok'] });
    const primo = await requestMicrophone(env);
    expect(primo.outcome).toBe('bloccato');

    const secondo = await requestMicrophone(env, { verified: primo.usable });
    expect(secondo.usable).toBe(true);
    expect(secondo.outcome).toBe('permesso');
    // Da qui in poi il microfono risulta utilizzabile, non bloccato.
    expect(secondo.permission).toBe('permesso');
  });

  it('nessuno stato negativo e\' memorizzato in App', () => {
    const app = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8');
    // Si ricorda solo il fatto positivo, e solo dopo averlo verificato.
    expect(app).toMatch(/micUsableRef\.current = true;/);
    expect(app).not.toMatch(/micUsableRef\.current = false/);
    // E il valore ricordato viene passato come scorciatoia positiva.
    expect(app).toMatch(/verified: micUsableRef\.current/);
  });
});

describe('scelta del messaggio dopo un rifiuto', () => {
  it('denied + NotAllowedError => impostazioni del sito', async () => {
    const { env } = makeEnv({ permission: 'denied', result: err('NotAllowedError') });
    const result = await requestMicrophone(env);
    expect(result.outcome).toBe('bloccato');
    expect(result.permissionRaw).toBe('denied');
    expect(micMessage('bloccato')).toBe(
      'Microfono bloccato. Riattivalo nelle impostazioni del sito.',
    );
  });

  it('prompt + NotAllowedError => messaggio neutro e ritentabile', async () => {
    const { env } = makeEnv({ permission: 'prompt', result: err('NotAllowedError') });
    const result = await requestMicrophone(env);
    expect(result.outcome).toBe('rifiutato');
    expect(micMessage('rifiutato')).toBe('Microfono non autorizzato. Tocca VOCE per riprovare.');
    expect(micMessage('rifiutato')).not.toMatch(/impostazioni/i);
  });

  it('Permissions API assente o in errore => messaggio neutro, mai impostazioni', async () => {
    for (const permission of [null, 'throws', 'boh'] as const) {
      const { env } = makeEnv({ permission, result: err('NotAllowedError') });
      const result = await requestMicrophone(env);
      expect([permission, result.outcome]).toEqual([permission, 'rifiutato']);
    }
  });

  it('SecurityError segue la stessa regola di NotAllowedError', async () => {
    const { env } = makeEnv({ permission: 'denied', result: err('SecurityError') });
    expect((await requestMicrophone(env)).outcome).toBe('bloccato');
  });

  it('le impostazioni del sito si nominano SOLO per il blocco', () => {
    const esiti = [
      'permesso',
      'rifiutato',
      'bloccato',
      'assente',
      'occupato',
      'sconosciuto',
    ] as const;
    const conIstruzioni = esiti.filter((e) => (micMessage(e) ?? '').includes('impostazioni'));
    expect(conIstruzioni).toEqual(['bloccato']);
  });
});

describe('guasti che non sono rifiuti', () => {
  it('nessun microfono sul dispositivo', async () => {
    const { env } = makeEnv({ result: err('NotFoundError') });
    const result = await requestMicrophone(env);
    expect(result.outcome).toBe('assente');
    expect(result.permission).toBe('sconosciuto');
    expect(micMessage('assente')).not.toMatch(/impostazioni/i);
  });

  it('microfono occupato da un\'altra app', async () => {
    const { env } = makeEnv({ result: err('NotReadableError') });
    expect((await requestMicrophone(env)).outcome).toBe('occupato');
  });

  it('API assente: non si dichiara un rifiuto mai avvenuto', async () => {
    const { env } = makeEnv({ result: null });
    const result = await requestMicrophone(env);
    expect(result.outcome).toBe('sconosciuto');
    expect(result.requested).toBe(false);
    expect(micMessage('sconosciuto')).toBeNull();
  });
});

describe('scorciatoia positiva', () => {
  it('gia\' verificato nella sessione: nessuna richiesta inutile', async () => {
    const { env, request } = makeEnv({ result: 'ok' });
    const result = await requestMicrophone(env, { verified: true });
    expect(request).not.toHaveBeenCalled();
    expect(result).toEqual({
      outcome: 'permesso',
      usable: true,
      permission: 'permesso',
      permissionRaw: null,
      requested: false,
      errorName: null,
    });
    expect(attemptOf(result)).toBe('non tentato');
  });

  it('in diagnosi anche la scorciatoia positiva viene ignorata', async () => {
    const { env, request } = makeEnv({ result: 'ok' });
    await requestMicrophone(env, { verified: true, force: true });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('lettura passiva del permesso', () => {
  it('legge lo stato senza aprire niente', async () => {
    const { env, request } = makeEnv({ permission: 'granted', result: 'ok' });
    expect(await readMicPermissionRaw(env)).toBe('granted');
    expect(await readMicPermission(env)).toBe('permesso');
    expect(request).not.toHaveBeenCalled();
  });

  it('il valore grezzo distingue "assente", "errore" e "denied"', async () => {
    // Chrome per Android ha a lungo sollevato su
    // `permissions.query({name:'microphone'})`: un'eccezione non e' un
    // rifiuto, e confonderle manderebbe l'utente nelle impostazioni per nulla.
    expect(await readMicPermissionRaw(makeEnv({ permission: null }).env)).toBe('non disponibile');
    expect(await readMicPermissionRaw(makeEnv({ permission: 'throws' }).env)).toBe('errore');
    expect(await readMicPermissionRaw(makeEnv({ permission: 'boh' }).env)).toBe('errore');
    expect(await readMicPermissionRaw(makeEnv({ permission: 'denied' }).env)).toBe('denied');

    expect(interpretPermission('non disponibile')).toBe('sconosciuto');
    expect(interpretPermission('errore')).toBe('sconosciuto');
    expect(interpretPermission('prompt')).toBe('sconosciuto');
    expect(interpretPermission('granted')).toBe('permesso');
    expect(interpretPermission('denied')).toBe('negato');
  });

  it('"prompt" del browser non e\' un rifiuto', () => {
    vi.stubGlobal('navigator', {
      permissions: { query: () => Promise.resolve({ state: 'prompt' }) },
      mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) },
    });
    return expect(readMicPermission(browserMicEnvironment())).resolves.toBe('sconosciuto');
  });
});

describe('esito letterale di getUserMedia, per la diagnosi', () => {
  it('ogni errore e\' riportato con il suo nome', async () => {
    const casi: Array<[string | null, string]> = [
      [null, 'successo'],
      ['NotAllowedError', 'NotAllowedError'],
      ['NotFoundError', 'NotFoundError'],
      ['NotReadableError', 'NotReadableError'],
      ['SecurityError', 'altro errore'],
      ['QualcosaDiStrano', 'altro errore'],
    ];
    for (const [errore, atteso] of casi) {
      const { env } = makeEnv({
        permission: 'prompt',
        result: errore === null ? 'ok' : err(errore),
      });
      const result = await requestMicrophone(env);
      expect([errore, attemptOf(result)]).toEqual([errore, atteso]);
      expect(result.errorName).toBe(errore);
    }
  });

  it('il pannello mantiene i due canali e la divergenza', () => {
    const panel = readFileSync(resolve(ROOT, 'src/ui/VoiceDebugPanel.tsx'), 'utf8');
    expect(panel).toContain('PERMISSIONS API');
    expect(panel).toContain('GETUSERMEDIA');
    expect(panel).toMatch(/DIVERGENZA/);
    expect(panel).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
  });
});

describe('vincoli strutturali', () => {
  const app = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8');
  const toggle = app.slice(
    app.indexOf('const toggleVoice = useCallback'),
    app.indexOf('// -- START / STOP'),
  );
  const senzaCommenti = toggle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('getUserMedia resta la prima operazione asincrona del tocco', () => {
    const prima = senzaCommenti.slice(0, senzaCommenti.indexOf('await requestMicrophone('));
    expect(prima).not.toMatch(/\bawait\b/);
    expect(senzaCommenti.indexOf('await requestMicrophone(')).toBeLessThan(
      senzaCommenti.indexOf('await probeOnDevice('),
    );
  });

  it('il permesso microfono resta distinto dal consenso remoto', () => {
    const mic = senzaCommenti.indexOf('requestMicrophone(');
    const consenso = senzaCommenti.indexOf("setVoiceConsent('granted')");
    expect(mic).toBeGreaterThan(-1);
    expect(mic).toBeLessThan(consenso);
    const modulo = readFileSync(resolve(ROOT, 'src/voice/micPermission.ts'), 'utf8');
    expect(modulo).not.toMatch(/voiceConsent|allowRemote|processLocally/);
  });

  it('nessuna soglia temporale nel codice del permesso', () => {
    const modulo = readFileSync(resolve(ROOT, 'src/voice/micPermission.ts'), 'utf8');
    expect(modulo).not.toMatch(/\bnow\(\)|Date\.now|PROMPT_MIN_MS|elapsed|startedAt|setTimeout/);
  });

  it('la forzatura vive SOLO nel percorso di diagnosi', () => {
    const usi = app.match(/force:\s*\w+/g) ?? [];
    expect(usi).toEqual(['force: voiceDebug']);
  });
});
