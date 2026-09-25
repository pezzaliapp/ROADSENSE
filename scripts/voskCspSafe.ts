/**
 * ROAD SENSE - rende il worker di Vosk compatibile con la nostra CSP.
 *
 * CODICE DI BUILD, non di esecuzione: non finisce in alcun bundle, non fa parte
 * del laboratorio e non fa parte di ROAD SENSE. Viene eseguito da
 * `vite.config.ts` mentre la build gira.
 *
 * IL PROBLEMA, MISURATO SUL SAMSUNG FOLD
 *
 * Con la CSP dell'origine - `script-src 'self' 'wasm-unsafe-eval'` - il
 * decoder non partiva, e il messaggio era:
 *
 *   "Evaluating a string as JavaScript violates the following Content Security
 *    Policy directive because 'unsafe-eval' is not an allowed source of script"
 *
 * Non era il WebAssembly: quello `'wasm-unsafe-eval'` lo consente. Era UNA riga
 * di JavaScript. In 4,3 MB di worker decodificato esiste una sola `new
 * Function` e nessun `eval(`, ed e' questa, dal runtime embind di Emscripten:
 *
 *   function createNamedFunction(name, body) {
 *     name = makeLegalFunctionName(name);
 *     return new Function("body",
 *       "return function " + name + "() {\n" +
 *       '    "use strict";' +
 *       "    return body.apply(this, arguments);\n" +
 *       "};\n")(body)
 *   }
 *
 * Serve a una cosa sola: dare alla funzione generata un `name` leggibile negli
 * stack trace. Non calcola niente. Viene chiamata durante la registrazione
 * delle classi C++ di Vosk, quindi sta sul percorso obbligato dell'avvio.
 *
 * LA CORREZIONE NON E' INVENTATA QUI
 *
 * Emscripten ha gia' sostituito quella funzione a monte, proprio per la
 * compatibilita' con le CSP. Sorgente attuale, `src/lib/libcore.js`:
 *
 *   $createNamedFunction: (name, func) =>
 *     Object.defineProperty(func, 'name', { value: name }),
 *
 * Il wasm di Vosk e' stato compilato con una versione precedente. Questo file
 * riporta indietro quel fix, e nient'altro.
 *
 * `makeLegalFunctionName` viene mantenuta anche se a monte e' stata tolta:
 * serviva a produrre un identificatore valido dentro il sorgente generato, e
 * con `defineProperty` non sarebbe piu' necessaria. Conservarla riduce a zero
 * la differenza di comportamento osservabile, che e' cio' che si vuole quando
 * si tocca codice di terzi.
 *
 * PERCHE' NON SI E' AGGIUNTO 'unsafe-eval' ALLA CSP
 *
 * Sarebbe stata una riga invece di questo file. Ma `'unsafe-eval'` non si puo'
 * limitare a una singola pagina: nel formato `_headers` le regole che
 * combaciano uniscono i valori con una virgola, e un CSP con valori separati da
 * virgola vale come politiche multiple tutte applicate, cioe' l'intersezione.
 * Si puo' restringere per percorso, non allargare. Avrebbe quindi significato
 * concedere la generazione di codice da stringa all'INTERA origine - la stessa
 * che serve ROAD SENSE - per una riga cosmetica dentro una dipendenza.
 *
 * TUTTO FALLISCE IN CHIUSURA
 *
 * Ogni verifica che non torna interrompe la build. Il giorno in cui
 * `vosk-browser` cambiera' quel codice, la build si fermera' con un messaggio
 * esplicito invece di pubblicare in silenzio una pagina che non parte. E' il
 * comportamento che avremmo voluto la prima volta.
 */

/**
 * Inizio della funzione da sostituire.
 *
 * Si ancora all'intestazione e poi si bilanciano le graffe, invece di scrivere
 * per intero un corpo pieno di virgolette e sequenze di escape: un pattern
 * lungo trascritto a mano sbaglia, e sbaglia in silenzio.
 */
const ANCHOR = 'function createNamedFunction(name,body){';

/** La versione senza generazione di codice, come a monte in Emscripten. */
const REPLACEMENT =
  'function createNamedFunction(name,body){' +
  'return Object.defineProperty(body,"name",{value:makeLegalFunctionName(name)})}';

/** Cio' che non deve sopravvivere nel worker prodotto. */
const FORBIDDEN = ['new Function', 'eval('] as const;

export class VoskPatchError extends Error {
  constructor(message: string) {
    super(`patch CSP-safe di Vosk: ${message}`);
    this.name = 'VoskPatchError';
  }
}

