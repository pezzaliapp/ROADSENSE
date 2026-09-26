/**
 * ROAD SENSE - verifiche sul sorgente della catena vocale locale.
 *
 * Nate per il prototipo, adesso valgono per la produzione: dopo l'integrazione
 * sono gli STESSI moduli a servire ROAD SENSE e il laboratorio. Due promesse
 * che nessun test funzionale puo' dimostrare:
 *
 *   1. il riconoscimento e' davvero locale: nessun `SpeechRecognition`, nessun
 *      servizio, nessuna registrazione, nessuna trasmissione dell'audio;
 *   2. la voce consegna TESTO e non decide niente: non tocca gli engine, e la
 *      pagina diagnostica non entra nell'applicazione.
 *
 * Una promessa del genere si verifica leggendo il codice. Questo file lo fa a
 * ogni `npm test`, cosi' che romperla richieda di rompere anche un test invece
 * di scivolare dentro inosservata.
 *
 * I commenti vengono rimossi prima della ricerca: questi file PARLANO di
 * `SpeechRecognition` per spiegare perche' non lo usano, e cercare la parola
 * nella prosa darebbe un allarme falso a ogni riga di documentazione.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const LAB_DIR = join(process.cwd(), 'src', 'lab');
/** I moduli audio ora vivono qui: li usa ROAD SENSE, non piu' solo il laboratorio. */
const LOCAL_DIR = join(process.cwd(), 'src', 'voice', 'local');
const WORKLET = join(process.cwd(), 'public', 'lab', 'pcmTap.worklet.js');
const PAGE = join(process.cwd(), 'voice-lab.html');

/**
 * Codice della catena vocale locale, senza i test e senza commenti.
 *
 * Comprende il laboratorio E i moduli condivisi sotto `src/voice/local/`: dopo
 * l'integrazione sono gli stessi file a servire ROAD SENSE, quindi le garanzie
 * valgono per entrambi. Non esistono due implementazioni della voce.
 */
function labCode(): { file: string; code: string }[] {
  const out: { file: string; code: string }[] = [];
  for (const [dir, prefisso] of [
    [LAB_DIR, 'src/lab'],
    [LOCAL_DIR, 'src/voice/local'],
  ] as const) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length, `${prefisso} vuota`).toBeGreaterThan(0);
    for (const f of files) {
      out.push({ file: `${prefisso}/${f}`, code: stripJs(readFileSync(join(dir, f), 'utf8')) });
    }
  }
  out.push({ file: 'public/lab/pcmTap.worklet.js', code: stripJs(readFileSync(WORKLET, 'utf8')) });
  return out;
}

function stripJs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function stripHtml(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, ' ');
}

