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
 * - L'ascolto e' INTERMITTENTE, non continuo. Il primo test in auto su iPhone
 *   ha mostrato che un riconoscitore sempre aperto tiene attiva una sessione
 *   audio di registrazione: iOS dirotta l'audio e l'impianto dell'auto
 *   (Bluetooth / CarPlay) viene di fatto silenziato. Un'app che ascolta non
 *   puo' impedire di ascoltare la musica. ROAD SENSE apre finestre di ascolto
 *   e fra l'una e l'altra RILASCIA il riconoscitore.
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

/** Quale costruttore e' stato realmente scelto dal browser. */
export type VoiceApiName = 'SpeechRecognition' | 'webkitSpeechRecognition' | 'assente';

/** Permesso del microfono, per quel che il browser accetta di dichiarare. */
export type VoiceMicState = 'permesso' | 'negato' | 'sconosciuto';

/**
 * Dove avviene l'elaborazione.
 * 'non disponibile' significa "il browser non permette di saperlo o non offre
 * l'opzione": e' diverso da 'no', che e' una risposta negativa esplicita.
 */
export type VoiceLocalState = 'si' | 'no' | 'non disponibile';

/**
 * Punto esatto della catena in cui si trova il riconoscimento.
 * Non e' lo stesso di `VoiceStatus`: quello dice all'utente se la voce
 * funziona, questo serve a capire DOVE si e' fermata.
 */
export type VoicePhase =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'speech'
  | 'result'
  | 'error'
  | 'ended'
  /** Fra due finestre di ascolto: il riconoscitore e' rilasciato. */
  | 'pausa'
  /** Sospeso perche' ROAD SENSE sta parlando. */
  | 'voce ROAD SENSE';

/**
 * Fotografia della catena vocale, per la diagnosi.
 *
 * Non esce mai dal dispositivo e non viene mostrata nell'interfaccia normale:
 * si vede solo con ?debugVoice=1. Sono dati tecnici, non un registro di cio'
 * che viene detto - l'ultima frase e' l'unico testo presente, sta in memoria e
 * sparisce chiudendo la pagina.
 */
export interface VoiceDiagnostics {
  api: VoiceApiName;
  mic: VoiceMicState;
  phase: VoicePhase;
  local: VoiceLocalState;
  /** Consenso all'elaborazione remota dell'audio. */
  remote: boolean;
  lastError: string | null;
  lastPhrase: string | null;
  /**
   * Ultimi eventi emessi da SpeechRecognition, in ordine.
   * Sono i nomi reali degli eventi del browser: servono a capire dove si
   * ferma la catena su un telefono che non si ha in mano.
   */
  events: string;
  /**
   * ESPERIMENTO VAD. Serve a verificare sul dispositivo una cosa sola: che
   * durante il silenzio `recognitionStarts` NON cresca, e quindi che Android
   * non emetta alcun tono.
   */
  vad: 'off' | 'armed' | 'triggered' | 'suspended';
  /** Quante volte il VAD ha rilevato voce. */
  vadTriggers: number;
  /** Livello e rumore di fondo misurati. Un'energia, mai un contenuto. */
  vadLevel: number;
  vadFloor: number;
  /** Quante sessioni di riconoscimento sono state aperte. */
  recognitionStarts: number;
  /**
   * DIAGNOSI DEL PERMESSO MICROFONO (solo ?debugVoice=1).
   *
   * Due canali separati, perche' possono divergere: la Permissions API
   * dichiara uno stato, `getUserMedia` produce un fatto. Su Chrome per
   * Android non e' garantito che coincidano, e leggerli insieme impedisce di
   * distinguerli. Sono valori LETTERALI: niente qui e' dedotto.
   */
  permissionsApi: 'disponibile' | 'non disponibile';
  permissionsValue: 'granted' | 'prompt' | 'denied' | 'errore' | '--';
  getUserMedia:
    | 'non tentato'
    | 'successo'
    | 'NotAllowedError'
    | 'NotFoundError'
    | 'NotReadableError'
    | 'altro errore';
  /** Nome esatto dell'errore quando non rientra nei tre previsti. */
  getUserMediaDetail: string | null;
}

export interface VoiceHandlers {
  /** Frase riconosciuta, testo grezzo. L'interpretazione avviene altrove. */
  onTranscript?: (transcript: string) => void;
  onStatus?: (status: VoiceStatus) => void;
  /** Aggiornamento parziale della diagnosi. Ignorato se nessuno ascolta. */
  onDiagnostics?: (patch: Partial<VoiceDiagnostics>) => void;
}

export interface VoiceProvider {
  readonly id: string;
  readonly label: string;
  capabilities(): VoiceCapabilities;
  start(handlers: VoiceHandlers): void;
  stop(): void;
  /**
   * Una sessione e' in ascolto in questo momento.
   * Serve a impedire che un secondo tocco apra un secondo microfono.
   */
  isListening?(): boolean;
  /**
   * L'ascolto mani libere e' attivo: sessione aperta, oppure chiusa e in
   * attesa di riaprirsi da sola. E' questo, non `isListening`, che dice se un
   * tocco su VOCE aprirebbe una catena parallela.
   */
  isArmed?(): boolean;
  /**
   * Rilascia il riconoscitore perche' ROAD SENSE sta per parlare.
   *
   * Senza questo, la voce sintetica finirebbe nel microfono e potrebbe essere
   * interpretata come una nuova segnalazione: l'app parlerebbe a se stessa.
   * Non e' un "ignora i risultati": il riconoscitore viene proprio chiuso,
   * cosi' su iOS la sintesi non deve nemmeno contendersi la sessione audio.
   */
  pause?(): void;
  /** Riapre l'ascolto dopo che ROAD SENSE ha finito di parlare. */
  resume?(): void;
}
