/**
 * ROAD SENSE / LABORATORIO FASE 0 - buffer circolare dei campioni audio.
 *
 * NON FA PARTE DELL'APPLICAZIONE. Vive sotto `src/lab/` e non e' importato da
 * nessun file di ROAD SENSE: serve al solo prototipo diagnostico.
 *
 * PERCHE' ESISTE, ED E' L'UNICO MOTIVO
 *
 * `SpeechRecognition` comincia a sentire quando la sessione si apre. L'audio
 * di un istante prima, per lui, non e' mai esistito. E' questa la ragione per
 * cui dire "Buca" produceva "uca": la prima sillaba cade nel tempo fra il
 * tocco, il tono di attivazione e l'apertura effettiva del microfono. Nessuna
 * soglia e nessun timer possono recuperare un suono gia' passato.
 *
 * Un microfono che non si chiude mai, invece, puo' tenere in memoria gli
 * ultimi secondi. Quando il rilevatore decide che qualcuno sta parlando,
 * l'inizio della parola E' GIA' QUI: basta leggere indietro. Il decoder non
 * riceve l'audio "da adesso", riceve l'audio "da prima".
 *
 * Questa classe e' esattamente quel "da prima", e nient'altro.
 *
 * INDICI ASSOLUTI
 * Ogni campione scritto ha un indice che non si azzera mai: il campione n-esimo
 * dall'inizio della sessione. Il chiamante puo' cosi' dire "dammi da 6400
 * campioni prima di dove sei ora" senza sapere nulla di come l'anello sia
 * avvolto. Se cio' che chiede e' gia' stato sovrascritto lo scopre dal
 * risultato, invece di ricevere silenzio o rumore al posto della voce.
 */

export class RingBuffer {
  private readonly data: Float32Array;
  /** Campioni scritti dall'inizio, mai azzerato: e' il sistema di riferimento. */
  private written = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('capacita del buffer non valida');
    }
    this.data = new Float32Array(capacity);
  }

  /** Indice assoluto del prossimo campione che verra' scritto. */
  get end(): number {
    return this.written;
  }

  /** Indice assoluto del campione piu' vecchio ancora leggibile. */
  get start(): number {
    return Math.max(0, this.written - this.capacity);
  }

  write(chunk: Float32Array): void {
    // Di un blocco piu' lungo dell'anello si conserva la CODA: e' l'audio piu'
    // recente, l'unico che il pre-roll possa usare.
    const source =
      chunk.length > this.capacity ? chunk.subarray(chunk.length - this.capacity) : chunk;

    // L'offset va calcolato sull'indice ASSOLUTO del primo campione conservato,
    // non su `written`. Scrivere la coda a partire da zero sembra innocuo e
    // corrompe l'anello: la corrispondenza fra indice assoluto e posizione
    // interna si perde, e da quel momento `readFrom` restituisce i campioni in
    // ordine sbagliato. Non silenzio, non rumore: audio rimescolato, cioe' il
    // difetto peggiore possibile qui, perche' il decoder riceverebbe qualcosa
    // che suona come voce senza esserlo.
    const startAbs = this.written + (chunk.length - source.length);
    const offset = startAbs % this.capacity;
    const untilEnd = this.capacity - offset;

    if (source.length <= untilEnd) {
      this.data.set(source, offset);
    } else {
      // Scrittura a cavallo della giunzione: due pezzi, nessuna copia extra.
      this.data.set(source.subarray(0, untilEnd), offset);
      this.data.set(source.subarray(untilEnd), 0);
    }
    this.written += chunk.length;
  }

  /**
   * Legge a partire da un indice assoluto.
   *
   * Se `from` e' piu' vecchio di cio' che l'anello conserva, la lettura parte
   * dal piu' vecchio disponibile: si restituisce meno del richiesto, non dati
   * inventati. Il chiamante confronta la lunghezza ottenuta con quella chiesta
   * e sa se ha perso qualcosa - informazione che nel prototipo viene mostrata,
   * perche' significherebbe "pre-roll troppo corto".
   */
  readFrom(from: number, length: number): Float32Array {
    const first = Math.max(from, this.start);
    const last = Math.min(first + length, this.written);
    const count = last - first;
    if (count <= 0) return new Float32Array(0);

    const out = new Float32Array(count);
    const offset = first % this.capacity;
    const untilEnd = this.capacity - offset;
    if (count <= untilEnd) {
      out.set(this.data.subarray(offset, offset + count));
    } else {
      out.set(this.data.subarray(offset, this.capacity), 0);
      out.set(this.data.subarray(0, count - untilEnd), untilEnd);
    }
    return out;
  }

  /** Azzera contenuto e riferimento. Usato solo dal rilascio completo. */
  reset(): void {
    this.data.fill(0);
    this.written = 0;
  }
}