function countOf(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Estende l'ancora fino alla graffa che la chiude. */
function functionSpan(source: string, start: number): { end: number; text: string } {
  const open = source.indexOf('{', start);
  if (open === -1) throw new VoskPatchError('graffa di apertura non trovata');
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { end: i + 1, text: source.slice(start, i + 1) };
    }
  }
  throw new VoskPatchError('graffa di chiusura non trovata');
}

/**
 * Riscrive `createNamedFunction` dentro il sorgente del worker.
 * Esportata a parte per poterla verificare senza costruire nulla.
 */
export function patchWorkerSource(worker: string): string {
  const occorrenze = countOf(worker, ANCHOR);
  if (occorrenze !== 1) {
    throw new VoskPatchError(
      `attese 1 occorrenza di createNamedFunction, trovate ${occorrenze}. ` +
        'Il pacchetto e cambiato: va riesaminato invece di patchato alla cieca.',
    );
  }

  const start = worker.indexOf(ANCHOR);
  const { end, text } = functionSpan(worker, start);

  // Se non contiene piu' la generazione di codice, la patch non ha piu' senso:
  // meglio fermarsi che applicarla a qualcosa che non conosciamo.
  if (!text.includes('new Function')) {
    throw new VoskPatchError(
      'createNamedFunction non contiene piu una new Function: forse e gia corretta a monte',
    );
  }

  const patched = worker.slice(0, start) + REPLACEMENT + worker.slice(end);

  for (const vietato of FORBIDDEN) {
    const rimaste = countOf(patched, vietato);
    if (rimaste !== 0) {
      throw new VoskPatchError(
        `dopo la sostituzione restano ${rimaste} occorrenze di "${vietato}" nel worker`,
      );
    }
  }
  return patched;
}

/** Lunghezza minima di una stringa che puo' essere il worker incorporato. */
const MIN_PAYLOAD = 100_000;

/** Caratteri ammessi in base64. */
function isBase64Char(c: string): boolean {
  return (
    (c >= 'A' && c <= 'Z') ||
    (c >= 'a' && c <= 'z') ||
    (c >= '0' && c <= '9') ||
    c === '+' ||
    c === '/' ||
    c === '='
  );
}

export interface WorkerPayload {
  start: number;
  end: number;
  worker: string;
}

/**
 * Individua il worker incorporato dentro un chunk gia' prodotto.
 *
 * Si cercano le sequenze lunghe di caratteri base64 e si tiene quella che,
 * decodificata, contiene davvero la funzione da correggere. L'alternativa -
 * ancorarsi al nome `createBase64WorkerFactory` - non regge: dopo la
 * minificazione quel nome non esiste piu'.
 *
 * Scansione lineare e non espressione regolare: su un chunk da quasi 6 MB una
 * regex con quantificatore illimitato esaurisce lo stack.
 */
export function findWorkerPayload(code: string): WorkerPayload | null {
  let i = 0;
  while (i < code.length) {
    if (!isBase64Char(code[i] as string)) {
      i++;
      continue;
    }
    const start = i;
    while (i < code.length && isBase64Char(code[i] as string)) i++;
    if (i - start < MIN_PAYLOAD) continue;

    const worker = Buffer.from(code.slice(start, i), 'base64').toString('utf8');
    if (worker.includes(ANCHOR)) return { start, end: i, worker };
  }
  return null;
}

/**
 * Riscrive il worker dentro un chunk prodotto dalla build.
 * Restituisce `null` se questo chunk non contiene il worker di Vosk: e' il caso
 * normale per tutti i chunk di ROAD SENSE, che non lo importano.
 */
export function patchVoskChunk(code: string): string | null {
  const payload = findWorkerPayload(code);
  if (!payload) return null;

  const patched = patchWorkerSource(payload.worker);
  const ricodificato = Buffer.from(patched, 'utf8').toString('base64');

  // Controllo di simmetria: cio' che rimettiamo nel chunk deve ridare
  // esattamente il testo corretto quando il browser lo decodifichera'.
  if (Buffer.from(ricodificato, 'base64').toString('utf8') !== patched) {
    throw new VoskPatchError('la ricodifica base64 non e reversibile');
  }

  const out = code.slice(0, payload.start) + ricodificato + code.slice(payload.end);

  // Verifica finale sul chunk COMPLETO, non solo sul worker.
  const ricontrollo = findWorkerPayload(out);
  if (!ricontrollo) throw new VoskPatchError('worker non piu ritrovabile dopo la sostituzione');
  for (const vietato of FORBIDDEN) {
    if (ricontrollo.worker.includes(vietato)) {
      throw new VoskPatchError(`"${vietato}" ancora presente nel worker del chunk prodotto`);
    }
  }
  return out;
}
