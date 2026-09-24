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
 * ASCOLTO INTERMITTENTE, NON CONTINUO
 *
 * Il primo test in auto ha mostrato un problema che nessun test da scrivania
 * poteva rivelare: su iPhone, con ROAD SENSE in ascolto, l'audio dell'impianto
 * dell'auto veniva praticamente azzerato.
 *
 * La causa e' il modello audio di iOS. Un `SpeechRecognition` aperto tiene
 * attiva una sessione audio di REGISTRAZIONE; il sistema abbassa o dirotta la
 * riproduzione, e su Bluetooth / CarPlay il profilo passa da musica a
 * comunicazione. Tenere il riconoscitore aperto per tutto il viaggio - che e'
 * quello che faceva il riavvio automatico immediato - significa tenere quella
 * sessione aperta per tutto il viaggio.
 *
 * Un'app che ascolta non puo' impedire di ascoltare la musica. Quindi ROAD
 * SENSE NON monopolizza il microfono:
 *
 *   finestra di ascolto  ->  stop()  ->  RILASCIO REALE  ->  pausa  ->  ...
 *
 * Fra una finestra e l'altra il riconoscitore non e' soltanto fermo: viene
 * scartato, i suoi ascoltatori staccati, e non ne esiste nessuno vivo. E'
 * quello che permette a iOS di chiudere la sessione di registrazione.
 *
 * Il prezzo e' dichiarato: una frase pronunciata durante la pausa non viene
 * sentita. E' accettabile perche' la parola di attivazione va comunque detta e
 * si ripete, ed e' preferibile a un'app che spegne la radio.
 *
 * QUANDO ROAD SENSE PARLA
 * Il riconoscitore viene rilasciato anche prima di ogni avviso parlato, e
 * riaperto dopo. Serve a due cose: evitare che la voce sintetica rientri dal
 * microfono e venga scambiata per una segnalazione, ed evitare che sintesi e
 * riconoscimento si contendano la sessione audio.
 *
 * UN SOLO RICONOSCITORE PER VOLTA
 * Ogni finestra crea un'istanza nuova. Le istanze vecchie vengono staccate e
 * abortite, e i loro eventi ignorati tramite un contatore di generazione: un
 * evento in ritardo di un riconoscitore gia' chiuso non deve poter riaprire il
 * ciclo o produrre una segnalazione.
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

/** Errori normali in auto: silenzio e chiusure volute non sono guasti. */
const BENIGN_ERRORS = new Set(['no-speech', 'aborted']);

export class BrowserVoiceProvider implements VoiceProvider {
  readonly id = 'browser-voice';
  readonly label = 'Riconoscimento del browser';

  private recognition: RecognitionLike | null = null;
  private handlers: VoiceHandlers = {};
  /** Il provider e' stato avviato e non ancora fermato. */
  private active = false;
  /** Sospeso perche' ROAD SENSE sta parlando. */
  private suspended = false;
  /** La pagina non e' visibile: nessun ascolto, nessuna sessione audio. */
  private hidden = false;
  /** Una sola finestra di prova, poi ci si ferma (uso dal tocco su VOCE). */
  private primeOnly = false;
  private failures = 0;
  /**
   * Generazione del riconoscitore corrente.
   *
   * Ogni rilascio la incrementa. Gli ascoltatori catturano la propria, e un
   * evento che arriva in ritardo da un riconoscitore gia' chiuso viene
   * ignorato: senza questo, un `end` tardivo riaprirebbe il ciclo e potrebbero
   * esistere due riconoscitori insieme.
   */
  private generation = 0;
  private windowTimer: ReturnType<typeof setTimeout> | null = null;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeVisibility: (() => void) | null = null;
  /** Traccia degli ultimi eventi, per la diagnosi. */
  private trail: string[] = [];
  /** Il tentativo in corso ha chiesto l'elaborazione locale? */
  private usingLocal = false;
  /** Il ripiego su elaborazione remota e' gia' stato tentato? Una volta sola. */
  private fellBack = false;

  /**
   * @param allowRemote consenso esplicito a far elaborare l'audio da un
   * servizio remoto, quando l'elaborazione locale non e' disponibile.
   * @param env ambiente osservabile; iniettabile per i test.
   */
  constructor(
    private readonly allowRemote: boolean = false,
    private readonly env: VoiceEnvironment = browserVoiceEnvironment(),
  ) {}

