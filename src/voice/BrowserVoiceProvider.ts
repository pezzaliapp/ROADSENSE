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
 *   1. chiede `processLocally` dove il browser lo offre (Chrome recente);
 *   2. dichiara nelle capacita' se l'elaborazione sara' locale o remota;
 *   3. lascia la voce SPENTA finche' non viene attivata esplicitamente.
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
  VoiceCapabilities,
  VoiceHandlers,
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
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** L'elaborazione locale e' offerta dal browser? */
function supportsOnDevice(ctor: RecognitionCtor): boolean {
  try {
    return 'processLocally' in ctor.prototype;
  } catch {
    return false;
  }
}

export class BrowserVoiceProvider implements VoiceProvider {
  readonly id = 'browser-voice';
  readonly label = 'Riconoscimento del browser';

  private recognition: RecognitionLike | null = null;
  private handlers: VoiceHandlers = {};
  private active = false;
  private failures = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param allowRemote consenso esplicito a far elaborare l'audio da un
   * servizio remoto, quando l'elaborazione locale non e' disponibile.
   */
  constructor(private readonly allowRemote: boolean = false) {}

  capabilities(): VoiceCapabilities {
    const ctor = recognitionCtor();
    if (!ctor) return { supported: false, onDevice: false };
    return { supported: true, onDevice: supportsOnDevice(ctor) };
  }

  start(handlers: VoiceHandlers): void {
    this.handlers = handlers;
    const ctor = recognitionCtor();
    if (!ctor) {
      this.emit('unsupported');
      return;
    }
    const caps = this.capabilities();
    // Nessuna elaborazione locale e nessun consenso all'invio dell'audio:
    // non si parte. Meglio nessuna voce che una promessa di privacy tradita.
    if (!caps.onDevice && !this.allowRemote) {
      this.emit('off');
      return;
    }

    this.active = true;
    this.failures = 0;
    this.launch(ctor, caps.onDevice);
  }

  stop(): void {
    this.active = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onstart = null;
      try {
        recognition.abort();
      } catch {
        // Gia' chiuso: non e' un errore.
      }
    }
    this.handlers = {};
  }

  // -- interni --------------------------------------------------------------

  private launch(ctor: RecognitionCtor, onDevice: boolean): void {
    let recognition: RecognitionLike;
    try {
      recognition = new ctor();
    } catch {
      this.emit('error');
      return;
    }

    recognition.lang = VOICE.lang;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    if (onDevice) recognition.processLocally = true;

    recognition.onstart = () => {
      this.failures = 0;
      this.emit('listening');
    };

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result?.isFinal) continue;
        const transcript = result[0]?.transcript ?? '';
        if (transcript.trim().length > 0) this.handlers.onTranscript?.(transcript);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.active = false;
        this.emit('denied');
        return;
      }
      // "no-speech" e "aborted" sono normali in auto: non sono guasti.
      if (event.error !== 'no-speech' && event.error !== 'aborted') this.failures++;
    };

    recognition.onend = () => {
      if (!this.active) return;
      if (this.failures >= VOICE.maxRestartFailures) {
        this.emit('error');
        this.active = false;
        return;
      }
      // Il riconoscimento continuo si chiude da solo: riavviarlo e' l'unico
      // modo per tenere il microfono utilizzabile lungo un viaggio.
      this.emit('restarting');
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
    try {
      recognition.start();
    } catch {
      this.emit('error');
    }
  }

  private emit(status: VoiceStatus): void {
    this.handlers.onStatus?.(status);
  }
}
