/**
 * ROAD SENSE - riconoscimento vocale tramite le API del browser.
 *
 * Usa esclusivamente `SpeechRecognition` / `webkitSpeechRecognition`: nessuna
 * dipendenza, nessun servizio a pagamento, nessuna chiave.
 *
 * PRIVACY, ed e' il punto che conta piu' di tutti gli altri
 * La documentazione delle API e' esplicita: "By default, using speech
 * recognition on a web page involves a server-based recognition engine. Your
 * audio is sent to a web service for recognition processing."
 *
 * Per un'applicazione che promette che i dati non lasciano il telefono questo
 * e' un problema, non un dettaglio. ROAD SENSE quindi:
 *   1. usa `processLocally` SOLO dove il browser conferma che un modello
 *      locale e' davvero installato per la lingua richiesta;
 *   2. dichiara nelle capacita' se l'elaborazione sara' locale o remota;
 *   3. lascia la voce SPENTA finche' non viene attivata esplicitamente.
 *
 * PERCHE' LA VERIFICA CONTA (diagnosi Samsung Fold)
 * Chrome per Android espone `processLocally` nell'interfaccia a partire da
 * Chrome 138, ma esporre l'opzione NON significa che il modello locale sia
 * installato per l'italiano. Dare per disponibile l'elaborazione locale solo
 * perche' la proprieta' esiste porta a impostare `processLocally = true` su un
 * motore che non puo' soddisfarla: il riconoscimento fallisce subito con
 * `language-not-supported` e la voce non parte mai. La disponibilita' reale si
 * chiede con `availableOnDevice()`, che e' asincrona; finche' non risponde
 * "available" l'elaborazione locale NON viene data per buona.
 *
 * ASCOLTO SU RICHIESTA: UNA SESSIONE PER TOCCO
 *
 * Un tocco su VOCE apre UNA sessione, si pronuncia il comando, la sessione
 * si chiude. Non esiste alcun riavvio automatico.
 *
 * Perche' si e' arrivati qui. Le due strade precedenti hanno fallito sul
 * campo, ciascuna su una piattaforma diversa:
 *
 *   ascolto continuo    su iPhone tiene attiva una sessione audio di
 *                       REGISTRAZIONE per tutto il viaggio: iOS dirotta la
 *                       riproduzione e l'impianto dell'auto resta muto.
 *
 *   ascolto a finestre  su Android il riconoscitore si chiude da solo a ogni
 *                       silenzio; riaprirlo fa suonare il tono di
 *                       attivazione a ripetizione. Nel test sul Samsung Fold
 *                       era un tono ogni secondo e mezzo, ininterrotto.
 *
 * Nessuna delle due si aggiusta con una costante: il problema e' tenere il
 * microfono aperto quando nessuno sta parlando. Una sessione per tocco lo
 * elimina. Il prezzo e' dichiarato: le segnalazioni vocali non sono piu' a
 * mani libere. Serve un tocco - lo stesso del pulsante SEGNALA, con in piu'
 * la possibilita' di dire cosa si e' visto.
 *
 * UNA SOLA TRASCRIZIONE PER SESSIONE
 * Alla prima frase utile la sessione si chiude. Un riconoscitore che
 * consegna due volte lo stesso risultato - capita su Android - non puo'
 * produrre due segnalazioni.
 */

import { VOICE } from '../config/config';
import type {
  VoiceApiName,
  VoiceCapabilities,
  VoiceHandlers,
  VoiceLocalState,
  VoicePhase,
  VoiceProvider,
  VoiceStatus,
} from './VoiceProvider';

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
  length: number;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent {
  error: string;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onaudiostart?: (() => void) | null;
  onaudioend?: (() => void) | null;
  onsoundstart?: (() => void) | null;
  onsoundend?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  onnomatch?: (() => void) | null;
}
type RecognitionCtor = new () => RecognitionLike;

/** Statica proposta da Chrome per sapere se il modello locale c'e' davvero. */
type OnDeviceStatics = {
  availableOnDevice?: (lang: string) => Promise<string | boolean>;
};

/**
 * Quale dei due costruttori viene REALMENTE usato.
 * `SpeechRecognition` ha la precedenza dove esiste; su Chrome per Android e su
 * Samsung Internet, al momento, si finisce quasi sempre sul prefisso webkit.
 */