  capabilities(): VoiceCapabilities {
    const ctor = this.env.ctor();
    if (!ctor) return { supported: false, onDevice: false };
    // onDevice = "confermata", non "forse". La differenza e' l'intera diagnosi
    // del Samsung Fold: l'opzione esisteva, il modello no.
    return { supported: true, onDevice: onDeviceState === 'si' };
  }

  /**
   * Avvia il ciclo di ascolto intermittente.
   *
   * SINCRONA FINO A `recognition.start()`, di proposito. Su Android il
   * permesso del microfono viene concesso a `SpeechRecognition` solo se la
   * chiamata avviene dentro l'attivazione del tocco: qualunque `await`
   * interposto la fa decadere, e il browser rifiuta senza mostrare nulla.
   * Per questo qui non si interroga la Permissions API, non si chiama
   * `getUserMedia` e non si attende niente.
   */
  start(handlers: VoiceHandlers): void {
    if (this.active) return;
    this.handlers = handlers;
    this.trail = [];
    this.report({ lastError: null, events: '' });

    const ctor = this.env.ctor();
    this.report({ api: this.env.apiName(), local: onDeviceState, remote: this.allowRemote });
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
    this.suspended = false;
    this.hidden = false;
    this.failures = 0;
    this.fellBack = false;
    this.unsubscribeVisibility = this.env.onVisibilityChange(() => this.handleVisibility());
    this.openWindow(ctor, caps.onDevice);
  }

  /**
   * Una sola finestra, per ottenere il permesso e sapere se il motore parte.
   *
   * Serve al tocco su VOCE, quando il monitoraggio non e' ancora attivo: apre
   * il riconoscitore dentro il gesto dell'utente - che e' cio' che fa comparire
   * la richiesta del microfono su Android - e lo chiude appena si sa com'e'
   * andata. Non resta niente in ascolto.
   */
  prime(handlers: VoiceHandlers): void {
    this.primeOnly = true;
    this.start(handlers);
  }

  stop(): void {
    this.active = false;
    this.suspended = false;
    this.primeOnly = false;
    this.clearTimers();
    this.release();
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
    this.phase('ended');
    this.handlers = {};
  }

  /**
   * ROAD SENSE sta per parlare: il riconoscitore viene RILASCIATO, non solo
   * ignorato. Cosi' la voce sintetica non puo' rientrare dal microfono, e su
   * iOS sintesi e riconoscimento non si contendono la sessione audio.
   */
  pause(): void {
    if (!this.active || this.suspended) return;
    this.suspended = true;
    this.clearTimers();
    this.release();
    this.phase('voce ROAD SENSE');
  }

  /** Riapre l'ascolto dopo che ROAD SENSE ha finito di parlare. */
  resume(): void {
    if (!this.active || !this.suspended) return;
    this.suspended = false;
    if (this.hidden) return;
    // Un margine dopo la voce: la coda di un enunciato non deve finire
    // nella finestra successiva.
    this.scheduleNext(VOICE.listen.afterSpeechMs);
  }

  // -- ciclo ----------------------------------------------------------------

