/**
 * ROAD SENSE / LABORATORIO FASE 0 - decoder locale.
 *
 * NON FA PARTE DELL'APPLICAZIONE. Nessun file di ROAD SENSE lo importa.
 *
 * DOVE AVVIENE IL RICONOSCIMENTO
 *
 * Nel dispositivo. `vosk-browser` (Apache-2.0) e' una compilazione in
 * WebAssembly di Vosk/Kaldi che gira in un Web Worker generato dal pacchetto
 * stesso. Il modello acustico viene caricato una volta e poi resta in memoria.
 *
 * Nessuna rete durante il riconoscimento. Nessun `SpeechRecognition`. Nessun
 * servizio, nessuna chiave, nessun backend, nessun audio che esce dal
 * telefono. La sola richiesta di rete dell'intero prototipo e' il download
 * iniziale del modello, che non contiene voce: e' il modello a venire verso di
 * noi, non la voce ad andare altrove.
 *
 * VERIFICATO PRIMA DI SCRIVERE QUESTO FILE
 *   - licenza pacchetto Apache-2.0, licenza modello italiano Apache-2.0;
 *   - NESSUN riferimento a `SharedArrayBuffer` e NESSUN pthread nel codice
 *     distribuito: il worker e' a thread singolo, quindi NON servono gli
 *     header COOP/COEP. E' la ragione per cui la mappa non corre rischi:
 *     nessun header dell'origine va toccato;
 *   - il worker e' incorporato in base64 nel pacchetto, quindi non c'e' alcun
 *     file aggiuntivo da servire e nessuna risoluzione di worker da configurare;
 *   - `new Recognizer(model, sampleRate, grammar)`: il riconoscitore si crea
 *     alla frequenza REALE del contesto audio e Kaldi ricampiona al suo
 *     interno. Non scriviamo decimatori: sarebbero la prima fonte di aliasing.
 *
 * GRAMMATICA
 *
 * Il modello piccolo italiano ha un tasso d'errore intorno al 17% in dettatura
 * libera, che per una frase qualunque e' molto, ma qui non si detta: si parla
 * della strada. Vincolare l'uscita al vocabolario di ROAD SENSE cambia
 * completamente il problema.
 *
 * L'elenco NON e' scritto a mano: `grammar.ts` lo deriva dal lessico del parser
 * e lo filtra sul vocabolario reale del modello. Prima erano due elenchi
 * indipendenti, e divergevano: il parser conosceva 39 pericoli, la grammatica
 * ne ammetteva quattro, e le altre trentacinque categorie erano codice che
 * nessuna voce poteva raggiungere.
 *
 * `[unk]` e' il punto meno ovvio e il piu' importante: senza di lui il decoder
 * e' OBBLIGATO a scegliere la meno improbabile fra le parole note, anche
 * davanti a un colpo di tosse o alla radio. Con `[unk]` gli si concede di dire
 * "non era nessuna di queste", che e' la risposta giusta per quasi tutto cio'
 * che accade in un abitacolo.
 */

import { Model, type KaldiRecognizer } from 'vosk-browser';

import { VOICE_GRAMMAR as GRAMMATICA } from './grammar';

export { VOICE_GRAMMAR } from './grammar';

export interface WordScore {
  word: string;
  conf: number;
  start: number;
  end: number;
}

export interface LabResult {
  text: string;
  words: WordScore[];
  /** Confidenza minima fra le parole riconosciute: la piu' debole decide. */
  confidence: number | null;
}

interface VoskResultMessage {
  event: 'result';
  result: { text?: string; result?: WordScore[] };
}
interface VoskPartialMessage {
  event: 'partialresult';
  result: { partial?: string };
}
interface VoskErrorMessage {
  event: 'error';
  error: string;
}
type VoskMessage = VoskResultMessage | VoskPartialMessage | VoskErrorMessage;