export function selectedVoiceApi(): VoiceApiName {
  if (typeof window === 'undefined') return 'assente';
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.SpeechRecognition === 'function') return 'SpeechRecognition';
  if (typeof w.webkitSpeechRecognition === 'function') return 'webkitSpeechRecognition';
  return 'assente';
}

function recognitionCtor(): RecognitionCtor | null {
  const api = selectedVoiceApi();
  if (api === 'assente') return null;
  return (window as unknown as Record<string, RecognitionCtor>)[api] ?? null;
}

/** Il browser espone l'OPZIONE dell'elaborazione locale (non la garantisce). */
function exposesOnDeviceOption(ctor: RecognitionCtor): boolean {
  try {
    return 'processLocally' in ctor.prototype;
  } catch {
    return false;
  }
}

/**
 * Esito della verifica sull'elaborazione locale, memorizzato per non ripetere
 * la domanda a ogni tocco. Parte da 'non disponibile' per prudenza: si afferma
 * che la voce resta sul dispositivo solo dopo una risposta affermativa.
 */
let onDeviceState: VoiceLocalState = 'non disponibile';

export function onDeviceStateNow(): VoiceLocalState {
  return onDeviceState;
}

/** Solo per i test: riporta la verifica allo stato iniziale. */
export function resetOnDeviceState(): void {
  onDeviceState = 'non disponibile';
}

/**
 * Chiede al browser se il modello locale e' installato per la lingua.
 * Asincrona per forza: e' cosi' che la definisce l'API. Va chiamata mentre il
 * monitoraggio e' fermo, cioe' quando si attiva la voce, non durante la guida.
 */
export async function probeOnDevice(lang: string = VOICE.lang): Promise<boolean> {
  const ctor = recognitionCtor();
  if (!ctor || !exposesOnDeviceOption(ctor)) {
    onDeviceState = 'non disponibile';
    return false;
  }
  const statics = ctor as unknown as OnDeviceStatics;
  if (typeof statics.availableOnDevice !== 'function') {
    // L'opzione esiste ma non e' verificabile: non si puo' AFFERMARE che
    // l'audio resti sul dispositivo, quindi non lo si afferma.
    onDeviceState = 'non disponibile';
    return false;
  }
  try {
    const answer = await statics.availableOnDevice(lang);
    // "downloadable" e "downloading" NON sono "available": il modello ancora
    // non c'e', e impostare processLocally fallirebbe.
    const ready = answer === true || answer === 'available';
    onDeviceState = ready ? 'si' : 'no';
    return ready;
  } catch {
    onDeviceState = 'no';
    return false;
  }
}

/**
 * Errori che non migliorano riprovando con la stessa configurazione.
 * Riavviare su questi significa solo consumare batteria e tenere acceso un
 * indicatore che mente.
 */
const FATAL_ERRORS = new Set([
  'not-allowed',
  'service-not-allowed',
  'language-not-supported',
  'phrases-not-supported',
  'bad-grammar',
]);

export class BrowserVoiceProvider implements VoiceProvider {
  readonly id = 'browser-voice';
  readonly label = 'Riconoscimento del browser';

  private recognition: RecognitionLike | null = null;
  private handlers: VoiceHandlers = {};
  /** Una sessione e' aperta in questo momento. */
  private active = false;
  /**
   * La sessione ha gia' consegnato una frase.
   * Un risultato in piu' - duplicato dal browser, o arrivato mentre si
   * chiude - viene ignorato: una pronuncia, una segnalazione.
   */
  private delivered = false;
  /**
   * Generazione della sessione corrente.
   * Ogni rilascio la incrementa: un evento in ritardo da un riconoscitore
   * gia' chiuso non puo' produrre una segnalazione fantasma.
   */
  private generation = 0;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  /** Traccia degli ultimi eventi, per la diagnosi. */
  private trail: string[] = [];
  /** Il tentativo in corso ha chiesto l'elaborazione locale? */
  private usingLocal = false;

  constructor(
    private readonly allowRemote: boolean = false,
    private readonly env: VoiceEnvironment = browserVoiceEnvironment(),
  ) {}

