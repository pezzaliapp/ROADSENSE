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

/**
 * Dove finisce il segnale dopo essere stato letto.
 *
 * LA DOMANDA NASCE DA UN BIP MISURATO SUL FOLD
 *
 * Il percorso originale era `sorgente -> presa -> guadagno 0 -> destinazione`.
 * Il guadagno a zero rende muto il segnale, ma la DESTINAZIONE resta
 * collegata, e questo tiene aperto uno stream di USCITA sull'audio di Android -
 * per giunta a 16 kHz, che non e' la frequenza nativa del dispositivo.
 *
 * Finche' Vosk non partiva davvero quel percorso non dava fastidio. Nella prima
 * esecuzione in cui il decoder ha lavorato sul serio - decompressione di 48 MB,
 * costruzione degli FST, decodifica - e' comparso un bip periodico. Non e'
 * dimostrato che la causa sia questa: e' l'ipotesi con piu' indizi, e questi
 * tre modi esistono per DIMOSTRARLA sul telefono invece di darla per buona.
 *
 *   silent     si elabora senza alcun dispositivo di uscita
 *              (`setSinkId({type:'none'})`, documentato proprio per non
 *              riprodurre quando serve solo elaborare). E' cio' che vogliamo:
 *              del microfono non ci interessa sentire niente.
 *   speaker    il percorso precedente, guadagno 0 verso la destinazione.
 *              Resta per poter confrontare.
 *   detached   nessun collegamento alla destinazione. Serve a rispondere a una
 *              domanda precisa: l'AudioWorklet resta vivo lo stesso? Il
 *              contatore dei blocchi ricevuti lo dira'.
 */
export type OutputMode = 'silent' | 'speaker' | 'detached';

export interface MicSessionInfo {
  sampleRate: number;
  contextState: string;
  trackLabel: string;
  /** Vincoli realmente concessi dal browser, non quelli richiesti. */
  settings: Record<string, unknown>;
  /** Modalita' REALMENTE ottenuta, che puo' differire da quella richiesta. */
  output: OutputMode;
  /** Perche' la modalita' richiesta non e' stata ottenuta, se e' successo. */
  outputNote: string | null;
}

/** Contesto audio con l'API di scelta dell'uscita, dove il browser la espone. */
interface ContextWithSink {
  setSinkId?: (sink: { type: 'none' } | string) => Promise<void>;
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
  async open(events: MicSessionEvents, output: OutputMode = 'silent'): Promise<MicSessionInfo> {
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

    // Uscita: si prova a NON avere alcun dispositivo di riproduzione.
    let ottenuta: OutputMode = output;
    let nota: string | null = null;
    if (output === 'silent') {
      const conSink = context as unknown as ContextWithSink;
      if (typeof conSink.setSinkId !== 'function') {
        ottenuta = 'speaker';
        nota = 'setSinkId non disponibile su questo browser';
      } else {
        try {
          await conSink.setSinkId({ type: 'none' });
        } catch (error) {
          ottenuta = 'speaker';
          nota = error instanceof Error ? error.message : String(error);
        }
      }
    }

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

    this.source.connect(this.tap);

    // Il collegamento alla destinazione serve a tenere il grafo "tirato": un
    // ramo che non la raggiunge puo' non essere elaborato affatto. Il guadagno
    // resta a ZERO in ogni caso - sentire il microfono dell'abitacolo sarebbe
    // un disastro - ma con `silent` la destinazione non ha piu' dietro di se'
    // alcun dispositivo, quindi non c'e' nessuno stream di uscita da tenere
    // aperto. In `detached` non si collega nulla, ed e' la prova che dira' se
    // quel collegamento fosse davvero necessario.
    if (ottenuta !== 'detached') {
      this.sink = context.createGain();
      this.sink.gain.value = 0;
      this.tap.connect(this.sink);
      this.sink.connect(context.destination);
    }

    return {
      sampleRate: context.sampleRate,
      contextState: context.state,
      trackLabel: track?.label ?? 'sconosciuta',
      settings: (track?.getSettings?.() ?? {}) as Record<string, unknown>,
      output: ottenuta,
      outputNote: nota,
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
