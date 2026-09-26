/**
 * ROAD SENSE - TRACCIA TTS, TEMPORANEA.
 *
 * PERCHE' ESISTE
 *
 * Su iPhone un avviso di prossimita' compare a schermo e non viene
 * pronunciato. E' dimostrato che la catena applicativa arriva fino a
 * `window.speechSynthesis.speak(utterance)`: quello che accade dopo e' dentro
 * WebKit, e il codice non lo vede. Peggio: `BrowserSpeechProvider` registrava
 * solo `onend` e `onerror`, quindi non poteva distinguere due situazioni
 * opposte che producono lo stesso silenzio:
 *
 *   - l'enunciato non e' MAI partito (gesto iOS mai ottenuto, `cancel()` che
 *     lo scarta, voci non ancora caricate): nessun evento, chiude il watchdog;
 *   - l'enunciato e' partito regolarmente ma non e' udibile (sessione audio
 *     occupata dal microfono, interruttore del silenzioso): `onstart` e
 *     `onend` arrivano entrambi.
 *
 * Sono due guasti diversi con due riparazioni diverse. Senza `onstart` non si
 * puo' sapere quale dei due sia, e sceglierne uno sarebbe indovinare.
 *
 * COS'E' E COSA NON E'
 *
 * E' un registro in memoria degli ultimi eventi, nient'altro. Non cambia il
 * comportamento della sintesi: non anticipa enunciati, non tocca `cancel()`,
 * non sceglie voci, non apre ne' chiude il microfono. Osserva e tace.
 *
 * Non esce dal dispositivo, non viene salvato, sparisce chiudendo la pagina.
 *
 * E' STRUMENTAZIONE TEMPORANEA: quando la causa su iPhone sara' nota, questo
 * file e il pannello che lo mostra vanno rimossi insieme.
 */

/** Cosa e' successo all'enunciato. */
export type TtsTraceKind = 'request' | 'start' | 'end' | 'error' | 'watchdog';

export interface TtsTraceEvent {
  kind: TtsTraceKind;
  /** Millisecondi trascorsi dalla richiesta in corso. */
  sinceRequestMs: number;
  /** Testo dell'avviso: solo sulla richiesta. */
  text?: string;
  /** Dettaglio leggibile: stato della sintesi, codice d'errore, esito. */
  detail?: string;
}

/** Poche righe: su un telefono di piu' non se ne leggono. */
const MAX_EVENTI = 10;

let eventi: readonly TtsTraceEvent[] = [];
let inizioRichiesta = 0;
const ascoltatori = new Set<() => void>();

/** Registra un evento della sintesi. Non ha effetti sulla sintesi stessa. */
export function traceTts(kind: TtsTraceKind, opts: { text?: string; detail?: string } = {}): void {
  const ora = Date.now();
  if (kind === 'request') inizioRichiesta = ora;
  const evento: TtsTraceEvent = {
    kind,
    sinceRequestMs: kind === 'request' ? 0 : ora - inizioRichiesta,
    ...(opts.text !== undefined ? { text: opts.text } : {}),
    ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
  };
  eventi = [...eventi, evento].slice(-MAX_EVENTI);
  for (const ascoltatore of ascoltatori) ascoltatore();
}

/** Gli ultimi eventi, dal piu' vecchio al piu' recente. */
export function ttsTrace(): readonly TtsTraceEvent[] {
  return eventi;
}

/** Avvisa quando la traccia cambia. Ritorna la funzione per smettere. */
export function subscribeTtsTrace(cb: () => void): () => void {
  ascoltatori.add(cb);
  return () => {
    ascoltatori.delete(cb);
  };
}

/** Svuota la traccia: serve a ripartire puliti da una nuova prova. */
export function clearTtsTrace(): void {
  eventi = [];
  for (const ascoltatore of ascoltatori) ascoltatore();
}