export type ModelPhase = 'assente' | 'caricamento' | 'pronto' | 'errore';

export interface RecognizerHandlers {
  onResult: (result: LabResult) => void;
  onPartial: (text: string) => void;
  onError: (message: string) => void;
}

/**
 * Oggetto minimo che serve a questa classe: il modello di vosk-browser.
 * Esiste come tipo a se' per poter iniettare un finto e verificare i percorsi
 * di FALLIMENTO, che sono quelli che ci hanno fatto perdere un test su strada.
 */
export interface ModelLike {
  on: (event: 'load' | 'error', listener: (message: unknown) => void) => void;
  terminate: () => void;
  KaldiRecognizer: new (sampleRate: number, grammar?: string) => KaldiRecognizer;
}

export type ModelFactory = (url: string) => ModelLike;

const defaultModelFactory: ModelFactory = (url) => new Model(url) as unknown as ModelLike;

/**
 * Oltre questo tempo senza NESSUNA risposta dal worker si dichiara errore.
 *
 * Generoso di proposito: il modello pesa una cinquantina di megabyte, e su una
 * rete mobile lenta un caricamento legittimo puo' durare minuti. Non e' un
 * limite di prestazione, e' una rete di sicurezza per il caso in cui il worker
 * non risponda affatto - un download che si pianta a meta' senza fallire.
 *
 * NON e' la correzione del difetto: quella e' ascoltare l'evento `error`.
 * Un timeout da solo avrebbe nascosto un errore gia' disponibile.
 */
const LOAD_TIMEOUT_MS = 300_000;

/**
 * Contatori di cio' che il decoder ha REALMENTE fatto.
 *
 * Servono a una domanda sola: il bip periodico comparso sul Fold coincide con
 * qualche operazione che si ripete? Se questi numeri restano fermi mentre il
 * bip continua, il decoder e' scagionato - che e' un risultato, non un
 * fallimento.
 *
 * Si contano eventi che accadono comunque. Nessun timer, nessuna interrogazione
 * periodica, nessun tentativo aggiuntivo: la telemetria osserva e tace.
 */
export interface RecognizerStats {
  /** Quante volte e' stato chiesto un caricamento. Il primo non e' un ritentativo. */
  loadCalls: number;
  /** Worker creati: uno per tentativo di caricamento. */
  workerCreates: number;
  /** Modelli portati a termine con successo. */
  modelLoads: number;
  /** Riconoscitori costruiti. */
  recognizerCreates: number;
  /** `retrieveFinalResult`: una per enunciato concluso. */
  flushes: number;
  /** Blocchi di campioni consegnati al decoder. */
  feeds: number;
  /** Campioni totali consegnati. */
  samplesFed: number;
  /** Errori riferiti dal worker, a livello di modello o di riconoscitore. */
  errors: number;
  /** Caricamenti oltre il primo. Il codice non ritenta da solo: deve restare 0. */
  retries: number;
  /** Worker terminati, per rilascio o per fallimento. */
  terminations: number;
  /** Risultati e parziali ricevuti. */
  results: number;
  partials: number;
}

export class LocalRecognizer {
  private model: ModelLike | null = null;
  private recognizer: KaldiRecognizer | null = null;
  private phase_: ModelPhase = 'assente';
  private handlers: RecognizerHandlers | null = null;
  private loadMs_ = 0;
  private lastError_: string | null = null;
  private stats_: RecognizerStats = {
    loadCalls: 0,
    workerCreates: 0,
    modelLoads: 0,
    recognizerCreates: 0,
    flushes: 0,
    feeds: 0,
    samplesFed: 0,
    errors: 0,
    retries: 0,
    terminations: 0,
    results: 0,
    partials: 0,
  };

  constructor(
    private readonly createModelFor: ModelFactory = defaultModelFactory,
    private readonly timeoutMs: number = LOAD_TIMEOUT_MS,
  ) {}

