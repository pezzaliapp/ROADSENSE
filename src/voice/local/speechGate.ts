/**
 * ROAD SENSE / LABORATORIO FASE 0 - cancello di parola.
 *
 * NON FA PARTE DELL'APPLICAZIONE. Nessun file di ROAD SENSE lo importa.
 *
 * CHE COSA FA, E SOPRATTUTTO CHE COSA NON FA
 *
 * Decide quando un tratto di audio contiene parlato, e delimita l'inizio e la
 * fine di quel tratto in indici assoluti di campione. Non riconosce nulla, non
 * apre microfoni, non chiude microfoni, non parla con il sistema operativo.
 *
 * DIFFERENZA SOSTANZIALE DALL'ESPERIMENTO VAD FALLITO
 *
 * L'esperimento precedente usava un rilevatore di voce per chiamare l'API di
 * riconoscimento del sistema. Il rilevatore funzionava; il bersaglio era
 * sbagliato. Ogni apertura del riconoscitore di Android emette il tono di
 * attivazione, quindi rendere il tono proporzionale ai comandi anziche' al
 * tempo non lo eliminava: lo riduceva. E ogni apertura perdeva comunque
 * l'inizio della parola, perche' quel riconoscitore non puo' sentire il passato.
 *
 * Qui il cancello non apre NIENTE. Marca due indici su un flusso che scorre
 * gia': da quale campione leggere, fino a quale. Il microfono e' stato aperto
 * una sola volta, dal gesto iniziale, e resta aperto. Per costruzione non
 * esiste alcun tono di sistema da emettere, perche' non esiste alcuna sessione
 * di riconoscimento da aprire.
 *
 * SOGLIA RELATIVA, NON ASSOLUTA
 *
 * Un abitacolo a 130 km/h e' rumoroso; lo stesso abitacolo fermo al semaforo
 * non lo e'. Una soglia fissa sarebbe sorda in autostrada e isterica da fermo.
 * Si misura quindi il rumore di fondo e si chiede che la voce lo superi di un
 * fattore.
 *
 * TRE PROTEZIONI, OGNUNA CONTRO UN GUASTO PRECISO
 *
 * 1. CALIBRAZIONE INIZIALE. Per i primi istanti il cancello non puo' aprire:
 *    misura e tace. Senza questo, avviando il test in un'auto gia' in
 *    movimento il rumore supererebbe subito il fondo di partenza, il cancello
 *    si aprirebbe immediatamente e - non aggiornando il fondo mentre e' aperto
 *    - non si richiuderebbe MAI. Non e' un'ipotesi: e' il difetto che i test
 *    di questo file hanno trovato nella prima stesura.
 *
 * 2. ADATTAMENTO ASIMMETRICO. Il fondo scende in fretta e sale piano. Un
 *    silenzio improvviso va seguito subito; un aumento di rumore e' quasi
 *    sempre qualcuno che parla, e inseguirlo renderebbe il cancello sordo
 *    proprio mentre serve.
 *
 * 3. DURATA MASSIMA DELL'ENUNCIATO. "Incidente" dura meno di un secondo; un
 *    enunciato che si prolunga non e' una parola, e' rumore sostenuto sopra
 *    soglia. Superato il limite si chiude d'autorita' E si rialza il fondo
 *    verso il livello corrente: e' l'uscita di sicurezza che impedisce
 *    qualunque stato bloccato, anche quello che la calibrazione non prevede.
 *
 * Il fondo NON viene aggiornato mentre l'enunciato e' aperto. E' la ragione per
 * cui una frase lunga non puo' alzare la propria soglia e zittirsi da sola.
 *
 * DUE TEMPI PER I CONFINI
 *
 *   sustain    per aprire servono alcuni frame consecutivi sopra soglia: un
 *              colpo di tosse o una buca non sono una parola.
 *   hangover   per chiudere serve un silenzio prolungato: dentro "in-ci-den-te"
 *              ci sono pause, e chiudere sulla prima significherebbe spezzare
 *              la parola a meta'.
 *
 * L'apertura viene datata all'INIZIO della salita, non all'istante in cui la
 * conferma arriva: quei millisecondi di sustain sono voce, e vanno inclusi nel
 * segmento consegnato al decoder assieme al pre-roll.
 */

