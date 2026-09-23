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
 * ASCOLTO CONTINUO
 * `continuous` non e' garantito: su Android il riconoscimento si chiude dopo
 * il silenzio, su iOS si chiude quasi sempre dopo una frase. Si riavvia da
 * soli alla chiusura, che e' il massimo realisticamente ottenibile in una PWA.
 * Dopo troppi fallimenti consecutivi si rinuncia, invece di insistere
 * consumando batteria.
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

/** Errori normali in auto: silenzio e chiusure volute non sono guasti. */
const BENIGN_ERRORS = new Set(['no-speech', 'aborted']);

export class BrowserVoiceProvider implements VoiceProvider {
  readonly id = 'browser-voice';
  readonly label = 'Riconoscimento del browser';

  private recognition: RecognitionLike | null = null;
  private handlers: VoiceHandlers = {};
  private active = false;
  private failures = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  /** Il tentativo in corso ha chiesto l'elaborazione locale? */
  private usingLocal = false;
  /** Il ripiego su elaborazione remota e' gia' stato tentato? Una volta sola. */
  private fellBack = false;

  /**
   * @param allowRemote consenso esplicito a far elaborare l'audio da un
   * servizio remoto, quando l'elaborazione locale non e' disponibile.
   */
  constructor(private readonly allowRemote: boolean = false) {}

  capabilities(): VoiceCapabilities {
    const ctor = recognitionCtor();
    if (!ctor) return { supported: false, onDevice: false };
    // onDevice = "confermata", non "forse". La differenza e' l'intera diagnosi
    // del Samsung Fold: l'opzione esisteva, il modello no.
    return { supported: true, onDevice: onDeviceState === 'si' };
  }

  start(handlers: VoiceHandlers): void {
    // Una sola sessione per volta: due `start()` lascerebbero un motore orfano.
    if (this.active) return;
    this.handlers = handlers;
    this.report({ lastError: null });

    const ctor = recognitionCtor();
    this.report({ api: selectedVoiceApi(), local: onDeviceState, remote: this.allowRemote });
    if (!ctor) {
      this.phase('error');
      this.emit('unsupported');
      return;
    }
    const caps = this.capabilities();
    // Nessuna elaborazione locale CONFERMATA e nessun consenso all'invio
    // dell'audio: non si parte. Meglio nessuna voce che una promessa tradita.
    if (!caps.onDevice && !this.allowRemote) {
      this.phase('idle');
      this.emit('off');
      return;
    }

    this.active = true;
    this.failures = 0;
    this.fellBack = false;
    this.launch(ctor, caps.onDevice);
  }

  stop(): void {
    this.active = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.teardown();
    this.phase('ended');
    this.handlers = {};
  }

  // -- interni --------------------------------------------------------------

  /** Stacca e chiude il motore corrente senza toccare lo stato della sessione. */
  private teardown(): void {
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.onstart = null;
    recognition.onaudiostart = null;
    recognition.onspeechstart = null;
    recognition.onspeechend = null;
    recognition.onnomatch = null;
    try {
      recognition.abort();
    } catch {
      // Gia' chiuso: non e' un errore.
    }
  }

  private launch(ctor: RecognitionCtor, onDevice: boolean): void {
    let recognition: RecognitionLike;
    try {
      recognition = new ctor();
    } catch {
      this.phase('error');
      this.emit('error');
      return;
    }

    recognition.lang = VOICE.lang;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    this.usingLocal = onDevice;
    if (onDevice) recognition.processLocally = true;

    recognition.onstart = () => {
      this.failures = 0;
      this.phase('listening');
      this.emit('listening');
    };

    // Il microfono sta davvero producendo audio: distingue "partito" da
    // "partito ma muto", che sul Fold sono due diagnosi diverse.
    recognition.onaudiostart = () => this.report({ mic: 'permesso' });
    recognition.onspeechstart = () => this.phase('speech');
    recognition.onspeechend = () => this.phase('listening');
    recognition.onnomatch = () => this.report({ lastError: 'nomatch (nessuna corrispondenza)' });

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result?.isFinal) continue;
        const transcript = result[0]?.transcript ?? '';
        if (transcript.trim().length === 0) continue;
        this.phase('result');
        this.report({ lastPhrase: transcript.trim() });
        this.handlers.onTranscript?.(transcript);
      }
    };

    recognition.onerror = (event) => {
      const error = event.error;
      this.report({ lastError: error });

      if (error === 'not-allowed') {
        this.report({ mic: 'negato' });
        this.fail('denied');
        return;
      }

      // Motore locale chiesto ma non realmente disponibile: e' il caso del
      // Fold. Non e' un permesso negato, e' una configurazione impossibile.
      const localRefused =
        this.usingLocal &&
        (error === 'language-not-supported' || error === 'service-not-allowed');
      if (localRefused) {
        onDeviceState = 'no';
        if (this.allowRemote && !this.fellBack) {
          this.fellBack = true;
          this.report({ local: 'no' });
          this.retryRemote();
          return;
        }
        // Senza consenso all'elaborazione remota non c'e' alternativa
        // praticabile: si dichiara spenta, non "in errore".
        this.report({ local: 'no' });
        this.fail('off');
        return;
      }

      if (error === 'service-not-allowed') {
        this.fail('denied');
        return;
      }
      if (FATAL_ERRORS.has(error)) {
        this.fail('error');
        return;
      }
      // "no-speech" e "aborted" sono normali in auto: non sono guasti.
      if (!BENIGN_ERRORS.has(error)) this.failures++;
    };

    recognition.onend = () => {
      if (!this.active) return;
      this.phase('ended');
      if (this.failures >= VOICE.maxRestartFailures) {
        this.emit('error');
        this.active = false;
        return;
      }
      // Il riconoscimento continuo si chiude da solo: riavviarlo e' l'unico
      // modo per tenere il microfono utilizzabile lungo un viaggio.
      this.emit('restarting');
      this.phase('starting');
      this.restartTimer = setTimeout(() => {
        if (!this.active) return;
        try {
          recognition.start();
        } catch {
          this.failures++;
          this.emit('restarting');
        }
      }, VOICE.restartDelayMs);
    };

    this.recognition = recognition;
    this.phase('starting');
    try {
      recognition.start();
    } catch {
      this.phase('error');
      this.emit('error');
    }
  }

  /** Chiude la sessione senza riavvii e dichiara il motivo. */
  private fail(status: VoiceStatus): void {
    this.active = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.phase(status === 'off' ? 'idle' : 'error');
    this.emit(status);
  }

  /** Riparte una sola volta senza elaborazione locale, con consenso dato. */
  private retryRemote(): void {
    this.teardown();
    const ctor = recognitionCtor();
    if (!ctor) {
      this.fail('error');
      return;
    }
    this.failures = 0;
    this.launch(ctor, false);
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
