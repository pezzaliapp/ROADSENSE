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
 * libera, che per una frase qualunque e' molto, ma qui non si detta: si
 * pronuncia una parola fra quattro. Vincolare l'uscita a quelle quattro piu'
 * `[unk]` cambia completamente il problema.
 *
 * `[unk]` e' il punto meno ovvio e il piu' importante: senza di lui il decoder
 * e' OBBLIGATO a scegliere la meno improbabile fra le quattro parole, anche
 * davanti a un colpo di tosse o alla radio. Con `[unk]` gli si concede di dire
 * "non era nessuna delle quattro", che e' la risposta giusta per quasi tutto
 * cio' che accade in un abitacolo.
 */

import { Model, type KaldiRecognizer } from 'vosk-browser';

/** Le quattro parole del test, piu' la via d'uscita. */
export const LAB_GRAMMAR: readonly string[] = ['buca', 'ostacolo', 'acqua', 'incidente', '[unk]'];

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

export class LocalRecognizer {
  private model: ModelLike | null = null;
  private recognizer: KaldiRecognizer | null = null;
  private phase_: ModelPhase = 'assente';
  private handlers: RecognizerHandlers | null = null;
  private loadMs_ = 0;
  private lastError_: string | null = null;

  constructor(
    private readonly createModelFor: ModelFactory = defaultModelFactory,
    private readonly timeoutMs: number = LOAD_TIMEOUT_MS,
  ) {}

  phase(): ModelPhase {
    return this.phase_;
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
    const iniziato = Date.now();

    try {
      const model = await this.openModel(modelUrl);
      this.model = model;

      const recognizer = new model.KaldiRecognizer(sampleRate, JSON.stringify(LAB_GRAMMAR));
      // Necessario per ottenere la confidenza parola per parola: senza questo
      // arriva solo il testo, e non si potrebbe distinguere un riconoscimento
      // sicuro da uno tirato per i capelli.
      recognizer.setWords(true);

      recognizer.on('result', (message) => {
        const m = message as unknown as VoskMessage;
        if (m.event !== 'result') return;
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
        this.handlers?.onPartial((m.result.partial ?? '').trim());
      });
      recognizer.on('error', (message) => {
        const m = message as unknown as VoskMessage;
        if (m.event === 'error') this.handlers?.onError(m.error);
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
    this.recognizer.acceptWaveformFloat(samples, sampleRate);
  }

  /** Chiude l'enunciato e chiede il risultato definitivo. */
  flush(): void {
    this.recognizer?.retrieveFinalResult();
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
      this.model?.terminate();
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
