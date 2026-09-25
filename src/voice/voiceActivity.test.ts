/**
 * ROAD SENSE - il VAD come cancello del riconoscitore.
 *
 * L'esperimento risponde a una domanda sola: durante il silenzio il numero di
 * `recognition.start()` resta fermo? Se resta fermo, Android non emette toni.
 *
 * Questi test lo verificano sul meccanismo; la conferma definitiva puo'
 * arrivare solo dal dispositivo, perche' nessun test in Node conosce il
 * comportamento del servizio di riconoscimento di Android.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VOICE } from '../config/config';
import {
  VoiceActivityDetector,
  type VadEnvironment,
  type VadSource,
  type VadState,
} from './voiceActivity';

/** Microfono finto: il livello si pilota, la chiusura si osserva. */
function makeEnv(options: { apre?: boolean } = {}) {
  let livello = 0;
  const close = vi.fn();
  const source: VadSource = { level: () => livello, close };
  const open = vi.fn(async () => (options.apre === false ? null : source));

  const env: VadEnvironment = {
    open,
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h),
  };
  return {
    env,
    open,
    close,
    /** Imposta il livello e lascia passare `ms` di campionamenti. */
    async parla(ms: number, valore = 0.5) {
      livello = valore;
      await vi.advanceTimersByTimeAsync(ms);
    },
    async taci(ms: number) {
      livello = 0.001;
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
}

/** Avvia il VAD contando le aperture del riconoscitore. */
async function avvia(h: ReturnType<typeof makeEnv>) {
  const vad = new VoiceActivityDetector(h.env);
  const aperture: number[] = [];
  const stati: VadState[] = [];
  const ok = await vad.start({
    onVoice: () => aperture.push(Date.now()),
    onState: (s) => stati.push(s),
  });
  return { vad, aperture, stati, ok };
}

const ROOT = resolve(import.meta.dirname, '..', '..');
const SUSTAIN = VOICE.vad.sustainMs + VOICE.vad.pollMs * 2;

beforeEach(() => {
  vi.useFakeTimers();
});

describe('A. silenzio', () => {
  it('sessanta secondi di silenzio: ZERO aperture del riconoscitore', async () => {
    const h = makeEnv();
    const { vad, aperture } = await avvia(h);
    expect(vad.state()).toBe('armed');

    await h.taci(60_000);

    expect(aperture).toEqual([]);
    expect(vad.triggers()).toBe(0);
    // E il microfono e' rimasto aperto: e' il VAD a misurare, non a tacere.
    expect(vad.state()).toBe('armed');
  });

  it('un rumore breve non basta: deve durare', async () => {
    const h = makeEnv();
    const { vad, aperture } = await avvia(h);
    await h.parla(VOICE.vad.pollMs, 0.5);
    await h.taci(1000);
    expect(aperture).toEqual([]);
    expect(vad.triggers()).toBe(0);
  });
});

describe('B/C. attivita\' vocale', () => {
  it('B. una frase apre UNA sessione', async () => {
    const h = makeEnv();
    const { vad, aperture } = await avvia(h);
    await h.parla(SUSTAIN);
    expect(aperture).toHaveLength(1);
    expect(vad.triggers()).toBe(1);
    expect(vad.state()).toBe('triggered');
  });

  it('C. attivita\' continua NON crea aperture multiple', async () => {
    const h = makeEnv();
    const { vad, aperture } = await avvia(h);
    // Dieci secondi di parlato ininterrotto.
    await h.parla(10_000);
    expect(aperture).toHaveLength(1);
    expect(vad.triggers()).toBe(1);
  });
});

describe('D/E. fine sessione e nuova attivita\'', () => {
  it('D. alla fine della sessione torna armato, senza aprire nulla', async () => {
    const h = makeEnv();
    const { vad, aperture } = await avvia(h);
    await h.parla(SUSTAIN);
    expect(aperture).toHaveLength(1);

    vad.rearm();
    expect(vad.state()).toBe('armed');
    // Nessuna apertura automatica: serve nuova voce.
    await h.taci(60_000);
    expect(aperture).toHaveLength(1);
  });

  it('E. nuova attivita\' apre la seconda sessione', async () => {
    const h = makeEnv();
    const { vad, aperture } = await avvia(h);
    await h.parla(SUSTAIN);
    vad.rearm();
    await h.taci(5000);
    await h.parla(SUSTAIN);

    expect(aperture).toHaveLength(2);
    expect(vad.triggers()).toBe(2);
  });

  it('senza rearm, il VAD resta muto anche parlando', async () => {
    // Protegge dal caso in cui due riconoscitori potrebbero convivere.
    const h = makeEnv();
    const { aperture } = await avvia(h);
    await h.parla(SUSTAIN);
    await h.taci(2000);
    await h.parla(10_000);
    expect(aperture).toHaveLength(1);
  });
});

describe('F. STOP', () => {
  it('rilascia microfono e contesto, e impedisce ogni riapertura', async () => {
    const h = makeEnv();
    const { vad, aperture } = await avvia(h);

    vad.release();
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(vad.state()).toBe('off');

    await h.parla(60_000);
    expect(aperture).toEqual([]);
  });

  it('nessun campionamento sopravvive allo STOP', async () => {
    const h = makeEnv();
    const { vad } = await avvia(h);
    vad.release();
    const chiamate = h.close.mock.calls.length;
    await h.taci(60_000);
    expect(h.close.mock.calls.length).toBe(chiamate);
  });

  it('uno STOP durante l\'apertura del microfono lo richiude subito', async () => {
    let risolvi: (v: VadSource | null) => void = () => undefined;
    const close = vi.fn();
    const env: VadEnvironment = {
      open: () => new Promise((r) => (risolvi = r)),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h),
    };
    const vad = new VoiceActivityDetector(env);
    const avviata = vad.start({});
    vad.release(); // STOP mentre getUserMedia e' ancora in volo
    risolvi({ level: () => 0, close });

    await expect(avviata).resolves.toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(vad.state()).toBe('off');
  });

  it('microfono negato: nessun errore, stato dichiarato', async () => {
    const h = makeEnv({ apre: false });
    const { vad, ok } = await avvia(h);
    expect(ok).toBe(false);
    expect(vad.state()).toBe('off');
  });
});

