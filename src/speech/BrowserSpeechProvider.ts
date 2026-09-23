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

export class BrowserSpeechProvider implements SpeechProvider {
  readonly id = 'browser-speech';

  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof SpeechSynthesisUtterance === 'function'
    );
  }

  speak(text: string): void {
    if (!this.isSupported()) return;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = SPEECH.lang;
      utterance.rate = SPEECH.rate;
      utterance.pitch = SPEECH.pitch;
      utterance.volume = SPEECH.volume;
      // Un avviso vecchio non deve accodarsi a uno nuovo: in auto conta
      // l'ultimo, non la coda.
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch {
      // Una sintesi che fallisce non deve mai propagare un errore a chi guida.
    }
  }

  cancel(): void {
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* niente da interrompere */
    }
  }
}