describe('il riconoscimento e locale: nessuna API di sistema, nessuna rete', () => {
  // Il requisito posto esplicitamente: niente riconoscimento di sistema, da cui
  // dipendevano sia il tono di attivazione sia l'invio dell'audio a un servizio.
  // `fetch(` non e' piu' nell'elenco: serve a scaricare i pezzi del MODELLO
  // dalla nostra origine, cioe' dati che vengono VERSO il dispositivo. Che non
  // esca audio e' garantito dalle voci che restano - nessun registratore,
  // nessun canale di invio - e dal test sulle origini esterne qui sopra.
  const vietati = [
    'SpeechRecognition',
    'webkitSpeechRecognition',
    'MediaRecorder',
    'XMLHttpRequest',
    'WebSocket',
    'sendBeacon',
    'EventSource',
  ];

  it.each(vietati)('il codice del laboratorio non contiene %s', (vietato) => {
    for (const { file, code } of labCode()) {
      expect(code, `${file} contiene ${vietato}`).not.toContain(vietato);
    }
  });

  it.each(vietati)('la pagina non contiene %s fuori dai commenti', (vietato) => {
    const html = stripHtml(readFileSync(PAGE, 'utf8'));
    expect(html).not.toContain(vietato);
  });

  it('non scrive nulla su disco: nessuna persistenza dell audio', () => {
    for (const { file, code } of labCode()) {
      for (const vietato of ['localStorage', 'sessionStorage', 'indexedDB', 'showSaveFilePicker']) {
        expect(code, `${file} usa ${vietato}`).not.toContain(vietato);
      }
    }
  });

  it('gli unici URL sono della nostra origine: worklet e pezzi del modello', () => {
    const micSession = labCode().find((f) => f.file.endsWith('micSession.ts'));
    expect(micSession).toBeDefined();
    expect(micSession?.code).toContain("'/lab/pcmTap.worklet.js'");
    // Nessuna origine esterna: ne' per il codice, ne' per il modello.
    for (const { file, code } of labCode()) {
      expect(code, `${file} nomina un'origine esterna`).not.toMatch(/https?:\/\//);
    }
    const modello = labCode().find((f) => f.file.endsWith('modelChunks.ts'));
    // Percorso relativo alla nostra origine, non un dominio.
    expect(modello?.code).toContain('/assets/model/');
  });
});

describe('il laboratorio e isolato da ROAD SENSE', () => {
  const pipeline = [
    'EventStore',
    'DetectionEngine',
    'ConfidenceEngine',
    'AlertEngine',
    'ForwardCorridor',
    'forwardCorridor',
    'mapRoads',
    'corridorDebug',
    'NowcastWeatherProvider',
    'SensorEngine',
    'AlertSpeechEngine',
    'parseVoiceReport',
    'BrowserVoiceProvider',
    'maplibre',
  ];
  // `VoiceProvider` (il contratto) e' lecito: il provider locale lo implementa.
  // Gli ENGINE no: la voce consegna testo e non decide niente.

  it.each(pipeline)('non fa riferimento a %s', (nome) => {
    for (const { file, code } of labCode()) {
      expect(code, `${file} fa riferimento a ${nome}`).not.toContain(nome);
    }
  });

  it('importa solo cio che gli serve: moduli locali, config, lessico e contratto voce', () => {
    const ammessi = new Set([
      'vosk-browser',
      // Il LESSICO e' lecito, ed e' una dipendenza voluta: la grammatica del
      // decoder si DERIVA da li' (`grammarSource.ts`), invece di essere un
      // secondo elenco di parole che divergeva dal parser. E' dati piu'
      // `normalize()`: nessuna logica di decisione entra nella catena vocale.
      // La LOGICA del parser resta vietata - `parseVoiceReport` e' fra i nomi
      // proibiti qui sopra - perche' la voce consegna testo e non decide nulla.
      '../lexicon',
      '../voice/local/grammar',
      '../voice/local/micSession',
      '../voice/local/ringBuffer',
      '../voice/local/speechGate',
      '../voice/local/utteranceCapture',
      '../voice/local/voskRecognizer',
      '../../config/config',
      '../VoiceProvider',
    ]);
    for (const { file, code } of labCode()) {
      for (const match of code.matchAll(/from\s+'([^']+)'/g)) {
        const spec = match[1] as string;
        const lecito = spec.startsWith('./') || spec.startsWith('node:') || ammessi.has(spec);
        expect(lecito, `${file} importa ${spec}`).toBe(true);
      }
    }
  });

  it('la pagina diagnostica non entra nell applicazione', () => {
    // Il laboratorio resta uno strumento: la sua interfaccia non deve comparire
    // in ROAD SENSE, nemmeno per una svista di import.
    const sorgenti = collectSources(join(process.cwd(), 'src'));
    for (const file of sorgenti) {
      if (file.includes(join('src', 'lab'))) continue;
      const code = stripJs(readFileSync(file, 'utf8'));
      expect(code, `${file} importa la pagina diagnostica`).not.toMatch(/from\s+'[^']*lab\//);
    }
  });


});

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSources(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}