describe('G/H. ROAD SENSE parla', () => {
  it('G. durante il TTS il VAD non apre nulla', async () => {
    const h = makeEnv();
    const { vad, aperture } = await avvia(h);
    vad.suspend();
    expect(vad.state()).toBe('suspended');

    // La voce sintetica e' forte: senza sospensione scatterebbe.
    await h.parla(10_000, 0.9);
    expect(aperture).toEqual([]);
    expect(vad.triggers()).toBe(0);
  });

  it('H. finito il TTS il VAD torna armato e funziona', async () => {
    const h = makeEnv();
    const { vad, aperture } = await avvia(h);
    vad.suspend();
    await h.parla(3000, 0.9);
    vad.resume();
    expect(vad.state()).toBe('armed');

    await h.taci(500);
    await h.parla(SUSTAIN);
    expect(aperture).toHaveLength(1);
  });

  it('resume dopo STOP non riaccende nulla', async () => {
    const h = makeEnv();
    const { vad, aperture } = await avvia(h);
    vad.release();
    vad.resume();
    await h.parla(60_000);
    expect(aperture).toEqual([]);
    expect(vad.state()).toBe('off');
  });
});

describe('I. callback tardive', () => {
  it('un campionamento in ritardo dopo STOP non apre nulla', async () => {
    const h = makeEnv();
    const { vad, aperture } = await avvia(h);
    await h.parla(VOICE.vad.pollMs); // sotto la durata minima
    vad.release();
    await h.parla(60_000);
    expect(aperture).toEqual([]);
  });

  it('rearm dopo STOP non riarma', async () => {
    const h = makeEnv();
    const { vad } = await avvia(h);
    vad.release();
    vad.rearm();
    expect(vad.state()).toBe('off');
  });
});

describe('il fondo si adatta al rumore dell\'abitacolo', () => {
  it('un rumore costante non fa scattare il VAD all\'infinito', async () => {
    // Un abitacolo a 130 km/h e' rumoroso: se il fondo non si adattasse, il
    // VAD scatterebbe di continuo e i toni tornerebbero.
    const h = makeEnv();
    const { vad, aperture } = await avvia(h);
    // Rumore costante, sopra il minimo assoluto ma senza voce.
    await h.parla(30_000, VOICE.vad.minLevel * 1.2);
    // Puo' scattare all'inizio, mentre il fondo si assesta, ma non di continuo.
    expect(aperture.length).toBeLessThanOrEqual(1);
    expect(vad.triggers()).toBeLessThanOrEqual(1);
  });

  it('non registra ne\' trasmette: legge solo un livello', () => {
    const modulo = readFileSync(resolve(ROOT, 'src/voice/voiceActivity.ts'), 'utf8');
    const codice = modulo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(codice).not.toMatch(/MediaRecorder|fetch\(|XMLHttpRequest|WebSocket|localStorage/);
    // L'unica lettura e' quella dell'ampiezza nel tempo.
    expect(codice).toMatch(/getByteTimeDomainData/);
  });
});
