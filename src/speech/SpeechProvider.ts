/**
 * ROAD SENSE - astrazione della sintesi vocale.
 *
 * Gli avvisi parlati sono un'USCITA dell'AlertEngine, non un motore
 * parallelo: non decidono nulla, leggono cio' che e' gia' stato deciso. Se la
 * sintesi non e' disponibile, ROAD SENSE funziona esattamente come prima.
 */

export interface SpeechProvider {
  readonly id: string;
  isSupported(): boolean;
  /** Pronuncia un testo. Deve essere sicuro chiamarla anche se non supportata. */
  speak(text: string): void;
  /** Interrompe cio' che e' in corso, es. allo STOP. */
  cancel(): void;
}

/** Usata quando la sintesi non c'e': tutto continua, in silenzio. */
export class SilentSpeechProvider implements SpeechProvider {
  readonly id = 'silent';
  isSupported(): boolean {
    return false;
  }
  speak(): void {
    /* nessuna voce disponibile */
  }
  cancel(): void {
    /* niente da interrompere */
  }
}
