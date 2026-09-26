/**
 * ROAD SENSE - il decoder installato non deve generare codice da stringa.
 *
 * PERCHE' QUESTO TEST ESISTE
 *
 * Il pacchetto `vosk-browser` pubblicato su npm NON funziona sotto la nostra
 * CSP. Il runtime embind di Emscripten costruisce i ponti JS/C++ scrivendone il
 * corpo come testo e istanziandolo con `new_(Function, args)` - una
 * `new Function` indiretta, invisibile a qualunque ricerca di `new Function`,
 * `Function(` o `eval`. Sotto `script-src 'self' 'wasm-unsafe-eval'` il worker
 * muore con un EvalError, e ROAD SENSE mostra "VOCE NON DISPONIBILE".
 *
 * La soluzione non e' una patch: e' una ricompilazione con
 * `-s DYNAMIC_EXECUTION=0`, che fa scegliere a embind l'invoker basato su
 * closure gia' previsto da Emscripten. Il risultato sta in
 * `vendor/vosk-browser/`, con le istruzioni per rifarlo.
 *
 * Questo test guarda il pacchetto REALMENTE INSTALLATO. Se qualcuno tornasse
 * alla versione di npm - con un `npm install vosk-browser`, o cancellando la
 * riga `file:vendor/vosk-browser` - la voce si romperebbe di nuovo in
 * produzione, e in un modo che non si vede finche' non si e' in auto. Qui si
 * rompe un test.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const PKG = join(process.cwd(), 'node_modules', 'vosk-browser');
const VENDOR = join(process.cwd(), 'vendor', 'vosk-browser');

/** Estrae il worker, che viaggia in base64 dentro il pacchetto. */
function workerSource(bundlePath: string): string {
  const code = readFileSync(bundlePath, 'utf8');
  const match = /createBase64WorkerFactory\((['"])([A-Za-z0-9+/=]+)\1/.exec(code);
  expect(match, `payload del worker non trovato in ${bundlePath}`).not.toBeNull();
  return Buffer.from((match as RegExpExecArray)[2] as string, 'base64').toString('utf8');
}

/**
 * Ogni forma in cui una stringa puo' diventare codice.
 *
 * `new_(Function` e' nell'elenco perche' e' quella che ci e' sfuggita: cercare
 * solo `new Function` non bastava, il costruttore veniva passato come valore.
 */
const CODEGEN = [
  'new Function',
  'new_(Function',
  'eval',
  'setTimeout("',
  "setTimeout('",
] as const;

describe('decoder Vosk / il pacchetto installato', () => {
  it('e la copia ricompilata, non quella di npm', () => {
    const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      version: string;
      license: string;
    };
    // La 0.0.8 liscia e' quella pubblicata, e non funziona sotto la nostra CSP.
    expect(pkg.version).toBe('0.0.8-csp-safe.1');
    expect(pkg.license).toBe('Apache-2.0');
  });

  it('package.json punta alla copia locale, non al registro', () => {
    const root = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(root.dependencies['vosk-browser']).toBe('file:vendor/vosk-browser');
  });

  it.each(CODEGEN)('il worker installato non contiene %s', (forma) => {
    expect(workerSource(join(PKG, 'dist', 'vosk.js'))).not.toContain(forma);
  });

  it.each(CODEGEN)('il worker versionato nel repository non contiene %s', (forma) => {
    expect(workerSource(join(VENDOR, 'dist', 'vosk.js'))).not.toContain(forma);
  });

  it('non richiede SharedArrayBuffer, quindi niente COOP/COEP', () => {
    // E' la ragione per cui la cartografia non corre rischi: COOP/COEP
    // avrebbero potuto impedire il caricamento dei tile.
    expect(workerSource(join(PKG, 'dist', 'vosk.js'))).not.toContain('SharedArrayBuffer');
  });

  it('embind e ancora presente: la ricompilazione non ha amputato i binding', () => {
    // Senza questo controllo, un worker vuoto passerebbe tutti i test di sopra.
    const worker = workerSource(join(PKG, 'dist', 'vosk.js'));
    expect(worker).toContain('craftInvokerFunction');
    expect(worker).toContain('__embind_register_class');
    expect(worker.length).toBeGreaterThan(3_000_000);
  });

  it('la ricompilazione e documentata, altrimenti non e riproducibile', () => {
    const doc = join(VENDOR, 'COME-E-STATO-COSTRUITO.md');
    expect(existsSync(doc)).toBe(true);
    const testo = readFileSync(doc, 'utf8');
    expect(testo).toContain('DYNAMIC_EXECUTION=0');
    expect(testo).toContain('colima');
    // Il commit di Kaldi e' orfano a monte: senza questa nota la build non
    // riparte piu' su nessuna macchina.
    expect(testo).toContain('6417ac1dece94783e80dfbac0148604685d27579');
  });
});