  /** Apre una finestra di ascolto con un riconoscitore NUOVO. */
  private openWindow(ctor: RecognitionCtor, onDevice: boolean): void {
    if (!this.active || this.suspended || this.hidden) return;
    // Qualunque riconoscitore precedente viene chiuso prima di crearne un
    // altro: due istanze vive insieme significano due sessioni audio.
    this.release();

    let recognition: RecognitionLike;
    try {
      recognition = new ctor();
    } catch {
      this.phase('error');
      this.emit('error');
      return;
    }

    const gen = this.generation;
    const mine = (): boolean => gen === this.generation && this.active;

    recognition.lang = VOICE.lang;
    // Non `continuous`: una finestra contiene una frase. L'ascolto continuo
    // terrebbe aperta la sessione audio, che e' esattamente il problema.
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    this.usingLocal = onDevice;
    if (onDevice) recognition.processLocally = true;

    recognition.onstart = () => {
      if (!mine()) return;
      this.mark('start');
      this.failures = 0;
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
    recognition.onspeechend = () => {
      if (mine()) this.phase('listening');
    };
    recognition.onnomatch = () => {
      if (mine()) this.mark('nomatch');
    };

    recognition.onresult = (event) => {
      if (!mine()) return;
      this.mark('result');
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
      if (!mine()) return;
      this.mark(`error:${event.error}`);
      this.handleError(event.error, ctor);
    };

    recognition.onend = () => {
      if (!mine()) return;
      this.mark('end');
      this.phase('ended');
      // Una finestra si e' chiusa. Il riconoscitore viene rilasciato SEMPRE,
      // anche se il browser lo riutilizzerebbe: e' il rilascio che restituisce
      // la sessione audio al sistema.
      this.release();
      if (this.primeOnly) {
        this.active = false;
        this.primeOnly = false;
        this.clearTimers();
        this.phase('idle');
        return;
      }
      if (this.failures >= VOICE.maxRestartFailures) {
        this.emit('error');
        this.active = false;
        return;
      }
      this.emit('restarting');
      this.scheduleNext(VOICE.listen.gapMs);
    };

    this.recognition = recognition;
    this.phase('starting');
    try {
      recognition.start();
    } catch {
      this.phase('error');
      this.emit('error');
      return;
    }

    // Limite superiore alla finestra: se il browser non chiude da solo, si
    // chiude qui. `stop()` e' garbato - un risultato in arrivo viene
    // consegnato - e porta comunque a `end`, quindi al rilascio.
    this.windowTimer = this.env.setTimeout(() => {
      this.windowTimer = null;
      if (!mine() || this.suspended) return;
      try {
        recognition.stop();
      } catch {
        // Gia' chiuso: il ciclo prosegue da `end`.
      }
    }, VOICE.listen.windowMs);
  }

  /** Programma la finestra successiva, a riconoscitore gia' rilasciato. */
  private scheduleNext(delayMs: number): void {
    if (!this.active || this.suspended || this.hidden || this.primeOnly) return;
    if (this.gapTimer !== null) return;
    this.phase('pausa');
    this.gapTimer = this.env.setTimeout(() => {
      this.gapTimer = null;
      const ctor = this.env.ctor();
      if (!ctor) return;
      this.openWindow(ctor, this.capabilities().onDevice);
    }, delayMs);
  }

  private handleError(error: string, ctor: RecognitionCtor): void {
    this.report({ lastError: error });

    if (error === 'not-allowed') {
      this.report({ mic: 'negato' });
      this.fail('denied');
      return;
    }

    // Motore locale chiesto ma non realmente disponibile: e' il caso del
    // Fold. Non e' un permesso negato, e' una configurazione impossibile.
    const localRefused =
      this.usingLocal && (error === 'language-not-supported' || error === 'service-not-allowed');
    if (localRefused) {
      onDeviceState = 'no';
      this.report({ local: 'no' });
      if (this.allowRemote && !this.fellBack) {
        this.fellBack = true;
        this.release();
        this.failures = 0;
        this.openWindow(ctor, false);
        return;
      }
      // Senza consenso all'elaborazione remota non c'e' alternativa
      // praticabile: si dichiara spenta, non "in errore".
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
    // "no-speech" e "aborted" sono normali in auto: non sono guasti. Con
    // l'ascolto a finestre il silenzio e' anzi il caso piu' frequente.
    if (!BENIGN_ERRORS.has(error)) this.failures++;
  }

  // -- interni --------------------------------------------------------------

  /**
   * Stacca e chiude il riconoscitore corrente.
   *
   * Incrementare la generazione PRIMA di abortire e' voluto: `abort()` emette
   * `end`, e quell'evento non deve riaprire il ciclo.
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

  private clearTimers(): void {
    if (this.windowTimer !== null) this.env.clearTimeout(this.windowTimer);
    if (this.gapTimer !== null) this.env.clearTimeout(this.gapTimer);
    this.windowTimer = null;
    this.gapTimer = null;
  }

  /**
   * A pagina nascosta non si ascolta.
   *
   * Nessun browser garantisce il microfono in secondo piano, e insistere
   * lascerebbe aperta una sessione audio che il sistema non ci ha concesso.
   */
  private handleVisibility(): void {
    const visible = this.env.isVisible();
    if (!visible) {
      this.hidden = true;
      this.clearTimers();
      this.release();
      this.phase('pausa');
      return;
    }
    if (!this.hidden) return;
    this.hidden = false;
    if (this.active && !this.suspended) this.scheduleNext(VOICE.listen.gapMs);
  }

  /** Chiude la sessione senza riavvii e dichiara il motivo. */
  private fail(status: VoiceStatus): void {
    this.active = false;
    this.primeOnly = false;
    this.clearTimers();
    this.release();
    this.phase(status === 'off' ? 'idle' : 'error');
    this.emit(status);
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
