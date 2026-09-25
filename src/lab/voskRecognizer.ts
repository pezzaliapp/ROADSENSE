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

import { createModel, type KaldiRecognizer, type Model } from 'vosk-browser';

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

export class LocalRecognizer {
  private model: Model | null = null;
  private recognizer: KaldiRecognizer | null = null;
  private phase_: ModelPhase = 'assente';
  private handlers: RecognizerHandlers | null = null;
  private loadMs_ = 0;

  phase(): ModelPhase {
    return this.phase_;
  }
  /** Quanto e' durato il caricamento del modello, ms. Da misurare sul telefono. */
  loadMs(): number {
    return this.loadMs_;
  }
  isReady(): boolean {
    return this.phase_ === 'pronto' && this.recognizer !== null;
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
    const iniziato = Date.now();

    try {
      const model = await createModel(modelUrl);
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
      this.phase_ = 'errore';
      this.loadMs_ = Date.now() - iniziato;
      throw error instanceof Error ? error : new Error(String(error));
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