  phase(): ModelPhase {
    return this.phase_;
  }
  /** Copia dei contatori, per l'interfaccia diagnostica. */
  stats(): RecognizerStats {
    return { ...this.stats_ };
  }
  /** Motivo dell'ultimo fallimento, da mostrare invece di un'attesa muta. */
  lastError(): string | null {
    return this.lastError_;
  }
  /** Quanto e' durato il caricamento del modello, ms. Da misurare sul telefono. */
  loadMs(): number {
    return this.loadMs_;
  }
  isReady(): boolean {
    return this.phase_ === 'pronto' && this.recognizer !== null;
  }

  /**
   * Apre il modello, concludendo su OGNI esito.
   *
   * PERCHE' NON SI USA `createModel()` DI vosk-browser
   *
   * La sua implementazione e':
   *
   *   new Promise((resolve, reject) =>
   *     model.on("load", (m) => { if (m.result) { resolve(model); } reject(); }))
   *
   * si iscrive SOLO all'evento `load`. Ma il worker, quando il caricamento
   * fallisce, emette `error` e non emette mai `load`:
   *
   *   this.load(modelUrl)
   *     .then((result) => ctx.postMessage({ event: "load", result }))
   *     .catch((error) => ctx.postMessage({ event: "error", error: error.message }))
   *
   * Quella Promise quindi non si risolve E non si rifiuta: resta pendente per
   * sempre. E' cio' che sul Samsung ha lasciato "CARICAMENTO..." all'infinito
   * davanti a un banale 404: il worker aveva segnalato l'errore, ma nessuno
   * era in ascolto su quell'evento.
   *
   * Qui ci si iscrive a entrambi gli eventi e si aggiunge un limite di tempo,
   * cosi' che ogni esito possibile - riuscita, errore dichiarato, rifiuto
   * silenzioso, nessuna risposta - diventi uno stato visibile.
   */
  private openModel(url: string): Promise<ModelLike> {
    return new Promise<ModelLike>((resolve, reject) => {
      let model: ModelLike;
      try {
        model = this.createModelFor(url);
        this.stats_.workerCreates++;
      } catch (error) {
        reject(asError(error));
        return;
      }

      let concluso = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finire = (esito: () => void): void => {
        if (concluso) return;
        concluso = true;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        esito();
      };

      // Un caricamento fallito lasciava vivo il Worker e il suo modello a
      // meta': si chiude sempre prima di rifiutare.
      const fallire = (message: string): void =>
        finire(() => {
          try {
            model.terminate();
            this.stats_.terminations++;
          } catch {
            // Gia' terminato.
          }
          reject(new Error(message));
        });

      model.on('load', (message) => {
        const risultato = (message as { result?: boolean } | undefined)?.result;
        if (risultato) finire(() => resolve(model));
        // `result: false` significa rifiuto esplicito del worker: e' un errore
        // dichiarato, non un'attesa.
        else fallire('il worker ha rifiutato il modello (load con result: false)');
      });

      model.on('error', (message) => {
        this.stats_.errors++;
        const testo = (message as { error?: string } | undefined)?.error;
        fallire(testo && testo.length > 0 ? testo : 'errore non specificato dal decoder');
      });

      timer = setTimeout(
        () => fallire(`nessuna risposta dal decoder dopo ${Math.round(this.timeoutMs / 1000)} s`),
        this.timeoutMs,
      );
    });
  }

