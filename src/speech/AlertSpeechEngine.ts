/**
 * ROAD SENSE - quando pronunciare un avviso.
 *
 * Separato dal provider di sintesi e separato dall'AlertEngine: il primo sa
 * come parlare, il secondo sa cosa e' pericoloso, questo sa quando vale la
 * pena aprire bocca.
 *
 * DUE REGOLE, ENTRAMBE NECESSARIE
 * - deduplicazione: lo stesso avviso non si ripete prima del periodo di
 *   attesa. Sentirsi dire tre volte della stessa buca e' peggio che non
 *   sentirselo dire;
 * - intervallo minimo: due avvisi qualsiasi non si accavallano. In auto una
 *   voce che parla ininterrottamente diventa rumore, e il rumore si ignora.
 */

import { SPEECH } from '../config/config';
import type { SpeechProvider } from './SpeechProvider';

export class AlertSpeechEngine {
  private lastSpokenAt = new Map<string, number>();
  private lastAnyAt = Number.NEGATIVE_INFINITY;

  constructor(private provider: SpeechProvider) {}

  /** Sostituisce il provider, ad esempio quando la sintesi non e' disponibile. */
  setProvider(provider: SpeechProvider): void {
    this.provider = provider;
  }

  isSupported(): boolean {
    return this.provider.isSupported();
  }

  reset(): void {
    this.lastSpokenAt.clear();
    this.lastAnyAt = Number.NEGATIVE_INFINITY;
    this.provider.cancel();
  }

  /**
   * Pronuncia `text` se le regole lo consentono.
   * `key` identifica l'avviso: due avvisi con la stessa chiave sono lo stesso
   * avviso, anche se il testo e' leggermente diverso perche' la distanza e'
   * cambiata.
   *
   * @returns true se ha parlato davvero.
   */
  announce(key: string, text: string, now: number = Date.now()): boolean {
    if (!this.provider.isSupported()) return false;
    if (now - this.lastAnyAt < SPEECH.minGapMs) return false;

    const last = this.lastSpokenAt.get(key);
    if (last !== undefined && now - last < SPEECH.cooldownMs) return false;

    this.lastSpokenAt.set(key, now);
    this.lastAnyAt = now;
    this.provider.speak(text);
    return true;
  }

  /** Interrompe e dimentica: usata allo STOP. */
  stop(): void {
    this.provider.cancel();
    this.reset();
  }
}
