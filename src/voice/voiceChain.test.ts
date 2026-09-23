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
import { BrowserVoiceProvider } from './BrowserVoiceProvider';
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

  it('riconosce l\'elaborazione locale quando il browser la offre', () => {
    class Locale {}
    // In Chrome `processLocally` sta sul prototype, non sull'istanza:
    // il fixture deve rispecchiare la forma reale dell'API.
    (Locale.prototype as Record<string, unknown>).processLocally = false;
    vi.stubGlobal('window', { SpeechRecognition: Locale });
    expect(new BrowserVoiceProvider().capabilities()).toEqual({ supported: true, onDevice: true });
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