  /**
   * Carica il modello e crea il riconoscitore.
   *
   * Lento la prima volta - sono decine di megabyte da scaricare, scompattare e
   * mettere in memoria - e per questo va fatto PRIMA di partire, non alla prima
   * parola. Il prototipo lo mostra con uno stato dedicato invece di sembrare
   * bloccato.
   */
  async load(modelUrl: string, sampleRate: number, handlers: RecognizerHandlers): Promise<void> {
    if (this.phase_ === 'caricamento') throw new Error('caricamento gia in corso');
    this.handlers = handlers;
    this.phase_ = 'caricamento';
    this.lastError_ = null;
    this.stats_.loadCalls++;
    // Il primo caricamento non e' un ritentativo. Questo contatore deve
    // restare a zero: il codice non riprova da solo, e se crescesse vorrebbe
    // dire che qualcuno lo sta facendo al posto suo.
    this.stats_.retries = Math.max(0, this.stats_.loadCalls - 1);
    const iniziato = Date.now();

    try {
      const model = await this.openModel(modelUrl);
      this.model = model;

      this.stats_.modelLoads++;

      const recognizer = new model.KaldiRecognizer(sampleRate, JSON.stringify(GRAMMATICA));
      this.stats_.recognizerCreates++;
      // Necessario per ottenere la confidenza parola per parola: senza questo
      // arriva solo il testo, e non si potrebbe distinguere un riconoscimento
      // sicuro da uno tirato per i capelli.
      recognizer.setWords(true);

      recognizer.on('result', (message) => {
        const m = message as unknown as VoskMessage;
        if (m.event !== 'result') return;
        this.stats_.results++;
        const words = m.result.result ?? [];
        const text = (m.result.text ?? '').trim();
        this.handlers?.onResult({
          text,
          words,
          confidence: words.length === 0 ? null : Math.min(...words.map((w) => w.conf)),
        });
      });
      recognizer.on('partialresult', (message) => {
        const m = message as unknown as VoskMessage;
        if (m.event !== 'partialresult') return;
        this.stats_.partials++;
        this.handlers?.onPartial((m.result.partial ?? '').trim());
      });
      recognizer.on('error', (message) => {
        const m = message as unknown as VoskMessage;
        if (m.event !== 'error') return;
        this.stats_.errors++;
        this.handlers?.onError(m.error);
      });

      this.recognizer = recognizer;
      this.loadMs_ = Date.now() - iniziato;
      this.phase_ = 'pronto';
    } catch (error) {
      const guasto = asError(error);
      this.phase_ = 'errore';
      this.lastError_ = guasto.message;
      this.loadMs_ = Date.now() - iniziato;
      // Il modello non e' utilizzabile: non va lasciato a mezza strada.
      this.model = null;
      this.recognizer = null;
      throw guasto;
    }
  }

  /**
   * Consegna campioni al decoder.
   *
   * Viene chiamata SOLO mentre il cancello dichiara parlato: nel silenzio il
   * decoder non riceve niente e non consuma niente. E' la ragione per cui il
   * costo in batteria resta legato a quanto si parla e non a quanto si guida.
   */
  feed(samples: Float32Array, sampleRate: number): void {
    if (!this.recognizer || samples.length === 0) return;
    this.stats_.feeds++;
    this.stats_.samplesFed += samples.length;
    this.recognizer.acceptWaveformFloat(samples, sampleRate);
  }

  /** Chiude l'enunciato e chiede il risultato definitivo. */
  flush(): void {
    if (!this.recognizer) return;
    this.stats_.flushes++;
    this.recognizer.retrieveFinalResult();
  }

  /** Rilascio completo: riconoscitore, modello e il worker che lo ospita. */
  release(): void {
    try {
      this.recognizer?.remove();
    } catch {
      // Gia' rimosso.
    }
    this.recognizer = null;
    try {
      if (this.model) {
        this.model.terminate();
        this.stats_.terminations++;
      }
    } catch {
      // Gia' terminato.
    }
    this.model = null;
    this.handlers = null;
    this.phase_ = 'assente';
  }
}

/** Normalizza qualunque valore lanciato in un Error con un messaggio leggibile. */
function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error.length > 0) return new Error(error);
  // `createModel` rifiutava con `undefined`: un messaggio vuoto e' peggio di
  // nessun messaggio, perche' sembra un guasto senza causa.
  return new Error('fallimento senza dettagli dal decoder');
}
