/**
 * ROAD SENSE - sintesi vocale tramite `speechSynthesis`.
 *
 * A differenza del riconoscimento, la sintesi e' locale nei browser moderni:
 * non c'e' audio che lascia il dispositivo. E' un'API gratuita, senza chiavi
 * e senza dipendenze.
 *
 * Limite noto: su iOS la prima pronuncia deve seguire un gesto utente. Il
 * tocco su START e' quel gesto, quindi gli avvisi successivi funzionano; e se
 * cosi' non fosse, l'effetto e' il silenzio, mai un errore.
 */

import { SPEECH } from '../config/config';
import type { SpeechProvider } from './SpeechProvider';

/**
 * Durata stimata di un enunciato.
 *
 * Serve come rete di sicurezza, non come misura: su iOS `onend` a volte non
 * arriva mai. Senza un limite, chi aspetta la fine per riaprire l'ascolto
 * resterebbe in attesa per sempre, cioe' la voce smetterebbe di funzionare.
 */
export function estimatedSpeechMs(text: string): number {
  const raw = text.length * SPEECH.msPerChar;
  return Math.min(SPEECH.maxUtteranceMs, Math.max(SPEECH.minUtteranceMs, raw));
}

export class BrowserSpeechProvider implements SpeechProvider {
  readonly id = 'browser-speech';
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private pending: (() => void) | null = null;

  /** La sintesi e' gia' stata sbloccata dentro un gesto dell'utente. */
  private primed = false;

  /**
   * Sblocca la sintesi. Da chiamare DENTRO il gesto che attiva la voce.
   *
   * Si pronuncia un enunciato vuoto a volume zero: su iOS serve a consumare
   * l'attivazione dell'utente, ed e' l'unico modo perche' le chiamate
   * successive - che avvengono dopo un comando vocale, quindi senza gesto -
   * vengano davvero eseguite. Altrove non fa nulla di percepibile.
   */
  prime(): void {
    if (this.primed || !this.isSupported()) return;
    this.primed = true;
    try {
      const sblocco = new SpeechSynthesisUtterance(' ');
      sblocco.volume = 0;
      sblocco.lang = SPEECH.lang;
      window.speechSynthesis.speak(sblocco);
    } catch {
      // Se non si puo' sbloccare, si prova comunque a parlare piu' avanti.
    }
  }

  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof SpeechSynthesisUtterance === 'function'
    );
  }

  speak(text: string, onDone?: () => void): void {
    if (!this.isSupported()) {
      onDone?.();
      return;
    }
    // Un enunciato precedente ancora in sospeso viene chiuso adesso: la sua
    // `onDone` non deve restare appesa.
    this.settle();
    this.pending = onDone ?? null;

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = SPEECH.lang;
      utterance.rate = SPEECH.rate;
      utterance.pitch = SPEECH.pitch;
      utterance.volume = SPEECH.volume;
      utterance.onend = () => this.settle();
      utterance.onerror = () => this.settle();
      // Un avviso vecchio non deve accodarsi a uno nuovo: in auto conta
      // l'ultimo, non la coda. Ma si annulla SOLO se c'e' davvero qualcosa in
      // corso: su iOS una `cancel()` a vuoto puo' lasciare il sintetizzatore
      // in uno stato in cui la `speak()` immediatamente successiva viene
      // scartata senza un suono e senza un errore.
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
      }
      window.speechSynthesis.speak(utterance);
      // Rete di sicurezza: se `end` non arriva, si chiude lo stesso.
      this.watchdog = setTimeout(() => this.settle(), estimatedSpeechMs(text));
    } catch {
      // Una sintesi che fallisce non deve mai propagare un errore a chi guida,
      // ne' lasciare l'ascolto chiuso.
      this.settle();
    }
  }

  cancel(): void {
    this.settle();
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* niente da interrompere */
    }
  }

  /** Dichiara concluso l'enunciato corrente. Idempotente. */
  private settle(): void {
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    const done = this.pending;
    this.pending = null;
    done?.();
  }
}