  capabilities(): VoiceCapabilities {
    const ctor = this.env.ctor();
    if (!ctor) return { supported: false, onDevice: false };
    return { supported: true, onDevice: onDeviceState === 'si' };
  }

  /** true mentre una sessione e' in ascolto. */
  isListening(): boolean {
    return this.active;
  }

  /**
   * Apre UNA sessione di ascolto.
   *
   * SINCRONA FINO A `recognition.start()`, di proposito: su Android il
   * permesso del microfono viene concesso solo se la chiamata avviene dentro
   * l'attivazione del tocco. Nessun `await`, nessuna Permissions API e
   * nessun `getUserMedia` la precedono.
   *
   * Un secondo tocco mentre la sessione e' gia' aperta non fa nulla: non si
   * aprono due microfoni.
   */
  start(handlers: VoiceHandlers): void {
    if (this.active) return;
    this.handlers = handlers;
    this.trail = [];
    this.delivered = false;
    this.report({ lastError: null, events: '' });

    const ctor = this.env.ctor();
    this.report({ api: this.env.apiName(), local: onDeviceState, remote: this.allowRemote });
    if (!ctor) {
      this.phase('error');
      this.emit('unsupported');
      return;
    }
    const caps = this.capabilities();
    // Nessuna elaborazione locale confermata e nessun consenso all'invio
    // dell'audio: non si parte. Meglio nessuna voce che una promessa tradita.
    if (!caps.onDevice && !this.allowRemote) {
      this.phase('idle');
      this.emit('off');
      return;
    }

    this.active = true;
    this.open(ctor, caps.onDevice);
  }

  /** Chiude la sessione. Sicura anche se non ce n'e' una aperta. */
  stop(): void {
    this.clearTimer();
    const era = this.active;
    this.active = false;
    this.release();
    if (era) this.phase('idle');
    this.emit('off');
    this.handlers = {};
  }

  /**
   * ROAD SENSE sta per parlare: la sessione si chiude.
   * Senza riavvio - per segnalare di nuovo serve un tocco, come sempre.
   */
  pause(): void {
    this.closeSession('off');
  }

  /** Nessun riavvio automatico: esiste solo per rispettare l'interfaccia. */
  resume(): void {
    /* l'ascolto riparte da un tocco, mai da solo */
  }

  // -- sessione -------------------------------------------------------------