export interface SpeechGateConfig {
  /** Frequenza di campionamento del flusso in ingresso, Hz. */
  sampleRate: number;
  /** Quanto deve durare la salita per aprire, ms. */
  sustainMs: number;
  /** Quanto deve durare il silenzio per chiudere, ms. */
  hangoverMs: number;
  /** Oltre questa durata l'enunciato viene chiuso d'autorita', ms. */
  maxUtteranceMs: number;
  /** Ascolto iniziale in cui si misura senza poter aprire, ms. */
  calibrationMs: number;
  /** Quanto in fretta il fondo SCENDE, 0..1. Alto: segue subito il silenzio. */
  floorAlphaDown: number;
  /** Quanto in fretta il fondo SALE, 0..1. Basso: non inseguire la voce. */
  floorAlphaUp: number;
  /** Quante volte il fondo deve essere superato. */
  triggerRatio: number;
  /** Pavimento assoluto: sotto questo livello non e' voce nemmeno nel silenzio totale. */
  minLevel: number;
  /** Fondo di partenza, prima di avere misure. */
  initialFloor: number;
}

export const DEFAULT_GATE: SpeechGateConfig = {
  sampleRate: 16_000,
  sustainMs: 120,
  hangoverMs: 420,
  maxUtteranceMs: 2500,
  calibrationMs: 700,
  floorAlphaDown: 0.25,
  floorAlphaUp: 0.02,
  triggerRatio: 2.8,
  minLevel: 0.012,
  initialFloor: 0.01,
};

export type GateState = 'silence' | 'speech';

export type GateEvent =
  /** Inizio di un enunciato, all'indice assoluto in cui la voce e' salita. */
  | { type: 'open'; startSample: number }
  /**
   * Fine dell'enunciato.
   * `forced` distingue una chiusura naturale dal limite di durata: nel
   * prototipo viene mostrata, perche' molte chiusure forzate significano
   * "soglia troppo bassa per questo abitacolo".
   */
  | { type: 'close'; endSample: number; forced: boolean };

export class SpeechGate {
  private state_: GateState = 'silence';
  private floor_: number;
  private level_ = 0;
  /** Campioni consumati dall'inizio: stesso riferimento del buffer circolare. */
  private consumed = 0;
  /** Campioni consecutivi sopra soglia, e dove sono iniziati. */
  private aboveRun = 0;
  private aboveStart = 0;
  /** Campioni consecutivi sotto soglia mentre l'enunciato e' aperto. */
  private belowRun = 0;
  /** Ultimo indice in cui si e' sentita voce: la fine dell'enunciato e' qui. */
  private lastVoice = 0;
  /** Indice assoluto in cui l'enunciato corrente si e' aperto. */
  private openedAt = 0;
  private forcedCloses_ = 0;

  constructor(private readonly config: SpeechGateConfig = DEFAULT_GATE) {
    this.floor_ = config.initialFloor;
  }

  state(): GateState {
    return this.state_;
  }
  /** Livello dell'ultimo frame, RMS 0..1. Solo per l'interfaccia diagnostica. */
  level(): number {
    return this.level_;
  }
  /** Rumore di fondo stimato. Mostrato accanto al livello per poter calibrare. */
  floor(): number {
    return this.floor_;
  }
  threshold(): number {
    return Math.max(this.floor_ * this.config.triggerRatio, this.config.minLevel);
  }
  /** Indice assoluto del prossimo campione atteso. */
  position(): number {
    return this.consumed;
  }
  /** true finche' si sta solo misurando l'abitacolo. */
  isCalibrating(): boolean {
    return this.consumed < msToSamples(this.config.calibrationMs, this.config.sampleRate);
  }
  /** Chiusure per superamento della durata massima: una spia di taratura. */
  forcedCloses(): number {
    return this.forcedCloses_;
  }

