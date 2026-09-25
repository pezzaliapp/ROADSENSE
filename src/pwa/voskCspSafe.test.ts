/**
 * ROAD SENSE - verifiche sulla patch CSP-safe del worker di Vosk.
 *
 * Due livelli, perche' servono a cose diverse.
 *
 * 1. LA TRASFORMAZIONE, su un worker finto costruito qui. Verifica che
 *    sostituisca cio' che deve, e soprattutto che si FERMI quando il pacchetto
 *    non e' quello che si aspetta: una patch cieca su codice di terzi e'
 *    peggio del problema che risolve.
 *
 * 2. IL BUNDLE REALMENTE PRODOTTO, se `dist/` esiste. E' l'unica verifica che
 *    conti davvero: sul Fold non gira la nostra funzione, gira il file emesso.
 *    Senza `dist/` il controllo viene saltato invece di fallire, cosi' `npm
 *    test` resta eseguibile su un albero appena clonato.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findWorkerPayload,
  patchVoskChunk,
  patchWorkerSource,
  VoskPatchError,
} from '../../scripts/voskCspSafe';

/** La funzione difettosa, nella forma esatta in cui compare nel pacchetto. */
const ORIGINALE =
  'function createNamedFunction(name,body){name=makeLegalFunctionName(name);' +
  'return new Function("body","return function "+name+"() {\\n"+\'    "use strict";\'+' +
  '"    return body.apply(this, arguments);\\n"+"};\\n")(body)}';

const finto = (corpo: string): string => `var a=1;${corpo};var b=2;`;

describe('patch CSP-safe / la trasformazione', () => {
  it('sostituisce la generazione di codice con defineProperty', () => {
    const out = patchWorkerSource(finto(ORIGINALE));
    expect(out).not.toContain('new Function');
    expect(out).toContain('Object.defineProperty(body,"name"');
    // Il resto del file non viene toccato.
    expect(out.startsWith('var a=1;')).toBe(true);
    expect(out.endsWith(';var b=2;')).toBe(true);
  });

  it('conserva makeLegalFunctionName, per non cambiare comportamento', () => {
    expect(patchWorkerSource(finto(ORIGINALE))).toContain('makeLegalFunctionName(name)');
  });

  it('la funzione sostituita si comporta come prima', () => {
    // Si esegue davvero il codice sostituito, invece di fidarsi del testo.
    const makeLegalFunctionName = (n: string): string => n.replace(/[^a-zA-Z0-9_]/g, '$');
    const creata = new Function(
      'makeLegalFunctionName',
      `${patchWorkerSource(ORIGINALE)}; return createNamedFunction;`,
    )(makeLegalFunctionName) as (name: string, body: unknown) => { name: string };

    const f = creata('Vosk::Recognizer', (a: number, b: number) => a + b) as unknown as {
      name: string;
      (a: number, b: number): number;
      prototype: unknown;
    };
    expect(f.name).toBe('Vosk$$Recognizer');
    expect(f(2, 3)).toBe(5);
  });
});

describe('patch CSP-safe / si ferma invece di indovinare', () => {
  it('rifiuta un worker senza la funzione attesa', () => {
    expect(() => patchWorkerSource('var a=1;')).toThrow(VoskPatchError);
  });

  it('rifiuta un worker con PIU di una occorrenza', () => {
    expect(() => patchWorkerSource(finto(ORIGINALE) + finto(ORIGINALE))).toThrow(/trovate 2/);
  });

  it('rifiuta una funzione che non contiene piu la generazione di codice', () => {
    // E' il caso in cui vosk-browser aggiornasse Emscripten: la patch non
    // serve piu' e applicarla sarebbe un intervento alla cieca.
    const gia = 'function createNamedFunction(name,body){return body}';
    expect(() => patchWorkerSource(finto(gia))).toThrow(/gia corretta a monte/);
  });

  it('rifiuta una funzione troncata', () => {
    expect(() => patchWorkerSource('function createNamedFunction(name,body){new Function')).toThrow(
      /graffa di chiusura/,
    );
  });
});

describe('patch CSP-safe / sul chunk', () => {
  /** Chunk finto: il worker incorporato come stringa base64, come nel vero. */
  function chunkCon(worker: string): string {
    const b64 = Buffer.from(worker, 'utf8').toString('base64');
    return `var W=t("${b64}");export{W};`;
  }
  /** Riempitivo, per superare la soglia di lunghezza del payload. */
  const riempi = (s: string): string => s + '//' + 'x'.repeat(120_000);

  it('trova e corregge il worker dentro il chunk', () => {
    const out = patchVoskChunk(chunkCon(riempi(finto(ORIGINALE))));
    expect(out).not.toBeNull();
    const trovato = findWorkerPayload(out as string);
    expect(trovato?.worker).not.toContain('new Function');
    expect(trovato?.worker).toContain('Object.defineProperty(body,"name"');
  });

  it('lascia intatti i chunk che non contengono il worker', () => {
    // E' il caso di tutti i chunk di ROAD SENSE.
    expect(patchVoskChunk('export const a = 1;')).toBeNull();
    expect(patchVoskChunk(`var x="${'A'.repeat(200_000)}";`)).toBeNull();
  });
});

describe('patch CSP-safe / il bundle REALMENTE prodotto', () => {
  const assets = join(process.cwd(), 'dist', 'assets');
  const costruito = existsSync(assets);

  it.skipIf(!costruito)('nessun chunk contiene un worker con eval', () => {
    const files = readdirSync(assets).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(0);

    let conWorker = 0;
    for (const file of files) {
      const payload = findWorkerPayload(readFileSync(join(assets, file), 'utf8'));
      if (!payload) continue;
      conWorker++;
      expect(payload.worker, `${file}: new Function`).not.toContain('new Function');
      expect(payload.worker, `${file}: eval(`).not.toContain('eval(');
      expect(payload.worker).toContain('Object.defineProperty(body,"name"');
    }
    // Esattamente un chunk porta il worker: quello del laboratorio.
    expect(conWorker).toBe(1);
  });

  it.skipIf(!costruito)('il bundle di ROAD SENSE non contiene Vosk', () => {
    const app = readdirSync(assets).filter((f) => /^(index|react|maplibre)-/.test(f));
    expect(app.length).toBeGreaterThan(0);
    for (const file of app) {
      const code = readFileSync(join(assets, file), 'utf8');
      expect(findWorkerPayload(code), `${file} contiene il worker di Vosk`).toBeNull();
      for (const marcatore of ['KaldiRecognizer', 'retrieveFinalResult', 'pcm-tap']) {
        expect(code, `${file} contiene ${marcatore}`).not.toContain(marcatore);
      }
    }
  });
});
