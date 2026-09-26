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
  /**
   * Pronuncia un testo. Deve essere sicuro chiamarla anche se non supportata.
   *
   * `onDone` viene invocata quando l'enunciato e' finito. Serve a riaprire
   * l'ascolto: finche' ROAD SENSE parla il riconoscitore resta chiuso, cosi'
   * la voce sintetica non puo' rientrare dal microfono. Chi implementa DEVE
   * garantire che venga chiamata una volta sola, anche in caso di errore:
   * una `onDone` mai invocata lascerebbe la voce spenta per sempre.
   */
  speak(text: string, onDone?: () => void): void;
  /**
   * Sblocca la sintesi, se il browser lo richiede.
   *
   * DEVE essere chiamata dentro un gesto dell'utente. Su iOS la prima
   * `speak()` e' consentita solo durante un'attivazione: fuori da quella
   * finestra l'enunciato viene scartato in silenzio - nessun suono, nessun
   * errore, nemmeno `onstart`. E' cio' che sull'iPhone faceva riconoscere il
   * comando senza pronunciare la risposta.
   */
  prime?(): void;
  /** Interrompe cio' che e' in corso, es. allo STOP. */
  cancel(): void;
}

/** Usata quando la sintesi non c'e': tutto continua, in silenzio. */
export class SilentSpeechProvider implements SpeechProvider {
  readonly id = 'silent';
  isSupported(): boolean {
    return false;
  }
  prime(): void {
    /* niente da sbloccare */
  }
  speak(_text: string, onDone?: () => void): void {
    // Nessuna voce disponibile: l'enunciato finisce subito, cosi' chi
    // aspettava di riaprire l'ascolto non resta appeso.
    onDone?.();
  }
  cancel(): void {
    /* niente da interrompere */
  }
}
