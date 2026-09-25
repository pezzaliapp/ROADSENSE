/**
 * ROAD SENSE - riconoscimento vocale LOCALE, mani libere.
 *
 * Sostituisce `BrowserVoiceProvider` nel percorso di produzione e implementa lo
 * stesso contratto `VoiceProvider`: da fuori nulla cambia, e `parseVoiceReport`
 * riceve testo esattamente come prima.
 *
 * PERCHE' ESISTE, IN UNA RIGA PER FALLIMENTO
 *
 *   sessione per tocco       funzionava, ma non era mani libere.
 *   `continuous = true`      su Chrome per Android la proprieta' si puo'
 *                            impostare e NON HA EFFETTO (documentato in
 *                            browser-compat-data, crbug.com/41297427).
 *   VAD che apriva il
 *   riconoscitore di sistema i bip restavano: il tono lo emette Android a ogni
 *                            `start()`, e nessuna pagina web puo' spegnerlo.
 *
 * L'unica via era smettere di usare il riconoscimento del sistema. Qui non
 * esiste alcun `SpeechRecognition`: c'e' un microfono aperto una volta, un
 * buffer, un cancello di parola e un decoder Vosk in WebAssembly che gira nel
 * dispositivo. Per costruzione non c'e' nessun tono di attivazione da emettere.
 *
 * LE DUE IDEE CHE CONTANO
 *
 * 1. IL MICROFONO NON SI CHIUDE. Da `start()` a `stop()` una sola apertura.
 *    Fra la prima e la centesima parola non c'e' differenza di stato: nessun
 *    riarmo, nessun contatore di silenzio, nessun backoff.
 *
 * 2. IL DECODER RICEVE IL PASSATO. Quando il cancello si accorge che qualcuno
 *    sta parlando, l'inizio della parola e' gia' in memoria: il segmento parte
 *    da 400 ms PRIMA. E' la ragione per cui "buca" non diventa "uca", e nessun
 *    riconoscitore di sistema puo' farlo, perche' non puo' sentire il passato.
 *
 * NESSUNA USCITA AUDIO
 *
 * Del microfono non serve sentire niente. Dove il browser lo permette il
 * contesto viene messo in `silent` - elabora senza aprire alcuno stream di
 * riproduzione - cosi' non si contende la sessione audio con l'impianto
 * dell'auto ne' con la voce di ROAD SENSE. Dove non e' disponibile si ripiega
 * sul percorso a guadagno zero.
 */

import { VOICE } from '../../config/config';
import type {
  VoiceCapabilities,
  VoiceHandlers,
  VoiceProvider,
  VoiceStatus,
} from '../VoiceProvider';
import { MicSession, type OutputMode } from './micSession';
import { loadModelUrl, type ModelProgress } from './modelChunks';
import { RingBuffer } from './ringBuffer';
import { DEFAULT_GATE, SpeechGate } from './speechGate';
import { UtteranceCapture } from './utteranceCapture';
// SOLO IL TIPO: importare la classe qui trascinerebbe i 5,8 MB del decoder nel
// bundle di partenza dell'applicazione. `import type` viene cancellato alla
// compilazione e non produce alcuna dipendenza a runtime.
import type { LocalRecognizer } from './voskRecognizer';

/** Secondi di audio conservati: un enunciato dura molto meno. */
const RING_SECONDS = 3;
/** Audio consegnato prima dell'istante in cui la voce e' salita, ms. */
const PRE_ROLL_MS = 400;

export type VoiceModelPhase = 'assente' | 'scaricamento' | 'preparazione' | 'pronto' | 'errore';

export interface VoskVoiceHandlers extends VoiceHandlers {
  /** Avanzamento del primo scaricamento del modello. */
  onModelProgress?: (phase: VoiceModelPhase, progress: ModelProgress | null) => void;
}

export class VoskVoiceProvider implements VoiceProvider {
  readonly id = 'vosk-local-voice';
  readonly label = 'Riconoscimento locale (Vosk)';

  private readonly mic = new MicSession();
  /** Creato solo quando la voce viene attivata, insieme al decoder. */
  private recognizer: LocalRecognizer | null = null;
  private gate: SpeechGate | null = null;
  private capture: UtteranceCapture | null = null;
  private handlers: VoskVoiceHandlers = {};
  private armed = false;
  private sampleRate = DEFAULT_GATE.sampleRate;
  private modelUrl: string | null = null;
  private modelPhase: VoiceModelPhase = 'assente';
  /** ROAD SENSE sta parlando: il cancello non deve sentire la propria voce. */
  private speaking = false;

  capabilities(): VoiceCapabilities {
    const supported =
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof AudioContext !== 'undefined';
    // `onDevice: true` non e' un auspicio: il decoder E' nel dispositivo, e
    // nessun audio lascia il telefono. E' la prima volta che ROAD SENSE puo'
    // dirlo senza riserve.
    return { supported, onDevice: supported };
  }

  isListening(): boolean {
    return this.mic.isOpen() && (this.recognizer?.isReady() ?? false);
  }
  isArmed(): boolean {
    return this.armed;
  }
  /** Fase del modello, per l'interfaccia. */
  phase(): VoiceModelPhase {
    return this.modelPhase;
  }

  /**
   * Avvia l'ascolto.
   *
   * SINCRONA FINO A `getUserMedia`, di proposito: su Android il permesso viene
   * concesso solo se la chiamata avviene dentro l'attivazione del tocco. Il
   * modello si carica DOPO, perche' dura secondi e non puo' stare nel gesto.
   */
  start(handlers: VoskVoiceHandlers): void {
    if (this.armed) return;
    this.handlers = handlers;

    if (!this.capabilities().supported) {
      this.emit('unsupported');
      return;
    }
    this.armed = true;
    void this.run();
  }