  /**
   * Consuma un blocco di campioni e restituisce l'eventuale transizione.
   *
   * Il blocco viene valutato intero: alle frequenze in gioco un blocco dura
   * pochi millisecondi, e spezzarlo non aggiungerebbe precisione utile.
   */
  push(frame: Float32Array): GateEvent | null {
    const startOfFrame = this.consumed;
    this.consumed += frame.length;
    if (frame.length === 0) return null;

    this.level_ = rms(frame);
    const { sampleRate } = this.config;
    const soglia = this.threshold();

    // Calibrazione: si misura e si tace. Adattamento veloce in entrambi i
    // versi, perche' qui l'obiettivo e' arrivare presto al rumore vero.
    if (this.isCalibrating()) {
      this.adaptFloor(this.config.floorAlphaDown);
      return null;
    }

    if (this.level_ > soglia) {
      if (this.aboveRun === 0) this.aboveStart = startOfFrame;
      this.aboveRun += frame.length;
      this.belowRun = 0;
      this.lastVoice = this.consumed;

      if (this.state_ === 'silence') {
        if (this.aboveRun >= msToSamples(this.config.sustainMs, sampleRate)) {
          this.state_ = 'speech';
          this.openedAt = this.aboveStart;
          // Datata all'inizio della salita: il sustain e' voce, non attesa.
          return { type: 'open', startSample: this.aboveStart };
        }
        return null;
      }

      // Enunciato aperto e ancora sopra soglia: e' qui che un rumore sostenuto
      // resterebbe per sempre se non ci fosse un limite di durata.
      if (this.consumed - this.openedAt >= msToSamples(this.config.maxUtteranceMs, sampleRate)) {
        return this.forceClose();
      }
      return null;
    }

    // Sotto soglia.
    this.aboveRun = 0;

    if (this.state_ === 'speech') {
      this.belowRun += frame.length;
      if (this.belowRun >= msToSamples(this.config.hangoverMs, sampleRate)) {
        this.state_ = 'silence';
        // Si chiude sull'ultima voce sentita, non sulla fine del silenzio:
        // l'hangover serviva a decidere, non fa parte dell'enunciato.
        return { type: 'close', endSample: this.lastVoice, forced: false };
      }
      // Durante l'enunciato il fondo NON si aggiorna.
      return null;
    }

    this.adaptFloor(this.level_ < this.floor_ ? this.config.floorAlphaDown : this.config.floorAlphaUp);
    return null;
  }

  /**
   * Torna al silenzio SENZA toccare il riferimento assoluto.
   *
   * Serve quando ROAD SENSE comincia a parlare: i campioni smettono di
   * arrivare, e un enunciato rimasto aperto non vedrebbe mai il silenzio che
   * serve a chiuderlo - resterebbe bloccato in `speech` per sempre.
   *
   * La differenza con `reset()` e' tutta in cio' che NON fa: `consumed` resta
   * dov'e'. Quel contatore e' il sistema di riferimento condiviso con il buffer
   * circolare, e azzerarne uno solo dei due li disallinea per sempre. E' il
   * difetto che sul Fold faceva riconoscere il primo comando e nessuno dei
   * successivi.
   *
   * Anche il fondo viene conservato: il cancello non ha sentito la voce
   * sintetica - quei campioni sono stati scartati prima - quindi la misura del
   * rumore d'abitacolo e' ancora valida.
   */
  silence(): void {
    this.state_ = 'silence';
    this.aboveRun = 0;
    this.aboveStart = this.consumed;
    this.belowRun = 0;
    this.lastVoice = this.consumed;
    this.openedAt = this.consumed;
  }

  reset(): void {
    this.state_ = 'silence';
    this.floor_ = this.config.initialFloor;
    this.level_ = 0;
    this.consumed = 0;
    this.aboveRun = 0;
    this.aboveStart = 0;
    this.belowRun = 0;
    this.lastVoice = 0;
    this.openedAt = 0;
    this.forcedCloses_ = 0;
  }

  private adaptFloor(alpha: number): void {
    this.floor_ = this.floor_ * (1 - alpha) + this.level_ * alpha;
  }

  /**
   * Uscita di sicurezza.
   *
   * Chiude l'enunciato e alza il fondo verso il livello corrente: se cio' che
   * teneva aperto il cancello era rumore, dopo questa chiamata il rumore e'
   * SOTTO soglia e il cancello torna utilizzabile. Senza questo passaggio la
   * chiusura forzata verrebbe seguita da un'immediata riapertura, e il
   * risultato sarebbe un'oscillazione invece di un blocco: diversa da vedersi,
   * identica da usarsi.
   */
  private forceClose(): GateEvent {
    this.state_ = 'silence';
    this.belowRun = 0;
    this.aboveRun = 0;
    this.forcedCloses_++;
    this.adaptFloor(this.config.floorAlphaDown);
    return { type: 'close', endSample: this.lastVoice, forced: true };
  }
}

export function rms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] as number;
    sum += v * v;
  }
  return Math.sqrt(sum / frame.length);
}

export function msToSamples(ms: number, sampleRate: number): number {
  return Math.max(1, Math.round((ms / 1000) * sampleRate));
}
