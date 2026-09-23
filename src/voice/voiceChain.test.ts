/**
 * ROAD SENSE - dalla frase all'evento, e degradazione senza microfono.
 *
 * Verifica che una segnalazione vocale entri nel modello esistente come
 * qualsiasi altro rilevamento, e che l'assenza del riconoscimento vocale non
 * rompa nulla: senza voce ROAD SENSE deve funzionare esattamente come prima.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ALERT, VOICE } from '../config/config';
import { buildClusters } from '../core/ConfidenceEngine';
import { installMemoryStorage } from '../core/testUtils';
import type { GeoSample } from '../core/types';
import { validateEvent } from '../core/validation';
import { admitsAlert, assessCluster } from '../hazard/assessment';
import { hazardPriority } from '../hazard/taxonomy';
import {
  BrowserVoiceProvider,
  onDeviceStateNow,
  probeOnDevice,
  resetOnDeviceState,
  selectedVoiceApi,
} from './BrowserVoiceProvider';
import { DemoVoiceProvider } from './DemoVoiceProvider';
import { parseVoiceReport } from './parser';
import { buildVoiceEvent } from './voiceEvent';
import { AlertSpeechEngine } from '../speech/AlertSpeechEngine';

installMemoryStorage();
const ROOT = resolve(import.meta.dirname, '..', '..');

const GEO: GeoSample = {
  ts: Date.now(),
  lat: 45.4642,
  lon: 9.19,
  accuracyM: 8,
  speedMps: 14,
  heading: 87.4,
};

function reportEvent(phrase: string, reporterId = '0123456789abcdef') {
  const parsed = parseVoiceReport(phrase);
  if (!parsed.ok) return null;
  return buildVoiceEvent(parsed.report, GEO, { reporterId, now: Date.now() });
}

afterEach(() => vi.unstubAllGlobals());

describe('da frase a evento', () => {
  it('posizione, direzione e istante arrivano dai sensori, non dalla voce', () => {
    const e = reportEvent('ROAD SENSE, auto in avaria ferma in seconda corsia')!;
    expect(e.lat).toBeCloseTo(GEO.lat, 4);
    expect(e.lon).toBeCloseTo(GEO.lon, 4);
    expect(e.heading).toBe(GEO.heading);
    expect(e.source).toBe('voice');
  });

  it('conserva solo gli attributi pronunciati', () => {
    const e = reportEvent('ROAD SENSE, auto in avaria ferma in seconda corsia')!;
    expect(e.hazard).toBe('broken_down_vehicle');
    expect(e.lane).toBe('second_lane');
    expect(e.state).toBe('broken_down');

    const semplice = reportEvent('ROAD SENSE, auto ferma')!;
    expect(semplice.hazard).toBe('stopped_vehicle');
    expect(semplice.lane).toBeUndefined();
  });

  it('la severita\' non viene dedotta dalla frase', () => {
    // L'urgenza sta nella priorita' della categoria, non nel racconto.
    const critico = reportEvent('ROAD SENSE, camion contromano')!;
    const lieve = reportEvent('ROAD SENSE, buca')!;
    expect(critico.severity).toBe(lieve.severity);
    expect(hazardPriority('wrong_way_truck')).toBe('critical');
    expect(hazardPriority('pothole')).toBe('medium');
  });

  it('senza posizione non produce alcun evento', () => {
    const parsed = parseVoiceReport('ROAD SENSE, incidente');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(buildVoiceEvent(parsed.report, null, { reporterId: '0123456789abcdef' })).toBeNull();
    }
  });

  it('la famiglia assegnata e\' quella giusta per gli engine esistenti', () => {
    expect(reportEvent('ROAD SENSE, camion contromano')!.type).toBe('wrong_way');
    expect(reportEvent('ROAD SENSE, persona sulla carreggiata')!.type).toBe('person');
    expect(reportEvent('ROAD SENSE, strada allagata')!.type).toBe('water');
    expect(reportEvent('ROAD SENSE, buca')!.type).toBe('pothole');
  });
});

describe('una voce sola non conferma', () => {
  it('una segnalazione singola resta sotto la soglia di allerta', () => {
    const uno = reportEvent('ROAD SENSE, auto in avaria in seconda corsia', 'aaaaaaaaaaaaaaaa')!;
    const cluster = buildClusters([uno])[0]!;
    expect(cluster.reporters).toBe(1);
    expect(cluster.confidence).toBeLessThan(ALERT.minConfidence);
  });

  it('due segnalatori indipendenti fanno salire la confidenza', () => {
    const uno = reportEvent('ROAD SENSE, auto in avaria in seconda corsia', 'aaaaaaaaaaaaaaaa')!;
    const due = reportEvent('ROAD SENSE, auto in avaria in seconda corsia', 'bbbbbbbbbbbbbbbb')!;
    const solo = buildClusters([uno])[0]!;
    const insieme = buildClusters([uno, due])[0]!;
    expect(insieme.reporters).toBe(2);
    expect(insieme.confidence).toBeGreaterThan(solo.confidence);
  });

  it('lo stesso segnalatore che ripete non vale come conferma', () => {
    const uno = reportEvent('ROAD SENSE, incidente', 'aaaaaaaaaaaaaaaa')!;
    const ancora = reportEvent('ROAD SENSE, incidente', 'aaaaaaaaaaaaaaaa')!;
    const cluster = buildClusters([uno, ancora])[0]!;
    expect(cluster.reporters).toBe(1);
  });

  it('la trascrizione non raggiunge mai il backend', () => {
    const e = reportEvent('ROAD SENSE, uomo in strada')!;
    expect(e.rawTranscript).toBe('uomo in strada');
    const r = validateEvent(e, e.ts);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).not.toHaveProperty('rawTranscript');
      expect(r.value).not.toHaveProperty('hazard');
      expect(r.value).not.toHaveProperty('subject');
      expect(r.value).not.toHaveProperty('state');
      expect(r.value).not.toHaveProperty('lane');
    }
  });

  it('"voice" e\' una sorgente valida per il backend', () => {
    const e = reportEvent('ROAD SENSE, buca')!;
    expect(validateEvent(e, e.ts).ok).toBe(true);
  });
});

describe('degradazione senza riconoscimento vocale', () => {
  it('senza le API il provider lo dichiara e non parte', () => {
    vi.stubGlobal('window', {});
    const provider = new BrowserVoiceProvider();
    expect(provider.capabilities()).toEqual({ supported: false, onDevice: false });

    const stati: string[] = [];
    provider.start({ onStatus: (s) => stati.push(s) });
    expect(stati).toEqual(['unsupported']);
    expect(() => provider.stop()).not.toThrow();
  });

  it('senza elaborazione locale e senza consenso non si accende il microfono', () => {
    // Il riconoscimento dei browser e' per impostazione predefinita remoto:
    // senza consenso esplicito ROAD SENSE preferisce restare muto.
    class Remota {}
    vi.stubGlobal('window', { SpeechRecognition: Remota });
    const provider = new BrowserVoiceProvider(false);
    expect(provider.capabilities()).toEqual({ supported: true, onDevice: false });

    const stati: string[] = [];
    provider.start({ onStatus: (s) => stati.push(s) });
    expect(stati).toEqual(['off']);
  });

  it('la sola presenza di processLocally NON basta a dichiarare la voce locale', async () => {
    // E' la diagnosi del Samsung Fold. Chrome per Android espone
    // `processLocally` nell'interfaccia anche quando il modello italiano non
    // e' installato: darlo per disponibile portava a chiedere un motore locale
    // inesistente, e il riconoscimento non partiva mai.
    class Locale {}
    (Locale.prototype as unknown as Record<string, unknown>).processLocally = false;
    vi.stubGlobal('window', { SpeechRecognition: Locale });
    resetOnDeviceState();
    expect(new BrowserVoiceProvider().capabilities()).toEqual({
      supported: true,
      onDevice: false,
    });
    // Nemmeno dopo la verifica, se il browser non offre modo di verificare.
    expect(await probeOnDevice('it-IT')).toBe(false);
    expect(onDeviceStateNow()).toBe('non disponibile');
  });

  it('l\'elaborazione locale si afferma solo su risposta "available"', async () => {
    class Locale {}
    (Locale.prototype as unknown as Record<string, unknown>).processLocally = false;
    const ctor = Locale as unknown as Record<string, unknown>;

    for (const [risposta, atteso] of [
      ['unavailable', false],
      ['downloadable', false],
      ['downloading', false],
      ['available', true],
    ] as const) {
      ctor.availableOnDevice = () => Promise.resolve(risposta);
      vi.stubGlobal('window', { SpeechRecognition: Locale });
      resetOnDeviceState();
      expect(await probeOnDevice('it-IT')).toBe(atteso);
      expect(new BrowserVoiceProvider().capabilities().onDevice).toBe(atteso);
    }
  });

  it('processLocally viene impostato solo quando la disponibilita\' e\' confermata', async () => {
    const creati: Array<Record<string, unknown>> = [];
    class Locale {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 0;
      constructor() {
        creati.push(this as unknown as Record<string, unknown>);
      }
      start() {}
      stop() {}
      abort() {}
    }
    (Locale.prototype as unknown as Record<string, unknown>).processLocally = false;
    const ctor = Locale as unknown as Record<string, unknown>;
    ctor.availableOnDevice = () => Promise.resolve('unavailable');
    vi.stubGlobal('window', { SpeechRecognition: Locale });
    resetOnDeviceState();
    await probeOnDevice('it-IT');

    // Consenso remoto dato: parte, ma SENZA chiedere il motore locale.
    new BrowserVoiceProvider(true).start({});
    expect(creati).toHaveLength(1);
    expect(creati[0]!.processLocally).toBe(false);
  });

  it('se il motore locale rifiuta la lingua si ripiega sul remoto, una volta sola', async () => {
    const istanze: Array<Record<string, unknown>> = [];
    class Motore {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 0;
      onerror: ((e: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      onstart: (() => void) | null = null;
      onresult: unknown = null;
      constructor() {
        istanze.push(this as unknown as Record<string, unknown>);
      }
      start() {}
      stop() {}
      abort() {}
    }
    (Motore.prototype as unknown as Record<string, unknown>).processLocally = false;
    const ctor = Motore as unknown as Record<string, unknown>;
    ctor.availableOnDevice = () => Promise.resolve('available');
    vi.stubGlobal('window', { SpeechRecognition: Motore });
    resetOnDeviceState();
    await probeOnDevice('it-IT');

    const stati: string[] = [];
    new BrowserVoiceProvider(true).start({ onStatus: (s) => stati.push(s) });
    expect(istanze).toHaveLength(1);
    expect(istanze[0]!.processLocally).toBe(true);

    // Il motore locale dichiara di non avere la lingua.
    (istanze[0]!.onerror as (e: { error: string }) => void)({
      error: 'language-not-supported',
    });

    // Secondo tentativo, remoto, senza processLocally.
    expect(istanze).toHaveLength(2);
    expect(istanze[1]!.processLocally).toBe(false);
    expect(onDeviceStateNow()).toBe('no');

    // Un secondo rifiuto NON produce un terzo tentativo: si rinuncia.
    (istanze[1]!.onerror as (e: { error: string }) => void)({
      error: 'language-not-supported',
    });
    expect(istanze).toHaveLength(2);
    expect(stati.at(-1)).toBe('error');
  });

  it('senza consenso remoto il rifiuto locale spegne la voce, non la dichiara guasta', async () => {
    const istanze: Array<Record<string, unknown>> = [];
    class Motore {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 0;
      onerror: ((e: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      onstart: (() => void) | null = null;
      constructor() {
        istanze.push(this as unknown as Record<string, unknown>);
      }
      start() {}
      stop() {}
      abort() {}
    }
    (Motore.prototype as unknown as Record<string, unknown>).processLocally = false;
    const ctor = Motore as unknown as Record<string, unknown>;
    ctor.availableOnDevice = () => Promise.resolve('available');
    vi.stubGlobal('window', { SpeechRecognition: Motore });
    resetOnDeviceState();
    await probeOnDevice('it-IT');

    const stati: string[] = [];
    new BrowserVoiceProvider(false).start({ onStatus: (s) => stati.push(s) });
    (istanze[0]!.onerror as (e: { error: string }) => void)({
      error: 'language-not-supported',
    });
    expect(istanze).toHaveLength(1);
    expect(stati.at(-1)).toBe('off');
  });

  it('ogni errore previsto dalle specifiche ha un esito dichiarato', async () => {
    const casi: Array<[string, string | null]> = [
      ['not-allowed', 'denied'],
      ['service-not-allowed', 'denied'],
      ['language-not-supported', 'error'],
      ['phrases-not-supported', 'error'],
      ['bad-grammar', 'error'],
      // Transitori: non chiudono la sessione, si riprova.
      ['no-speech', null],
      ['aborted', null],
      ['audio-capture', null],
      ['network', null],
    ];

    for (const [errore, atteso] of casi) {
      const istanze: Array<Record<string, unknown>> = [];
      class Motore {
        lang = '';
        continuous = false;
        interimResults = false;
        maxAlternatives = 0;
        onerror: ((e: { error: string }) => void) | null = null;
        onend: (() => void) | null = null;
        onstart: (() => void) | null = null;
        constructor() {
          istanze.push(this as unknown as Record<string, unknown>);
        }
        start() {}
        stop() {}
        abort() {}
      }
      vi.stubGlobal('window', { SpeechRecognition: Motore });
      resetOnDeviceState();

      const stati: string[] = [];
      new BrowserVoiceProvider(true).start({ onStatus: (s) => stati.push(s) });
      (istanze[0]!.onerror as (e: { error: string }) => void)({ error: errore });
      expect([errore, stati.at(-1) ?? null]).toEqual([errore, atteso]);
    }
  });

  it('sceglie SpeechRecognition dove esiste, webkit altrimenti', () => {
    class A {}
    class B {}
    vi.stubGlobal('window', { SpeechRecognition: A, webkitSpeechRecognition: B });
    expect(selectedVoiceApi()).toBe('SpeechRecognition');
    vi.stubGlobal('window', { webkitSpeechRecognition: B });
    expect(selectedVoiceApi()).toBe('webkitSpeechRecognition');
    vi.stubGlobal('window', {});
    expect(selectedVoiceApi()).toBe('assente');
  });

  it('due start consecutivi non aprono due riconoscimenti', () => {
    const istanze: unknown[] = [];
    class Motore {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 0;
      constructor() {
        istanze.push(this);
      }
      start() {}
      stop() {}
      abort() {}
    }
    vi.stubGlobal('window', { SpeechRecognition: Motore });
    resetOnDeviceState();
    const provider = new BrowserVoiceProvider(true);
    provider.start({});
    provider.start({});
    expect(istanze).toHaveLength(1);
  });

  it('il DEBUG VOCE esiste solo dietro ?debugVoice=1 e non esce dal dispositivo', () => {
    const app = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8');
    // Un solo interruttore, esplicito.
    expect(app).toMatch(/get\('debugVoice'\) === '1'/);
    expect(app).toMatch(/\{voiceDebug && <VoiceDebugPanel/);
    // La raccolta stessa e' condizionata: fuori dal debug non si accumula nulla.
    expect(app).toMatch(/if \(!voiceDebug\) return;/);

    const panel = readFileSync(resolve(ROOT, 'src/ui/VoiceDebugPanel.tsx'), 'utf8');
    expect(panel).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
    // Le sette righe richieste, tutte presenti.
    for (const riga of [
      'API',
      'MICROFONO',
      'VOCE',
      'LOCALE',
      'REMOTO',
      'ULTIMO ERRORE',
      'ULTIMA FRASE',
    ]) {
      expect(panel).toContain(`label="${riga}"`);
    }
  });

  it('nessun modulo vocale contatta la rete o richiede una chiave', () => {
    for (const file of [
      'src/voice/parser.ts',
      'src/voice/lexicon.ts',
      'src/voice/voiceEvent.ts',
      'src/voice/BrowserVoiceProvider.ts',
      'src/voice/DemoVoiceProvider.ts',
      'src/speech/AlertSpeechEngine.ts',
      'src/speech/BrowserSpeechProvider.ts',
    ]) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      expect(source).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|EventSource|apiKey|https?:\/\//);
    }
  });
});

describe('voce simulata della demo', () => {
  it('recita le frasi previste senza microfono ne\' rete', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const detto: string[] = [];
    const provider = new DemoVoiceProvider([
      { atMs: 1000, text: 'ROAD SENSE, ostacolo in corsia' },
    ]);
    expect(provider.capabilities()).toEqual({ supported: true, onDevice: true });
    provider.start({ onTranscript: (t) => detto.push(t) });
    await vi.advanceTimersByTimeAsync(2000);
    provider.stop();

    expect(detto).toEqual(['ROAD SENSE, ostacolo in corsia']);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('lo stop annulla le frasi non ancora pronunciate', async () => {
    vi.useFakeTimers();
    const detto: string[] = [];
    const provider = new DemoVoiceProvider([{ atMs: 5000, text: 'ROAD SENSE, buca' }]);
    provider.start({ onTranscript: (t) => detto.push(t) });
    provider.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(detto).toEqual([]);
    vi.useRealTimers();
  });
});

describe('la parola di attivazione e\' configurata', () => {
  it('esiste ed e\' sensata', () => {
    expect(VOICE.wakeWords.length).toBeGreaterThan(1);
    expect(VOICE.wakeWords).toContain('road sense');
  });

  it('la confidenza di una voce sola sta sotto la soglia di allerta', () => {
    // Non e' un dettaglio: e' cio' che impedisce a una frase isolata di
    // generare un avviso.
    const cluster = buildClusters([reportEvent('ROAD SENSE, incidente')!])[0]!;
    expect(cluster.confidence).toBeLessThan(ALERT.minConfidence);
  });
});

describe('stato di conferma di una segnalazione vocale', () => {
  it('una voce sola e\' SEGNALATA, non confermata', () => {
    const a = reportEvent('ROAD SENSE, auto in avaria in seconda corsia', 'aaaaaaaaaaaaaaaa')!;
    const cluster = buildClusters([a])[0]!;
    expect(assessCluster(cluster, [a]).confirmation).toBe('reported');
  });

  it('due dispositivi distinti la CORROBORANO', () => {
    const a = reportEvent('ROAD SENSE, auto in avaria in seconda corsia', 'aaaaaaaaaaaaaaaa')!;
    const b = reportEvent('ROAD SENSE, auto in avaria in seconda corsia', 'bbbbbbbbbbbbbbbb')!;
    const cluster = buildClusters([a, b])[0]!;
    expect(cluster.reporters).toBe(2);
    expect(assessCluster(cluster, [a, b]).confirmation).toBe('corroborated');
  });

  it('la conferma NON dipende da un coefficiente tarato sulla soglia', () => {
    // Due voci concordi restano sotto la soglia storica di confidenza, ed e'
    // giusto cosi': la confidenza misura un'altra cosa. A decidere l'avviso
    // e' lo stato di conferma, che e' un conteggio di dispositivi distinti.
    const a = reportEvent('ROAD SENSE, auto in avaria', 'aaaaaaaaaaaaaaaa')!;
    const b = reportEvent('ROAD SENSE, auto in avaria', 'bbbbbbbbbbbbbbbb')!;
    const cluster = buildClusters([a, b])[0]!;
    const valutazione = assessCluster(cluster, [a, b]);

    expect(cluster.confidence).toBeLessThan(ALERT.minConfidence);
    expect(valutazione.confirmation).toBe('corroborated');
    expect(admitsAlert(cluster, valutazione, ALERT.minConfidence)).toBe(true);
  });
});

describe('consenso all\'elaborazione remota dell\'audio', () => {
  const app = readFileSync(resolve(ROOT, 'src', 'App.tsx'), 'utf8');

  it('senza consenso il microfono NON si accende', () => {
    class Remota {}
    vi.stubGlobal('window', { SpeechRecognition: Remota });
    const provider = new BrowserVoiceProvider(false);
    const stati: string[] = [];
    let trascritto = false;
    provider.start({ onStatus: (s) => stati.push(s), onTranscript: () => (trascritto = true) });
    expect(stati).toEqual(['off']);
    expect(trascritto).toBe(false);
  });

  it('con consenso esplicito il provider puo\' partire', () => {
    class Remota {
      lang = '';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: unknown = null;
      onerror: unknown = null;
      onend: unknown = null;
      onstart: (() => void) | null = null;
      start() {
        this.onstart?.();
      }
      stop() {}
      abort() {}
    }
    vi.stubGlobal('window', { SpeechRecognition: Remota });
    const stati: string[] = [];
    new BrowserVoiceProvider(true).start({ onStatus: (s) => stati.push(s) });
    expect(stati).toContain('listening');
  });

  it('il consenso richiede DUE tocchi e non viene ricordato fra sessioni', () => {
    // Primo tocco: si chiede. Secondo: si autorizza.
    expect(app).toMatch(/setVoiceConsent\('pending'\)/);
    expect(app).toMatch(/setVoiceConsent\('granted'\)/);
    // Vive in memoria: nessuna persistenza.
    expect(app).not.toMatch(/voiceConsent[\s\S]{0,80}localStorage/);
  });

  it('il testo mostrato dice cosa accadrebbe e cosa fare', () => {
    expect(app).toMatch(/non elabora la voce sul dispositivo/);
    expect(app).toMatch(/audio verrebbe inviato a un servizio esterno/);
    expect(app).toMatch(/Tocca di nuovo VOCE per accettare/);
  });

  it('non dichiara mai "voce attiva" quando non lo e\'', () => {
    // Il messaggio di attivazione compare solo nei rami che accendono davvero.
    const richiesta = app.slice(app.indexOf("setVoiceConsent('pending')"));
    const finoAlRitorno = richiesta.slice(0, richiesta.indexOf('return;'));
    expect(finoAlRitorno).not.toMatch(/Voce attiva/);
  });

  it('in demo non serve alcun consenso: nulla lascia il dispositivo', () => {
    expect(app).toMatch(/if \(demo\) \{\s*setVoiceEnabled\(true\);/);
  });
});

describe('la sintesi vocale e\' indipendente dal riconoscimento', () => {
  const app = readFileSync(resolve(ROOT, 'src', 'App.tsx'), 'utf8');

  it('gli avvisi parlati non dipendono dalla voce in ingresso', () => {
    // `announce` viene invocato nella gestione delle posizioni, non dentro
    // l'effetto del riconoscimento vocale.
    const effetto = app.slice(
      app.indexOf('// -- riconoscimento vocale'),
      app.indexOf('const toggleVoice'),
    );
    expect(effetto).not.toMatch(/speechRef\.current\.announce/);
    expect(app).toMatch(/speechRef\.current\.announce\(/);
  });

  it('il motore di sintesi non consulta lo stato della voce in ingresso', () => {
    const engine = readFileSync(
      resolve(ROOT, 'src', 'speech', 'AlertSpeechEngine.ts'),
      'utf8',
    );
    expect(engine).not.toMatch(/voiceEnabled|VoiceProvider|SpeechRecognition/);
  });

  it('con riconoscimento assente ma sintesi presente, ROAD SENSE parla', () => {
    // Nessun riconoscimento...
    vi.stubGlobal('window', {});
    expect(new BrowserVoiceProvider().capabilities().supported).toBe(false);

    // ...ma la sintesi funziona lo stesso.
    const parlato: string[] = [];
    const engine = new AlertSpeechEngine({
      id: 'x',
      isSupported: () => true,
      speak: (t: string) => parlato.push(t),
      cancel: () => {},
    });
    expect(engine.announce('a', 'Attenzione. Buca tra 200 metri.', 1000)).toBe(true);
    expect(parlato).toHaveLength(1);
  });
});
