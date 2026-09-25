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
 *
 * ESPERIMENTO IN CORSO: SESSIONE LUNGA
 * Il test su strada ha mostrato che Android emette il proprio tono di
 * attivazione a ogni `recognition.start()`. Con una sessione per comando quel
 * tono suonava a ogni frase, per tutto il viaggio. Nessun timer lo risolve:
 * il tono e' del sistema operativo e non e' sopprimibile.
 *
 * L'unica strada e' non riaprire. Questa versione prova a tenere viva UNA
 * sessione con `continuous = true`, consegnando piu' comandi dalla stessa,
 * senza chiuderla dopo ogni risultato e senza un timeout nostro.
 *
 * Se Chrome Android onora `continuous`, il tono suona una volta sola. Se non
 * lo onora, il riarmo controllato resta come rete di sicurezza e il
 * comportamento non peggiora rispetto a oggi. Lo dice il pannello
 * ?debugVoice=1, che numera le sessioni.
 *
 * RIARMO CONTROLLATO: ORA ECCEZIONALE, NON PIU' IL RITMO DEL SISTEMA
 * Chiusa la sessione, ROAD SENSE puo' riaprirne un'altra da solo: e' cio' che
 * permette di dire "buca", poi "ostacolo", poi "acqua" senza toccare il
 * telefono.
 *
 * La differenza con il ciclo che fece suonare il Fold ogni secondo e mezzo
 * non e' la durata dell'attesa: e' che ogni chiusura ha un MOTIVO, e il
 * motivo decide.
 *
 *   command   ha parlato e l'abbiamo capito -> si riapre subito
 *   silence   non ha detto niente -> si riapre piano, e solo per un numero
 *             CONTATO di volte. Poi si smette e serve un tocco
 *   error     si arretra; esauriti i tentativi il circuito resta aperto
 *   denied    permesso negato -> mai
 *   stopped   STOP -> mai, e nessun timer sopravvive
 *   speaking  sta parlando ROAD SENSE -> riapre `resume()`, non il motivo
 *
 * Un comando riuscito azzera i contatori: e' la conversazione che tiene vivo
 * l'ascolto, non un timer.
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

/**
 * Perche' una sessione si e' chiusa. Decide se e quando se ne apre un'altra.
 */
export type VoiceEndReason =
  /** Una frase e' stata riconosciuta e consegnata. */
  | 'command'
  /** Nessuna frase: timeout, `no-speech`, chiusura spontanea del browser. */
  | 'silence'
  /** Guasto tecnico recuperabile. */
  | 'error'
  /** Permesso negato o configurazione impossibile: non si insiste. */
  | 'denied'
  /** STOP esplicito. */
  | 'stopped'
  /** ROAD SENSE sta parlando. */
  | 'speaking';

export class BrowserVoiceProvider implements VoiceProvider {
  readonly id = 'browser-voice';
  readonly label = 'Riconoscimento del browser';

