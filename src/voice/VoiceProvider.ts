/**
 * ROAD SENSE - astrazione del riconoscimento vocale.
 *
 * Stessa forma di `SensorProvider` e `WeatherProvider`: l'applicazione non sa
 * da dove arrivino le frasi. Cosi' la demo puo' recitare uno scenario e i test
 * possono verificare la catena senza microfono.
 *
 * LIMITI REALI, DICHIARATI (vedi README, sezione ZERO TOUCH)
 * - Il riconoscimento vocale dei browser e' per impostazione predefinita un
 *   servizio REMOTO: l'audio lascia il dispositivo. Per questo ROAD SENSE
 *   chiede l'elaborazione locale dove il browser la offre e tiene la voce
 *   spenta finche' non viene attivata esplicitamente.
 * - Nessun browser mantiene il microfono attivo a schermo spento o con l'app
 *   in secondo piano. ZERO TOUCH significa "senza toccare il telefono", non
 *   "con il telefono in tasca".
 * - L'ascolto continuo si interrompe da solo dopo silenzio o rumore: si
 *   riavvia automaticamente, ed e' il massimo che una PWA possa fare.
 */

export type VoiceStatus =
  /** Il browser non offre riconoscimento vocale. */
  | 'unsupported'
  /** Disponibile ma non attivato: e' lo stato iniziale, per scelta. */
  | 'off'
  /** In ascolto. */
  | 'listening'
  /** In pausa fra due sessioni: si riavvia da solo. */
  | 'restarting'
  /** Permesso al microfono negato. */
  | 'denied'
  /** Errore ripetuto: si rinuncia invece di insistere. */
  | 'error';

export interface VoiceCapabilities {
  /** Il browser espone un motore di riconoscimento. */
  supported: boolean;
  /**
   * L'elaborazione puo' avvenire sul dispositivo.
   * `false` significa che l'audio verra' inviato a un servizio remoto del
   * browser: e' un'informazione che l'utente deve poter vedere.
   */
  onDevice: boolean;
}

export interface VoiceHandlers {
  /** Frase riconosciuta, testo grezzo. L'interpretazione avviene altrove. */
  onTranscript?: (transcript: string) => void;
  onStatus?: (status: VoiceStatus) => void;
}

export interface VoiceProvider {
  readonly id: string;
  readonly label: string;
  capabilities(): VoiceCapabilities;
  start(handlers: VoiceHandlers): void;
  stop(): void;
}
