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
// STRUMENTAZIONE TEMPORANEA: solo osservazione, nessun effetto sulla sintesi.
// Vedi `ttsTrace.ts` per il motivo e per quando va rimossa.
import { traceTts } from './ttsTrace';

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
  /** Solo per la traccia: distingue "non partito" da "partito e non udibile". */
  private startSeen = false;

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
      this.startSeen = false;
      traceTts('request', {
        text,
        detail: `speaking=${window.speechSynthesis.speaking} pending=${window.speechSynthesis.pending}`,
      });
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = SPEECH.lang;
      utterance.rate = SPEECH.rate;
      utterance.pitch = SPEECH.pitch;
      utterance.volume = SPEECH.volume;
      // `onstart` NON cambia nulla: e' l'osservabile che mancava, ed e' l'unico
      // modo di sapere se WebKit abbia davvero avviato l'enunciato.
      utterance.onstart = () => {
        this.startSeen = true;
        traceTts('start');
      };
      utterance.onend = () => {
        traceTts('end');
        this.settle();
      };
      utterance.onerror = (event) => {
        traceTts('error', { detail: event?.error ?? 'sconosciuto' });
        this.settle();
      };
      // Un avviso vecchio non deve accodarsi a uno nuovo: in auto conta
      // l'ultimo, non la coda.
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      // Rete di sicurezza: se `end` non arriva, si chiude lo stesso.
      this.watchdog = setTimeout(() => {
        traceTts('watchdog', {
          detail: this.startSeen ? 'era partito, nessun end' : 'NESSUN START',
        });
        this.settle();
      }, estimatedSpeechMs(text));
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
