/**
 * ROAD SENSE / LABORATORIO FASE 0 - dal flusso continuo all'enunciato.
 *
 * NON FA PARTE DELL'APPLICAZIONE. Nessun file di ROAD SENSE lo importa.
 *
 * E' IL CUORE DELL'ESPERIMENTO.
 *
 * Il microfono non si chiude mai e i campioni entrano senza interruzione nel
 * buffer circolare. Il cancello guarda passare il flusso e dice soltanto due
 * cose: "qui e' iniziato il parlato", "qui e' finito".
 *
 * Quando dice che e' iniziato, il segmento consegnato al decoder NON parte da
 * quel momento: parte da PRIMA.
 *
 *   ...silenzio...  b  u  c  a  ...silenzio...
 *                   |     ^
 *                   |     `-- qui il cancello ne e' certo (sustain trascorso)
 *                   `-- da qui il decoder riceve, perche' era in memoria
 *
 * Il pre-roll copre il tempo che serve al cancello per convincersi, piu' un
 * margine. E' la ragione per cui "Buca" non puo' diventare "uca": la "B" e'
 * stata catturata dal microfono prima che qualcuno si accorgesse che era
 * cominciata una parola. Nessuna wake word, nessun ritardo imposto a chi parla,
 * nessun timer da tarare: solo il fatto che l'audio era gia' stato registrato.
 *
 * Non esiste un percorso che riapra il microfono, perche' il microfono non si
 * chiude. Fra la prima e la centesima parola non c'e' nessuna differenza di
 * stato: `nextToSend` avanza e il decoder viene svuotato. Tutto il resto -
 * sessioni, cicli, riarmi, contatori di silenzio, backoff - semplicemente non
 * esiste in questo file, ed e' il motivo per cui il file e' corto.
 */

import { msToSamples, SpeechGate } from './speechGate';
import { RingBuffer } from './ringBuffer';

/** Destinazione dei campioni. Astratta per poter essere verificata senza audio. */
export interface UtteranceSink {
  feed: (samples: Float32Array) => void;
  flush: () => void;
}

export interface CaptureStats {
  /** Enunciati delimitati da inizio test. */
  utterances: number;
  /**
   * Audio realmente consegnato PRIMA dell'istante in cui la voce e' salita, ms.
   * E' la misura della prima sillaba: se scende a zero, il pre-roll non sta
   * funzionando e il decoder sta ricevendo una parola decapitata.
   */
  leadMs: number;
  /** Pre-roll richiesto ma non disponibile nel buffer, ms. Deve restare 0. */
  missingLeadMs: number;
  /** Durata del primo blocco consegnato, ms: pre-roll + sustain. */
  firstChunkMs: number;
  /** Campioni consegnati al decoder nell'ultimo enunciato. */
  lastUtteranceSamples: number;
}

export class UtteranceCapture {
  private capturing = false;
  private nextToSend = 0;
  private sent = 0;
  private stats_: CaptureStats = {
    utterances: 0,
    leadMs: 0,
    missingLeadMs: 0,
    firstChunkMs: 0,
    lastUtteranceSamples: 0,
  };

  constructor(
    private readonly ring: RingBuffer,
    private readonly gate: SpeechGate,
    private readonly sink: UtteranceSink,
    private readonly sampleRate: number,
    private readonly preRollMs: number,
  ) {}

  stats(): CaptureStats {
    return { ...this.stats_ };
  }
  isCapturing(): boolean {
    return this.capturing;
  }

  /**
   * Un blocco di campioni appena arrivato dal microfono.
   *
   * L'ordine e' obbligato: prima si conserva, poi si giudica. Giudicare prima
   * di conservare significherebbe decidere che una parola e' iniziata quando
   * il suo inizio non e' ancora in memoria.
   */
  push(frame: Float32Array): void {
    this.ring.write(frame);
    const event = this.gate.push(frame);
    const now = this.gate.position();

    if (event?.type === 'open') {
      const preRoll = msToSamples(this.preRollMs, this.sampleRate);
      const wanted = event.startSample - preRoll;
      const from = Math.max(wanted, this.ring.start);
      const segment = this.ring.readFrom(from, now - from);

      this.capturing = true;
      this.nextToSend = now;
      this.sent = segment.length;
      this.stats_.utterances++;
      this.stats_.leadMs = samplesToMs(event.startSample - from, this.sampleRate);
      this.stats_.missingLeadMs = samplesToMs(Math.max(0, this.ring.start - wanted), this.sampleRate);
      this.stats_.firstChunkMs = samplesToMs(segment.length, this.sampleRate);

      this.sink.feed(segment);
      return;
    }

    if (!this.capturing) return;

    const segment = this.ring.readFrom(this.nextToSend, now - this.nextToSend);
    this.nextToSend = now;
    this.sent += segment.length;
    this.sink.feed(segment);

    if (event?.type === 'close') {
      this.capturing = false;
      this.stats_.lastUtteranceSamples = this.sent;
      this.sent = 0;
      // Il decoder ha ricevuto anche l'hangover, cioe' un tratto di silenzio
      // dopo la parola: e' voluto, perche' da' a Kaldi il confine che gli serve
      // per chiudere l'ipotesi invece di restare in attesa.
      this.sink.flush();
    }
  }

  /**
   * ROAD SENSE sta per parlare: si abbandona l'enunciato in corso.
   *
   * Non si consegna cio' che era stato raccolto - sarebbe mezza parola - e non
   * si tocca il riferimento assoluto, che deve restare allineato al buffer.
   */
  suspend(): void {
    this.capturing = false;
    this.sent = 0;
    this.gate.silence();
  }

  reset(): void {
    this.capturing = false;
    this.nextToSend = 0;
    this.sent = 0;
    this.stats_ = {
      utterances: 0,
      leadMs: 0,
      missingLeadMs: 0,
      firstChunkMs: 0,
      lastUtteranceSamples: 0,
    };
  }
}

function samplesToMs(samples: number, sampleRate: number): number {
  return Math.round((samples / sampleRate) * 1000);
}
