/**
 * ROAD SENSE - verifiche sulla Content Security Policy.
 *
 * Il laboratorio `/voice-lab.html` ha richiesto due aggiunte alla policy servita
 * dagli header: `'wasm-unsafe-eval'` per poter compilare WebAssembly e `blob:`
 * in `connect-src` per poter leggere il modello scelto dall'utente.
 *
 * Sono aggiunte GLOBALI per necessita' tecnica, non per scelta: nel formato
 * `_headers` due regole che combaciano uniscono i valori con una virgola, e un
 * header CSP con valori separati da virgola vale come politiche multiple tutte
 * applicate - cioe' l'intersezione. Restringere per percorso si puo', allargare
 * no.
 *
 * L'allargamento resta pero' CONTENUTO, e questo file e' cio' che lo tiene
 * contenuto: `index.html` porta un proprio meta CSP piu' stretto, e header e
 * meta vengono applicati entrambi. Per il documento di ROAD SENSE vale quindi
 * l'intersezione, e l'effetto delle due aggiunte e' nullo.
 *
 * Se qualcuno domani allentasse il meta di `index.html`, quella contenzione
 * svanirebbe in silenzio. Questi test fanno rumore.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const headers = readFileSync(join(process.cwd(), 'public', '_headers'), 'utf8');
const indexHtml = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

/** La policy servita a TUTTI i percorsi. */
const headerCsp = (/Content-Security-Policy:\s*(.+)/.exec(headers)?.[1] ?? '').trim();
/** La policy che `index.html` si impone da sola, in aggiunta a quella sopra. */
const metaCsp = (
  /http-equiv="Content-Security-Policy"\s*content="([^"]+)"/s.exec(indexHtml)?.[1] ?? ''
).trim();

const directive = (csp: string, name: string): string =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `)) ?? '';

describe('CSP / le aggiunte del laboratorio ci sono', () => {
  it('le due policy sono state trovate', () => {
    expect(headerCsp.length).toBeGreaterThan(50);
    expect(metaCsp.length).toBeGreaterThan(50);
  });

  it("script-src consente WebAssembly ma NON eval", () => {
    const script = directive(headerCsp, 'script-src');
    expect(script).toContain("'wasm-unsafe-eval'");
    // La differenza che conta: 'unsafe-eval' consentirebbe anche eval() e
    // new Function(), cioe' esecuzione di codice arbitrario.
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).toContain("'self'");
  });

  it('connect-src consente blob: per il modello scelto localmente', () => {
    expect(directive(headerCsp, 'connect-src')).toContain('blob:');
  });
});

describe('CSP / nulla e stato rimosso e nessun dominio aggiunto', () => {
  const preesistenti = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    'upgrade-insecure-requests',
  ];

  it.each(preesistenti)('la direttiva %s e ancora presente', (frammento) => {
    expect(headerCsp).toContain(frammento);
  });

  it('gli unici domini esterni restano OpenFreeMap e NOWCAST', () => {
    const domini = [...headerCsp.matchAll(/https?:\/\/[^\s;]+/g)].map((m) => m[0]);
    expect(new Set(domini)).toEqual(
      new Set(['https://tiles.openfreemap.org', 'https://nowcast.pezzalihub.app']),
    );
  });

  it('COOP e gli altri header di sicurezza sono intatti', () => {
    expect(headers).toContain('Cross-Origin-Opener-Policy: same-origin');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('X-Frame-Options: DENY');
    expect(headers).toContain('Referrer-Policy: strict-origin-when-cross-origin');
    expect(headers).toContain('Strict-Transport-Security: max-age=31536000');
  });

  it('COEP non e stato introdotto', () => {
    // Il decoder scelto e' a thread singolo proprio per non averne bisogno:
    // COEP avrebbe messo a rischio il caricamento della cartografia.
    expect(headers).not.toContain('Cross-Origin-Embedder-Policy');
  });

  it('il microfono resta consentito alla nostra origine', () => {
    expect(headers).toContain('microphone=(self)');
  });
});

describe('CSP / header e meta sono ALLINEATI', () => {
  /**
   * Prima il meta di `index.html` era piu' stretto dell'header, e sostenevo
   * che questo "conteneva" l'allargamento senza toccare l'applicazione. Era
   * vero, ed e' esattamente cio' che ha impedito a ROAD SENSE di usare Vosk:
   * il worker nasce dal documento e eredita l'INTERSEZIONE delle due policy,
   * quindi `'wasm-unsafe-eval'` e `blob:` venivano annullati dal meta e
   * WebAssembly non riusciva nemmeno a compilare.
   *
   * Due policy che differiscono sono una trappola: quella scritta nell'header
   * sembra in vigore e non lo e'. Ora devono coincidere, e questi test lo
   * impongono.
   */
  it('script-src e connect-src coincidono fra header e meta', () => {
    expect(directive(metaCsp, 'script-src')).toBe(directive(headerCsp, 'script-src'));
    expect(directive(metaCsp, 'connect-src')).toBe(directive(headerCsp, 'connect-src'));
  });

  it('il meta consente WebAssembly, che serve al decoder locale', () => {
    expect(directive(metaCsp, 'script-src')).toContain("'wasm-unsafe-eval'");
  });

  it('il meta consente blob:, che serve al modello ricomposto nel dispositivo', () => {
    expect(directive(metaCsp, 'connect-src')).toContain('blob:');
  });

  it('NESSUNA delle due policy consente unsafe-eval', () => {
    // E' il motivo per cui il decoder e' stato ricompilato invece di allargare
    // la policy: `'unsafe-eval'` avrebbe concesso la generazione di codice da
    // stringa all'intera origine.
    for (const [nome, csp] of [['header', headerCsp], ['meta', metaCsp]] as const) {
      expect(directive(csp, 'script-src'), `${nome} consente unsafe-eval`).not.toMatch(
        /(^|[^-])'unsafe-eval'/,
      );
    }
  });

  it('il laboratorio non porta un meta CSP, quindi per lui vale l header', () => {
    const lab = readFileSync(join(process.cwd(), 'voice-lab.html'), 'utf8');
    expect(lab).not.toContain('http-equiv="Content-Security-Policy"');
  });
});