  private recognition: RecognitionLike | null = null;
  private handlers: VoiceHandlers = {};
  /** Una sessione e' aperta in questo momento. */
  private active = false;
  /**
   * Indice dell'ultimo risultato consegnato in QUESTA sessione.
   *
   * Con `continuous = true` i risultati si accumulano in `event.results` e
   * il browser puo' riconsegnare lo stesso indice piu' volte. Ricordare fino
   * a dove si e' arrivati e' cio' che rende «buca, ostacolo, acqua» tre
   * comandi e un risultato duplicato uno solo.
   */
  private lastDeliveredIndex = -1;
  /** Numero progressivo della sessione. Serve solo alla diagnosi. */
  private sessionNo = 0;
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
  /**
   * Modalita' mani libere attiva: le sessioni possono riaprirsi da sole.
   * La accende `start()`, la spegne `stop()` o il circuito aperto.
   */
  private armed = false;
  /** Sessioni chiuse nel silenzio, di seguito. Azzerato da un comando. */
  private silentCycles = 0;
  /** Errori consecutivi. Azzerato da un comando. */
  private errorCount = 0;
  private rearmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly allowRemote: boolean = false,
    private readonly env: VoiceEnvironment = browserVoiceEnvironment(),
  ) {}

  capabilities(): VoiceCapabilities {
    const ctor = this.env.ctor();
    if (!ctor) return { supported: false, onDevice: false };
    return { supported: true, onDevice: onDeviceState === 'si' };
  }

  /** true mentre una sessione e' effettivamente aperta. */
  isListening(): boolean {
    return this.active;
  }

  /**
   * true finche' l'ascolto mani libere e' attivo: sessione aperta, oppure
   * chiusa ma in attesa di riaprirsi. Serve a impedire che un tocco su VOCE
   * apra una seconda catena parallela.
   */
  isArmed(): boolean {
    return this.armed;
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

    this.armed = true;
    this.silentCycles = 0;
    this.errorCount = 0;
    this.active = true;
    this.open(ctor, caps.onDevice);
  }

  /** Chiude la sessione. Sicura anche se non ce n'e' una aperta. */
  stop(): void {
    // Disarmare PRIMA di chiudere: `closeSession` consulta `armed` per
    // decidere se riaprire, e uno STOP non deve poter riarmare nulla.
    this.armed = false;
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
    // Non disarma: la modalita' mani libere resta attiva, e' solo sospesa.
    // A riaprire sara' `resume()`, non il motivo di chiusura.
    this.clearTimer();
    this.closeSession('off', 'speaking');
  }

  /** ROAD SENSE ha finito di parlare: si torna in ascolto, con un margine. */
  resume(): void {
    if (!this.armed || this.active) return;
    this.scheduleRearm(VOICE.rearm.afterSpeechMs);
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
    this.lastDeliveredIndex = -1;
    this.sessionNo++;
    this.report({ session: this.sessionNo });
    this.mark(`S${this.sessionNo}`);

    recognition.lang = VOICE.lang;
    // ESPERIMENTO: si chiede al browser di tenere viva la sessione dopo il
    // primo risultato. E' l'unica configurazione che puo' evitare un tono di
    // Android per ogni comando. Su Chrome Android non e' garantita: il
    // pannello di diagnosi dira' se e' stata onorata.
    recognition.continuous = true;
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
    recognition.onspeechend = () => {
      if (!mine()) return;
      this.mark('speechend');
      this.phase('listening');
    };
    recognition.onsoundend = () => {
      if (mine()) this.mark('soundend');
    };
    recognition.onaudioend = () => {
      if (mine()) this.mark('audioend');
    };
    recognition.onnomatch = () => {
      if (mine()) this.mark('nomatch');
    };

    recognition.onresult = (event) => {
      if (!mine()) return;
      this.mark('result');

      for (let i = event.resultIndex; i < event.results.length; i++) {
        // Gia' consegnato: e' il browser che ripete, non chi guida.
        if (i <= this.lastDeliveredIndex) continue;
        const result = event.results[i];
        if (!result?.isFinal) continue;
        const transcript = result[0]?.transcript ?? '';
        if (transcript.trim().length === 0) continue;

        this.lastDeliveredIndex = i;
        // Un comando riuscito azzera i budget di recovery.
        this.silentCycles = 0;
        this.errorCount = 0;
        this.phase('result');
        this.report({ lastPhrase: transcript.trim() });

        // LA SESSIONE NON VIENE CHIUSA: e' il punto dell'esperimento.
        // Consegnare puo' pero' far parlare ROAD SENSE, e allora `pause()`
        // chiude la sessione da fuori: da quel momento i risultati
        // successivi non sono piu' nostri.
        this.handlers.onTranscript?.(transcript);
        if (!mine()) return;
      }

      // Consegnato tutto il consegnabile, si resta in ascolto.
      if (this.active) this.phase('listening');
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
      // Il browser ha chiuso. Se la sessione aveva consegnato comandi si
      // riapre subito - chi parlava probabilmente parlera' ancora; se era
      // muta, consuma il budget di silenzio.
      this.closeSession('off', this.lastDeliveredIndex >= 0 ? 'command' : 'silence');
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

    // ESPERIMENTO: nessun timeout nostro. Una sessione sana non va chiusa da
    // noi, perche' ogni chiusura costa un tono di Android alla riapertura.
    // A terminarla sara' il browser, quando decide lui.
  }

  private handleError(error: string): void {
    if (error === 'not-allowed') {
      this.report({ mic: 'negato' });
      this.closeSession('denied', 'denied');
      return;
    }
    // Motore locale chiesto ma non realmente disponibile: si annota e si
    // chiude, senza riprovare da soli.
    if (this.usingLocal && (error === 'language-not-supported' || error === 'service-not-allowed')) {
      onDeviceState = 'no';
      this.report({ local: 'no' });
      this.closeSession('off', 'denied');
      return;
    }
    if (error === 'service-not-allowed') {
      this.closeSession('denied', 'denied');
      return;
    }
    if (FATAL_ERRORS.has(error)) {
      this.closeSession('error', 'denied');
      return;
    }
    // "no-speech" e "aborted" non sono guasti: sono silenzio, e come tali
    // vanno contati. Gli altri errori sono guasti e fanno arretrare.
    this.closeSession('off', error === 'no-speech' || error === 'aborted' ? 'silence' : 'error');
  }

  // -- interni --------------------------------------------------------------

  /**
   * Chiude la sessione una volta sola, dichiara lo stato e decide se
   * riaprirla. Il MOTIVO e' l'unica cosa che governa quella decisione.
   */
  private closeSession(status: VoiceStatus, reason: VoiceEndReason): void {
    if (!this.active) return;
    this.active = false;
    this.clearTimer();
    this.release();
    this.phase(status === 'denied' || status === 'error' ? 'error' : 'idle');

    const attesa = this.rearmDelay(reason);
    if (attesa === null) {
      // Non si riapre: da qui in poi serve un tocco.
      if (reason !== 'speaking') this.armed = false;
      this.emit(status);
      return;
    }
    // Si riaprira': lo stato lo dice, invece di fingere ascolto o assenza.
    this.emit('restarting');
    this.scheduleRearm(attesa);
  }

  /**
   * Quanto attendere prima di riaprire, o `null` se non si riapre.
   *
   * E' il punto unico della politica di recovery: tenerla in una funzione
   * sola e' cio' che impedisce al vecchio ciclo di rientrare da una porta
   * laterale.
   */
  private rearmDelay(reason: VoiceEndReason): number | null {
    if (!this.armed) return null;

    switch (reason) {
      case 'command':
        // Ha appena parlato: probabilmente parlera' ancora.
        return VOICE.rearm.afterCommandMs;

      case 'silence': {
        // Il silenzio non tiene aperto il microfono all'infinito.
        if (this.silentCycles >= VOICE.rearm.maxSilentCycles) return null;
        this.silentCycles++;
        return VOICE.rearm.afterSilenceMs;
      }

      case 'error': {
        const backoff = VOICE.rearm.errorBackoffMs;
        // Circuito aperto: esauriti i tentativi non si insiste.
        if (this.errorCount >= backoff.length) return null;
        const attesa = backoff[this.errorCount] as number;
        this.errorCount++;
        return attesa;
      }

      // Sta parlando ROAD SENSE: riapre `resume()`, non questa funzione.
      case 'speaking':
        return null;

      case 'denied':
      case 'stopped':
        return null;
    }
  }

  /** Programma la riapertura. Un solo riarmo in volo per volta. */
  private scheduleRearm(delayMs: number): void {
    if (this.rearmTimer !== null) this.env.clearTimeout(this.rearmTimer);
    this.rearmTimer = this.env.setTimeout(() => {
      this.rearmTimer = null;
      // Fra la programmazione e lo scadere puo' essere arrivato uno STOP.
      if (!this.armed || this.active) return;
      const ctor = this.env.ctor();
      if (!ctor) return;
      this.active = true;
      this.open(ctor, this.capabilities().onDevice);
    }, delayMs);
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
    if (this.rearmTimer !== null) this.env.clearTimeout(this.rearmTimer);
    this.rearmTimer = null;
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
