/**
 * ROAD SENSE / LABORATORIO FASE 0 - proprietario unico del microfono.
 *
 * NON FA PARTE DELL'APPLICAZIONE. Nessun file di ROAD SENSE lo importa.
 *
 * UNA APERTURA, UNA CHIUSURA
 *
 * Il microfono si apre una volta sola, dentro il gesto che avvia il test, e
 * resta aperto fino a STOP. Non esiste alcun percorso che lo riapra: non ci
 * sono timer, contatori di cicli, backoff, riarmi. E' il punto dell'intero
 * prototipo, quindi il contatore `reopenings` esiste solo per poter mostrare
 * che resta a ZERO. Se cresce, l'esperimento e' da buttare.
 *
 * NIENTE `SpeechRecognition`
 *
 * Questa classe non nomina `SpeechRecognition` ne' `webkitSpeechRecognition`,
 * e nessun altro file del laboratorio lo fa. Non c'e' quindi alcuna sessione
 * di riconoscimento di sistema da aprire, e per costruzione nessun tono di
 * attivazione da emettere: il bip non viene attenuato o nascosto, non ha
 * nessun luogo da cui provenire. C'e' un test che lo verifica sul sorgente.
 *
 * RILASCIO VERO
 *
 * `close()` ferma il worklet, scollega i nodi, chiude l'AudioContext e ferma
 * OGNI traccia del MediaStream. L'indicatore di registrazione del sistema
 * operativo e' il giudice: se resta accesso dopo STOP, il rilascio non e'
 * avvenuto e va corretto.
 */

export interface MicSessionEvents {
  /** Blocco di campioni alla frequenza reale del contesto. */
  onFrame: (frame: Float32Array) => void;
  /** Cambio di stato osservabile dell'AudioContext. */
  onContextState: (state: string) => void;
  /**
   * Il microfono e' stato sottratto o restituito dal sistema.
   * Succede con una telefonata: la traccia viene messa in mute, non chiusa.
   */
  onTrackMuted: (muted: boolean) => void;
  onEnded: () => void;
}

export interface MicSessionInfo {
  sampleRate: number;
  contextState: string;
  trackLabel: string;
  /** Vincoli realmente concessi dal browser, non quelli richiesti. */
  settings: Record<string, unknown>;
}

const WORKLET_URL = '/lab/pcmTap.worklet.js';
/** Frequenza preferita: quella del modello. Il browser puo' rifiutarla. */
const PREFERRED_RATE = 16_000;

export class MicSession {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private tap: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private events: MicSessionEvents | null = null;
  private openings_ = 0;
  private openedAt_: number | null = null;

  /** Aperture del microfono da inizio pagina. Deve valere 1 per tutto il test. */
  openings(): number {
    return this.openings_;
  }
  /** Millisecondi di microfono attivo, o 0 se chiuso. */
  activeMs(): number {
    return this.openedAt_ === null ? 0 : Date.now() - this.openedAt_;
  }
  isOpen(): boolean {
    return this.stream !== null;
  }

  /**
   * Apre il microfono. DEVE essere chiamata dentro un gesto dell'utente:
   * su Android il permesso viene concesso solo in quella finestra.
   */
  async open(events: MicSessionEvents): Promise<MicSessionInfo> {
    if (this.stream) throw new Error('microfono gia aperto');
    this.events = events;

    // `echoCancellation` e `noiseSuppression` sono chiesti al browser, non
    // implementati da noi: in abitacolo servono, e l'elaborazione avviene
    // comunque sul dispositivo.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    this.stream = stream;
    this.openings_++;
    this.openedAt_ = Date.now();

    const track = stream.getAudioTracks()[0];
    if (track) {
      // Una telefonata mette la traccia in mute senza chiuderla: va dichiarato
      // invece di continuare a mostrare un ascolto che non avviene.
      track.onmute = () => this.events?.onTrackMuted(true);
      track.onunmute = () => this.events?.onTrackMuted(false);
      track.onended = () => this.events?.onEnded();
    }

    // Si chiede la frequenza del modello; se il browser impone la sua, si usa
    // quella e il riconoscitore verra' creato di conseguenza. Nessun
    // ricampionamento scritto a mano: sarebbe la prima fonte di aliasing, e
    // Kaldi sa ricampionare meglio di qualunque decimatore improvvisato.
    let context: AudioContext;
    try {
      context = new AudioContext({ sampleRate: PREFERRED_RATE });
    } catch {
      context = new AudioContext();
    }
    this.context = context;
    context.onstatechange = () => this.events?.onContextState(context.state);
    // Su iOS il contesto nasce sospeso finche' non lo si riprende dentro il gesto.
    if (context.state === 'suspended') await context.resume();

    await context.audioWorklet.addModule(WORKLET_URL);

    this.source = context.createMediaStreamSource(stream);
    this.tap = new AudioWorkletNode(context, 'pcm-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
      this.events?.onFrame(event.data);
    };

    // Uscita a guadagno ZERO verso l'altoparlante.
    // Non serve per sentire - sentirsi sarebbe un disastro, e' il microfono
    // dell'abitacolo - ma perche' un ramo del grafo che non arriva alla
    // destinazione puo' non essere elaborato affatto. Guadagno 0 significa
    // grafo vivo e nessun suono emesso.
    this.sink = context.createGain();
    this.sink.gain.value = 0;

    this.source.connect(this.tap);
    this.tap.connect(this.sink);
    this.sink.connect(context.destination);

    return {
      sampleRate: context.sampleRate,
      contextState: context.state,
      trackLabel: track?.label ?? 'sconosciuta',
      settings: (track?.getSettings?.() ?? {}) as Record<string, unknown>,
    };
  }

  /**
   * Rilascia tutto, nell'ordine in cui va rilasciato.
   * Prima si zittisce la presa, poi si scollega il grafo, poi si chiude il
   * contesto, per ultime si fermano le tracce: e' l'ordine che non lascia
   * richiami in volo su nodi gia' morti.
   */
  async close(): Promise<void> {
    if (this.tap) {
      this.tap.port.onmessage = null;
      try {
        this.tap.port.postMessage('stop');
      } catch {
        // Porta gia' chiusa: non e' un errore.
      }
    }
    for (const node of [this.source, this.tap, this.sink]) {
      try {
        node?.disconnect();
      } catch {
        // Gia' scollegato.
      }
    }
    this.source = null;
    this.tap = null;
    this.sink = null;

    const context = this.context;
    this.context = null;
    if (context) {
      context.onstatechange = null;
      try {
        await context.close();
      } catch {
        // Gia' chiuso.
      }
    }

    const stream = this.stream;
    this.stream = null;
    for (const track of stream?.getTracks() ?? []) {
      track.onmute = null;
      track.onunmute = null;
      track.onended = null;
      track.stop();
    }

    this.openedAt_ = null;
    this.events = null;
  }
}