  private open(ctor: RecognitionCtor, onDevice: boolean): void {
    this.release();

    let recognition: RecognitionLike;
    try {
      recognition = new ctor();
    } catch {
      this.active = false;
      this.phase('error');
      this.emit('error');
      return;
    }

    const gen = this.generation;
    const mine = (): boolean => gen === this.generation && this.active;

    recognition.lang = VOICE.lang;
    // Una sessione, una frase. `continuous` terrebbe aperto il microfono
    // anche dopo il comando, che e' esattamente cio' che si vuole evitare.
    recognition.continuous = false;
    // Solo risultati definitivi: un parziale non deve diventare un evento.
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    this.usingLocal = onDevice;
    if (onDevice) recognition.processLocally = true;

    recognition.onstart = () => {
      if (!mine()) return;
      this.mark('start');
      this.phase('listening');
      this.emit('listening');
    };
    recognition.onaudiostart = () => {
      if (!mine()) return;
      this.mark('audiostart');
      this.report({ mic: 'permesso' });
    };
    recognition.onsoundstart = () => {
      if (mine()) this.mark('soundstart');
    };
    recognition.onspeechstart = () => {
      if (!mine()) return;
      this.mark('speechstart');
      this.phase('speech');
    };
    recognition.onnomatch = () => {
      if (mine()) this.mark('nomatch');
    };

    recognition.onresult = (event) => {
      if (!mine() || this.delivered) return;
      this.mark('result');
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result?.isFinal) continue;
        const transcript = result[0]?.transcript ?? '';
        if (transcript.trim().length === 0) continue;

        // La prima frase utile chiude la sessione: un risultato duplicato
        // non puo' produrre una seconda segnalazione.
        this.delivered = true;
        this.phase('result');
        this.report({ lastPhrase: transcript.trim() });
        const consegna = this.handlers.onTranscript;
        this.closeSession('off');
        consegna?.(transcript);
        return;
      }
    };

    recognition.onerror = (event) => {
      if (!mine()) return;
      this.mark(`error:${event.error}`);
      this.report({ lastError: event.error });
      this.handleError(event.error);
    };

    recognition.onend = () => {
      if (!mine()) return;
      this.mark('end');
      // Fine della sessione. NESSUN riavvio: per ascoltare di nuovo serve un
      // altro tocco su VOCE.
      this.closeSession('off');
    };

    this.recognition = recognition;
    this.phase('starting');
    try {
      recognition.start();
    } catch {
      this.active = false;
      this.phase('error');
      this.emit('error');
      return;
    }

    // Se non succede nulla la sessione si chiude da sola, senza lasciare il
    // microfono aperto e senza riprovare.
    this.timeoutTimer = this.env.setTimeout(() => {
      this.timeoutTimer = null;
      if (!mine()) return;
      this.mark('timeout');
      this.closeSession('off');
    }, VOICE.session.timeoutMs);
  }

  private handleError(error: string): void {
    if (error === 'not-allowed') {
      this.report({ mic: 'negato' });
      this.closeSession('denied');
      return;
    }
    // Motore locale chiesto ma non realmente disponibile: si annota e si
    // chiude, senza riprovare da soli.
    if (this.usingLocal && (error === 'language-not-supported' || error === 'service-not-allowed')) {
      onDeviceState = 'no';
      this.report({ local: 'no' });
      this.closeSession('off');
      return;
    }
    if (error === 'service-not-allowed') {
      this.closeSession('denied');
      return;
    }
    if (FATAL_ERRORS.has(error)) {
      this.closeSession('error');
      return;
    }
    // "no-speech" e "aborted" non sono guasti: la sessione finisce e basta.
    this.closeSession('off');
  }

  // -- interni --------------------------------------------------------------

  /** Chiude la sessione una volta sola e dichiara lo stato finale. */
  private closeSession(status: VoiceStatus): void {
    if (!this.active) return;
    this.active = false;
    this.clearTimer();
    this.release();
    this.phase(status === 'denied' || status === 'error' ? 'error' : 'idle');
    this.emit(status);
  }

  /**
   * Stacca e chiude il riconoscitore.
   * La generazione si incrementa PRIMA di abortire: `abort()` emette `end`,
   * e quell'evento non deve riaprire nulla.
   */
  private release(): void {
    const recognition = this.recognition;
    this.recognition = null;
    this.generation++;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.onstart = null;
    recognition.onaudiostart = null;
    recognition.onaudioend = null;
    recognition.onsoundstart = null;
    recognition.onsoundend = null;
    recognition.onspeechstart = null;
    recognition.onspeechend = null;
    recognition.onnomatch = null;
    try {
      recognition.abort();
    } catch {
      // Gia' chiuso: non e' un errore.
    }
  }

  private clearTimer(): void {
    if (this.timeoutTimer !== null) this.env.clearTimeout(this.timeoutTimer);
    this.timeoutTimer = null;
  }

  /** Registra un evento reale del browser, per la diagnosi. */
  private mark(event: string): void {
    this.trail.push(event);
    if (this.trail.length > 8) this.trail.shift();
    this.report({ events: this.trail.join(' > ') });
  }

  private emit(status: VoiceStatus): void {
    this.handlers.onStatus?.(status);
  }

  private phase(phase: VoicePhase): void {
    this.report({ phase });
  }

  private report(patch: Parameters<NonNullable<VoiceHandlers['onDiagnostics']>>[0]): void {
    this.handlers.onDiagnostics?.(patch);
  }
}

/**
 * Ambiente osservabile del riconoscimento.
 * Esiste per poter verificare il ciclo - finestre, pause, rilasci, visibilita'
 * - senza un browser e senza aspettare secondi reali.
 */
export interface VoiceEnvironment {
  ctor: () => RecognitionCtor | null;
  apiName: () => VoiceApiName;
  isVisible: () => boolean;
  onVisibilityChange: (listener: () => void) => () => void;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

export function browserVoiceEnvironment(): VoiceEnvironment {
  return {
    ctor: recognitionCtor,
    apiName: selectedVoiceApi,
    isVisible: () =>
      typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
    onVisibilityChange: (listener) => {
      if (typeof document === 'undefined') return () => undefined;
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle),
  };
}
