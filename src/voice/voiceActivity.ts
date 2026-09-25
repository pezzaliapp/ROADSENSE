/**
 * ROAD SENSE - rilevazione locale di attivita' vocale (VAD).
 *
 * ESPERIMENTO. Serve a rispondere a una domanda sola: si puo' tenere il
 * microfono come misuratore di energia e aprire `SpeechRecognition` soltanto
 * quando qualcuno parla davvero?
 *
 * PERCHE'
 * Android emette il proprio tono a ogni `recognition.start()`, e quel tono
 * non e' sopprimibile da una pagina web. Con l'apertura governata dal tempo
 * il tono segue il tempo: suona anche nel silenzio piu' totale. Con
 * l'apertura governata dalla voce, i toni diventano quanti sono i comandi.
 *
 * `getUserMedia` NON emette alcun tono: il tono appartiene al servizio di
 * riconoscimento, non al microfono.
 *
 * COSA LEGGE, E COSA NO
 * Legge un livello di energia (RMS) del segnale. Nient'altro. Non registra,
 * non conserva, non trasmette, non riconosce parole. La distinzione che fa e'
 * una sola: silenzio oppure attivita'.
 *
 * COSA DICHIARA
 * Mentre e' armato il microfono resta APERTO, e Android mostra il proprio
 * indicatore di registrazione. E' una scelta esplicita di questo esperimento,
 * non un effetto collaterale.
 *
 * NESSUN RIARMO A TEMPO
 * Il VAD non riapre mai il riconoscitore da solo: lo fa solo quando misura
 * attivita'. Durante il silenzio il numero di `recognition.start()` resta
 * fermo, ed e' esattamente cio' che l'esperimento deve dimostrare.
 */

import { VOICE } from '../config/config';

/**
 *   off        non attivo, microfono chiuso
 *   armed      microfono aperto, in ascolto del LIVELLO, nessun riconoscitore
 *   triggered  attivita' rilevata: il riconoscitore e' aperto, il VAD tace
 *   suspended  sospeso perche' ROAD SENSE sta parlando
 */
export type VadState = 'off' | 'armed' | 'triggered' | 'suspended';

/** Sorgente del livello audio. Chiuderla rilascia microfono e contesto. */
export interface VadSource {
  /** Livello RMS corrente, 0..1. */
  level: () => number;
  /** Rilascia tracce microfono e AudioContext. Idempotente. */
  close: () => void;
}

export interface VadEnvironment {
  /** Apre il microfono. `null` se non disponibile o negato. */
  open: () => Promise<VadSource | null>;
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (handle: ReturnType<typeof setInterval>) => void;
}

export interface VadHandlers {
  /** Attivita' vocale rilevata. Chiamata UNA volta per attivazione. */
  onVoice?: () => void;
  onState?: (state: VadState) => void;
  /** Livello e fondo correnti, per la diagnosi. Mai un contenuto. */
  onLevel?: (level: number, floor: number) => void;
}

export class VoiceActivityDetector {
  private source: VadSource | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private handlers: VadHandlers = {};
  private state_: VadState = 'off';
  /** Stima del rumore di fondo dell'abitacolo. */
  private floor: number = VOICE.vad.initialFloor;
  /** Da quanti campioni consecutivi il segnale supera la soglia. */
  private above = 0;
  /** Quante volte il VAD ha rilevato voce da quando e' partito. */
  private triggers_ = 0;
  /**
   * Generazione: ogni `release()` la incrementa. Un'apertura del microfono
   * che arriva dopo uno STOP non deve armare nulla ne' lasciare tracce vive.
   */
  private generation = 0;

  constructor(private readonly env: VadEnvironment = browserVadEnvironment()) {}

  state(): VadState {
    return this.state_;
  }

  triggers(): number {
    return this.triggers_;
  }

  /** Apre il microfono e comincia a misurare. Non solleva mai. */
  async start(handlers: VadHandlers): Promise<boolean> {
    if (this.state_ !== 'off') return true;
    this.handlers = handlers;
    this.floor = VOICE.vad.initialFloor;
    this.above = 0;
    this.triggers_ = 0;

    const gen = this.generation;
    let source: VadSource | null = null;
    try {
      source = await this.env.open();
    } catch {
      source = null;
    }
    // Uno STOP arrivato mentre il microfono si apriva: si richiude subito.
    if (gen !== this.generation) {
      source?.close();
      return false;
    }
    if (!source) {
      this.setState('off');
      return false;
    }

    this.source = source;
    this.setState('armed');
    this.timer = this.env.setInterval(() => this.tick(), VOICE.vad.pollMs);
    return true;
  }

