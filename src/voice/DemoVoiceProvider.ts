/**
 * ROAD SENSE - voce simulata per la DEMO MODE e per i test.
 *
 * Recita frasi prestabilite a istanti prestabiliti. Nessun microfono, nessuna
 * rete, nessun permesso: serve a mostrare e a verificare la catena
 * voce -> parser -> evento -> conferma -> avviso senza dover parlare.
 */

import type {
  VoiceCapabilities,
  VoiceHandlers,
  VoiceProvider,
} from './VoiceProvider';

export interface ScriptedPhrase {
  /** Millisecondi dall'avvio. */
  atMs: number;
  text: string;
}

export class DemoVoiceProvider implements VoiceProvider {
  readonly id = 'demo-voice';
  readonly label = 'Voce simulata';

  private timers: ReturnType<typeof setTimeout>[] = [];
  private handlers: VoiceHandlers = {};

  constructor(private readonly script: readonly ScriptedPhrase[] = []) {}

  capabilities(): VoiceCapabilities {
    // Simulata, quindi "locale" nel senso che nulla lascia il dispositivo.
    return { supported: true, onDevice: true };
  }

  start(handlers: VoiceHandlers): void {
    this.handlers = handlers;
    handlers.onStatus?.('listening');
    for (const phrase of this.script) {
      this.timers.push(
        setTimeout(() => this.handlers.onTranscript?.(phrase.text), phrase.atMs),
      );
    }
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.handlers.onStatus?.('off');
    this.handlers = {};
  }
}
