/**
 * ROAD SENSE / LABORATORIO FASE 0 - verifiche sul sorgente, non sul
 * comportamento.
 *
 * Due promesse sono state fatte per questo prototipo, e nessuna delle due si
 * puo' dimostrare con un test funzionale:
 *
 *   1. il riconoscimento e' davvero locale: nessun `SpeechRecognition`,
 *      nessun servizio, nessuna registrazione, nessuna trasmissione;
 *   2. il prototipo e' davvero isolato: non tocca la pipeline di ROAD SENSE,
 *      ne' in un verso ne' nell'altro.
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
const WORKLET = join(process.cwd(), 'public', 'lab', 'pcmTap.worklet.js');
const PAGE = join(process.cwd(), 'voice-lab.html');

/** Codice del laboratorio, senza i test e senza commenti. */
function labCode(): { file: string; code: string }[] {
  const files = readdirSync(LAB_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  expect(files.length).toBeGreaterThan(0);
  const out = files.map((f) => ({ file: `src/lab/${f}`, code: stripJs(readFileSync(join(LAB_DIR, f), 'utf8')) }));
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
  const vietati = [
    'SpeechRecognition',
    'webkitSpeechRecognition',
    'MediaRecorder',
    'XMLHttpRequest',
    'WebSocket',
    'sendBeacon',
    'EventSource',
    'fetch(',
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

  it('l unico URL di rete e il modulo del worklet, servito dalla nostra origine', () => {
    const micSession = labCode().find((f) => f.file.endsWith('micSession.ts'));
    expect(micSession).toBeDefined();
    expect(micSession?.code).toContain("'/lab/pcmTap.worklet.js'");
    // Nessuna origine esterna nel codice del laboratorio.
    for (const { file, code } of labCode()) {
      expect(code, `${file} nomina un'origine esterna`).not.toMatch(/https?:\/\//);
    }
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

  it.each(pipeline)('non fa riferimento a %s', (nome) => {
    for (const { file, code } of labCode()) {
      expect(code, `${file} fa riferimento a ${nome}`).not.toContain(nome);
    }
  });

  it('non importa nulla fuori da src/lab', () => {
    for (const { file, code } of labCode()) {
      for (const match of code.matchAll(/from\s+'([^']+)'/g)) {
        const spec = match[1] as string;
        const lecito = spec.startsWith('./') || spec === 'vosk-browser' || spec.startsWith('node:');
        expect(lecito, `${file} importa ${spec}`).toBe(true);
      }
      // Nessuna risalita verso l'applicazione, in nessuna forma.
      expect(code, `${file} risale fuori da src/lab`).not.toContain("from '../");
    }
  });

  it('ROAD SENSE non importa il laboratorio', () => {
    // La direzione opposta conta altrettanto: il prototipo non deve poter
    // entrare nel bundle dell'applicazione per una svista.
    const sorgenti = collectSources(join(process.cwd(), 'src'));
    for (const file of sorgenti) {
      if (file.includes(`${join('src', 'lab')}`)) continue;
      const code = stripJs(readFileSync(file, 'utf8'));
      expect(code, `${file} importa dal laboratorio`).not.toMatch(/from\s+'[^']*lab\//);
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