  /**
   * La sessione di riconoscimento e' finita: si torna a misurare.
   * NON apre nulla: per un altro `recognition.start()` servira' nuova voce.
   */
  rearm(): void {
    if (this.state_ !== 'triggered') return;
    this.above = 0;
    this.setState('armed');
  }

  /** ROAD SENSE sta per parlare: il VAD non deve sentire la propria voce. */
  suspend(): void {
    if (this.state_ === 'off') return;
    this.above = 0;
    this.setState('suspended');
  }

  /** ROAD SENSE ha finito di parlare. */
  resume(): void {
    if (this.state_ !== 'suspended') return;
    this.above = 0;
    this.setState('armed');
  }

  /**
   * STOP: rilascia davvero il microfono e il contesto audio, cancella il
   * timer e impedisce qualsiasi riapertura.
   */
  release(): void {
    this.generation++;
    if (this.timer !== null) this.env.clearInterval(this.timer);
    this.timer = null;
    const source = this.source;
    this.source = null;
    source?.close();
    this.setState('off');
    this.handlers = {};
  }

  // -- interni --------------------------------------------------------------

  private tick(): void {
    const source = this.source;
    if (!source) return;

    let level = 0;
    try {
      level = source.level();
    } catch {
      return;
    }
    if (!Number.isFinite(level)) return;
    this.handlers.onLevel?.(level, this.floor);

    // Il riconoscitore e' aperto, oppure ROAD SENSE sta parlando: si continua
    // a misurare - serve alla diagnosi - ma non si scatta.
    if (this.state_ !== 'armed') return;

    const soglia = Math.max(this.floor * VOICE.vad.triggerRatio, VOICE.vad.minLevel);

    if (level > soglia) {
      this.above += VOICE.vad.pollMs;
      // Un rumore breve non e' una frase: deve durare.
      if (this.above >= VOICE.vad.sustainMs) {
        this.above = 0;
        this.triggers_++;
        // Da qui il VAD tace: un solo riconoscitore per volta, e nessun
        // secondo scatto finche' quella sessione non e' finita.
        this.setState('triggered');
        this.handlers.onVoice?.();
      }
      return;
    }

    this.above = 0;
    // Il fondo si aggiorna SOLO nel silenzio: altrimenti una frase lunga
    // alzerebbe la propria soglia e si auto-zittirebbe.
    this.floor = this.floor * (1 - VOICE.vad.floorAlpha) + level * VOICE.vad.floorAlpha;
  }

  private setState(state: VadState): void {
    if (this.state_ === state) return;
    this.state_ = state;
    this.handlers.onState?.(state);
  }
}

/**
 * Ambiente reale: microfono e analizzatore del browser.
 *
 * Non registra e non trattiene: `AnalyserNode` espone una finestra corrente
 * del segnale, che viene letta e scartata a ogni campionamento.
 */
export function browserVadEnvironment(): VadEnvironment {
  return {
    open: async () => {
      const media =
        typeof navigator === 'undefined'
          ? undefined
          : (navigator.mediaDevices as
              | { getUserMedia?: (c: { audio: boolean }) => Promise<MediaStream> }
              | undefined);
      if (typeof media?.getUserMedia !== 'function') return null;

      const Ctx =
        typeof window === 'undefined'
          ? undefined
          : (window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext);
      if (!Ctx) return null;

      const stream = await media.getUserMedia({ audio: true });
      let context: AudioContext;
      try {
        context = new Ctx();
      } catch {
        for (const track of stream.getTracks()) track.stop();
        return null;
      }
      // Su alcuni browser il contesto nasce sospeso: va ripreso, ed essendo
      // nato da un tocco l'operazione e' consentita.
      void context.resume().catch(() => undefined);

      const node = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      node.connect(analyser);
      const buffer = new Uint8Array(analyser.fftSize);

      return {
        level: () => {
          analyser.getByteTimeDomainData(buffer);
          let somma = 0;
          for (const campione of buffer) {
            const x = (campione - 128) / 128;
            somma += x * x;
          }
          return Math.sqrt(somma / buffer.length);
        },
        close: () => {
          try {
            node.disconnect();
          } catch {
            /* gia' scollegato */
          }
          try {
            void context.close();
          } catch {
            /* gia' chiuso */
          }
          for (const track of stream.getTracks()) track.stop();
        },
      };
    },
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle),
  };
}