  private async run(): Promise<void> {
    let info;
    try {
      info = await this.mic.open(
        {
          onFrame: (frame) => this.onFrame(frame),
          onContextState: (state) => {
            this.report({ phase: state === 'running' ? 'listening' : 'pausa' });
          },
          onTrackMuted: (muted) => {
            // Una telefonata sottrae il microfono: si dichiara, non si finge.
            this.emit(muted ? 'restarting' : 'listening');
          },
          onEnded: () => this.emit('error'),
        },
        'silent' satisfies OutputMode,
      );
    } catch (error) {
      this.armed = false;
      this.report({ mic: 'negato', lastError: messaggio(error) });
      this.emit('denied');
      return;
    }

    if (!this.armed) {
      // STOP arrivato mentre il permesso era in volo.
      await this.mic.close();
      return;
    }

    this.sampleRate = info.sampleRate;
    this.report({ mic: 'permesso', api: 'assente', local: 'si', remote: false });

    const config = { ...DEFAULT_GATE, sampleRate: info.sampleRate };
    this.gate = new SpeechGate(config);
    const ring = new RingBuffer(Math.round(info.sampleRate * RING_SECONDS));
    this.capture = new UtteranceCapture(
      ring,
      this.gate,
      {
        feed: (samples) => {
          if (!this.speaking) this.recognizer?.feed(samples, this.sampleRate);
        },
        flush: () => {
          if (!this.speaking) this.recognizer?.flush();
        },
      },
      info.sampleRate,
      PRE_ROLL_MS,
    );

    this.emit('restarting');
    await this.prepareModel(info.sampleRate);
  }

  private async prepareModel(sampleRate: number): Promise<void> {
    try {
      if (!this.modelUrl) {
        this.setModelPhase('scaricamento', { received: 0, total: 0, ratio: 0 });
        this.modelUrl = await loadModelUrl((p) => this.setModelPhase('scaricamento', p));
      }
      if (!this.armed) return;

      this.setModelPhase('preparazione', null);
      // Il decoder - 5,8 MB di WebAssembly - arriva ADESSO, non all'avvio
      // dell'applicazione: chi apre ROAD SENSE e non usa la voce non lo scarica.
      const { LocalRecognizer: Decoder } = await import('./voskRecognizer');
      if (!this.armed) return;
      this.recognizer = new Decoder();
      await this.recognizer.load(this.modelUrl, sampleRate, {
        onResult: (result) => this.onResult(result.text),
        onPartial: () => undefined,
        onError: (error) => this.report({ lastError: error }),
      });
      if (!this.armed) {
        this.recognizer?.release();
        return;
      }
      this.setModelPhase('pronto', null);
      this.report({ phase: 'listening' });
      this.emit('listening');
    } catch (error) {
      this.setModelPhase('errore', null);
      this.report({ lastError: messaggio(error), phase: 'error' });
      this.emit('error');
    }
  }

  private onFrame(frame: Float32Array): void {
    // Mentre ROAD SENSE parla il cancello non avanza affatto: cosi' la voce
    // sintetica non entra nel buffer e non puo' diventare una segnalazione.
    if (this.speaking) return;
    this.capture?.push(frame);
  }

  private onResult(text: string): void {
    const pulito = text.replace(/\[unk\]/g, '').replace(/\s+/g, ' ').trim();
    if (pulito.length === 0) return;
    this.report({ lastPhrase: pulito, phase: 'result' });
    // Da qui in poi e' il percorso di sempre: il testo va al parser, che
    // decide, e l'ascolto continua senza che nulla venga riaperto.
    this.handlers.onTranscript?.(pulito);
    this.report({ phase: 'listening' });
  }

  stop(): void {
    this.armed = false;
    this.speaking = false;
    void this.mic.close();
    this.recognizer?.release();
    this.recognizer = null;
    this.capture = null;
    this.gate = null;
    this.setModelPhase(this.modelUrl ? 'pronto' : 'assente', null);
    this.report({ phase: 'idle' });
    this.emit('off');
    this.handlers = {};
  }

  /**
   * ROAD SENSE sta per parlare.
   *
   * Il microfono NON si chiude: chiuderlo costerebbe una riapertura, ed e'
   * esattamente cio' che questa architettura ha eliminato. Si smette di
   * consegnare campioni, che ottiene lo stesso risultato - non sentirsi - senza
   * toccare il ciclo di vita.
   */
  pause(): void {
    this.speaking = true;
    this.gate?.reset();
    this.report({ phase: 'voce ROAD SENSE' });
  }

  resume(): void {
    this.speaking = false;
    // Il cancello ricomincia dalla calibrazione: dopo la voce sintetica il
    // fondo misurato non e' piu' quello dell'abitacolo.
    this.gate?.reset();
    if (this.armed && this.modelPhase === 'pronto') {
      this.report({ phase: 'listening' });
      this.emit('listening');
    }
  }

  private setModelPhase(phase: VoiceModelPhase, progress: ModelProgress | null): void {
    this.modelPhase = phase;
    this.handlers.onModelProgress?.(phase, progress);
  }

  private emit(status: VoiceStatus): void {
    this.handlers.onStatus?.(status);
  }

  private report(patch: Parameters<NonNullable<VoiceHandlers['onDiagnostics']>>[0]): void {
    this.handlers.onDiagnostics?.(patch);
  }
}

function messaggio(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Confidenza di una segnalazione vocale singola: la stessa di prima. */
export const VOICE_CONFIDENCE = VOICE.singleReportConfidence;
