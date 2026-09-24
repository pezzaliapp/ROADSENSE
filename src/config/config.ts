/**
 * ROAD SENSE - configurazione centralizzata.
 *
 * Tutte le soglie dell'euristica, i TTL e i parametri di alert stanno QUI.
 * Sono volutamente leggibili e modificabili senza toccare la logica.
 */

import type { EventType } from '../core/types';

export const APP = {
  name: 'ROAD SENSE',
  /**
   * Versione dichiarata in package.json, iniettata dalla build.
   * E' l'unico punto da aggiornare per una release: la stessa costante
   * finisce anche nel service worker.
   */
  version: __APP_VERSION__,
} as const;

// ---------------------------------------------------------------------------
// SENSORI
// ---------------------------------------------------------------------------
export const SENSORS = {
  /**
   * Frequenza di elaborazione dei campioni di movimento (Hz).
   * Il browser emette `devicemotion` a 30-60 Hz: i campioni in eccesso vengono
   * scartati. 50 Hz e' sufficiente per impulsi da buca (tipicamente 50-200 ms)
   * e piu' basso terrebbe fuori gli impulsi brevi (Nyquist).
   */
  motionHz: 50,
  /**
   * Costante del filtro passa-basso che stima il vettore gravita'.
   * Piu' vicino a 1 = stima piu' stabile ma piu' lenta ad adattarsi
   * a un cambio di inclinazione del telefono.
   */
  gravityAlpha: 0.95,
  /** Secondi di campioni "calmi" necessari prima che la detection si attivi. */
  warmupSec: 3,
  /**
   * Opzioni GPS. `enableHighAccuracy` e' attivo solo durante il monitoraggio:
   * a monitoraggio fermo il GPS viene rilasciato (vedi nota batteria nel README).
   */
  geo: {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000,
  },
  /**
   * Quanto si attende, dopo START, un primo campione di movimento reale prima
   * di dichiarare i sensori assenti, ms.
   *
   * Serve perche' l'esistenza di `DeviceMotionEvent` non significa che ci sia
   * un accelerometro: su desktop, e su telefoni che non lo espongono, l'evento
   * non arriva mai. Meglio dirlo che mostrare un indicatore verde falso.
   */
  motionGraceMs: 4000,
  /** Sopra questa precisione (m) la posizione e' considerata debole. */
  weakAccuracyM: 35,
  /** Sopra questa precisione (m) la posizione non e' usabile per un evento. */
  maxAccuracyM: 60,
} as const;

// ---------------------------------------------------------------------------
// DETECTION ENGINE - euristica anomalie
// ---------------------------------------------------------------------------
export const DETECTION = {
  /** Finestra di analisi mantenuta in memoria, ms. */
  windowMs: 2000,
  /**
   * Velocita' minima (m/s) sotto la quale NON si rileva nulla:
   * a bassa velocita' scossoni e manipolazioni del telefono sono indistinguibili
   * da una buca. 3 m/s ~= 11 km/h.
   */
  minSpeedMps: 3,
  /**
   * Velocita' oltre la quale l'evento e' sospetto (dato GPS incoerente).
   * 70 m/s ~= 252 km/h.
   */
  maxSpeedMps: 70,
  /** Soglia assoluta sul picco di accelerazione verticale, m/s^2. */
  peakThreshold: 3.2,
  /**
   * L'impulso deve emergere dal rumore di fondo di almeno questo fattore.
   * Evita di classificare come buca un fondo gia' uniformemente rumoroso.
   */
  peakOverBaseline: 3.0,
  /** Rumore di fondo massimo (RMS, m/s^2) perche' l'impulso sia "isolato". */
  maxBaselineRms: 2.0,
  /** Durata ammessa dell'impulso, ms. Sotto = rumore, sopra = manovra del veicolo. */
  minImpulseMs: 20,
  maxImpulseMs: 350,
  /** Periodo di inibizione dopo un rilevamento, ms. Evita raffiche di eventi. */
  refractoryMs: 2500,
  /** Soglie di severita' sul picco verticale, m/s^2. */
  severityMedium: 5.0,
  severitySevere: 8.0,
  /** Rotazione massima ammessa (deg/s): sopra, e' il telefono che si muove. */
  maxRotationRate: 220,

  /**
   * ANTI-MANIPOLAZIONE.
   *
   * Il primo test su strada ha prodotto 257 eventi: bastava toccare il
   * telefono. I criteri esistenti non bastavano perche' guardano l'impulso, e
   * un telefono preso in mano produce impulsi perfetti. Serve guardare il
   * CONTESTO: un telefono fermo in un supporto e uno in mano si comportano in
   * modo diverso anche quando l'accelerazione verticale e' identica.
   *
   * ATTENZIONE - QUESTE SOGLIE SONO PROVVISORIE.
   * Sono ricavate da ordini di grandezza fisici, non da misure su strada:
   *
   *   - in un supporto, la rotazione segue il veicolo: curve e rotonde stanno
   *     tipicamente sotto i 30 deg/s, una manovra brusca sotto i 60;
   *   - una mano che prende o ruota il telefono supera facilmente i 150 deg/s;
   *   - una buca spinge soprattutto in VERTICALE: la componente verticale e'
   *     la parte dominante dell'accelerazione totale. Una manipolazione
   *     produce componenti orizzontali confrontabili.
   *
   * VANNO VALIDATE CON UN TEST REALE prima di considerarle definitive.
   * `?sensorDebug=1` mostra i valori misurati proprio per questo.
   */
  stability: {
    /** Rotazione (deg/s) oltre la quale il telefono NON e' fermo nel veicolo. */
    gyroStableDps: 60,
    /** Rotazione (deg/s) che qualifica una manipolazione vera e propria. */
    manipulationDps: 150,
    /** Finestra su cui si valuta la rotazione massima recente, ms. */
    windowMs: 1500,
    /**
     * Dopo una manipolazione forte non si creano eventi stradali per questo
     * tempo: il telefono deve prima tornare fermo e la gravita' ristabilirsi.
     */
    quarantineMs: 5000,
    /**
     * Il veicolo deve essere in moto CONTINUATIVAMENTE da questo tempo.
     * Un singolo campione GPS sopra soglia non basta: a veicolo fermo il GPS
     * produce velocita' fantasma di pochi m/s per deriva del segnale.
     */
    minMotionHoldMs: 4000,
    /**
     * Quota minima della componente verticale sull'accelerazione totale al
     * picco. Sotto, l'urto non viene dalla strada.
     */
    minVerticalShare: 0.55,
  },

  /** Fondo irregolare: RMS sostenuto sopra soglia per una durata minima. */
  rough: {
    rmsThreshold: 2.4,
    minDurationMs: 4000,
    /** Inibizione dopo una segnalazione di fondo irregolare, ms. */
    refractoryMs: 30000,
  },
} as const;

// ---------------------------------------------------------------------------
// TTL - decadimento temporale per categoria
// ---------------------------------------------------------------------------
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Durata di vita di un evento. Valori di partenza ragionevoli, non definitivi:
 * una buca sopravvive a lungo, l'acqua evapora, un incidente viene rimosso.
 */
export const TTL_MS: Record<EventType, number> = {
  accident: 2 * HOUR,
  water: 4 * HOUR,
  slippery: 6 * HOUR,
  obstacle: 12 * HOUR,
  other: 24 * HOUR,
  roadworks: 7 * DAY,
  rough: 30 * DAY,
  pothole: 45 * DAY,

  // Famiglie della tassonomia ZERO TOUCH. I valori seguono la durata reale
  // del fenomeno: un contromano dura minuti, una frana ore.
  wrong_way: 15 * MIN,
  person: 30 * MIN,
  queue: 45 * MIN,
  vehicle: 1 * HOUR,
  animal: 1 * HOUR,
  weather: 1 * HOUR,
  gathering: 4 * HOUR,
  blocked: 12 * HOUR,
};

/**
 * Raggio (m) entro cui due rilevamenti dello stesso tipo sono considerati
 * lo stesso fenomeno. Una buca e' puntuale, un allagamento o un cantiere no.
 */
export const MERGE_RADIUS_M: Record<EventType, number> = {
  pothole: 20,
  rough: 60,
  obstacle: 30,
  water: 70,
  slippery: 70,
  accident: 80,
  roadworks: 120,
  other: 40,

  // Il raggio segue l'estensione del fenomeno: un veicolo fermo e' un punto,
  // una coda e' lunga, un contromano si muove e va trattato come un corridoio.
  vehicle: 60,
  person: 80,
  blocked: 100,
  animal: 150,
  gathering: 200,
  queue: 300,
  wrong_way: 500,
  weather: 800,
};

// ---------------------------------------------------------------------------
// CONFIDENCE ENGINE
// ---------------------------------------------------------------------------
export const CONFIDENCE = {
  /** Peso di una segnalazione manuale (una persona ha visto il pericolo). */
  manualWeight: 1.0,
  /** Peso massimo di un rilevamento automatico (moltiplicato per la sua confidence). */
  autoWeight: 0.7,
  /** Contributo del primo rilevamento di un dato segnalatore. */
  firstReportWeight: 1.0,
  /** Contributo di ogni rilevamento successivo dello STESSO segnalatore. */
  repeatReportWeight: 0.15,
  /** Tetto al contributo complessivo di un singolo segnalatore. */
  maxWeightPerReporter: 1.3,
  /**
   * Curva di saturazione: confidence_base = 1 - exp(-k * pesoTotale).
   * k = 0.43 -> 1 segnalatore ~0.35, 2 ~0.58, 3 ~0.72, 5 ~0.88.
   */
  saturationK: 0.43,
  /** Soglie qualitative. */
  possible: 0.3,
  probable: 0.55,
  confirmed: 0.78,
} as const;

// ---------------------------------------------------------------------------
// ALERT
// ---------------------------------------------------------------------------
export const ALERT = {
  /** Confidenza minima per generare un alert. */
  minConfidence: 0.35,
  /** Secondi di anticipo desiderati: la distanza di allerta scala con la velocita'. */
  lookaheadSec: 14,
  minLookaheadM: 120,
  maxLookaheadM: 600,
  /** Scostamento angolare massimo tra direzione di marcia ed evento (gradi). */
  maxBearingDeltaDeg: 35,
  /** A distanza ravvicinata il cono si allarga (l'errore angolare cresce). */
  nearDistanceM: 60,
  nearBearingDeltaDeg: 70,
  /**
   * Se l'evento ha una direzione nota, allerta solo chi viaggia nello stesso
   * senso entro questo scostamento (gradi). Evita alert per l'altra carreggiata.
   */
  maxHeadingMatchDeg: 60,
  /** Durata di visualizzazione dell'alert, ms. */
  displayMs: 9000,
  /** Non ripetere lo stesso alert prima di questo intervallo, ms. */
  cooldownMs: 120_000,
} as const;

// ---------------------------------------------------------------------------
// MAPPA
// ---------------------------------------------------------------------------
export const MAP = {
  /** Centro di fallback quando non c'e' posizione: Italia. */
  fallbackCenter: [41.9, 12.5] as [number, number],
  fallbackZoom: 5.5,
  followZoom: 16.5,
  /**
   * Zoom di inseguimento in DEMO MODE: piu' arretrato di quello reale.
   * Serve a far stare nello schermo anche le aree meteo simulate, che sono
   * larghe centinaia di metri. Non tocca la guida reale, dove conta vedere
   * bene la strada immediatamente davanti.
   */
  followZoomDemo: 15,
  /**
   * Durata dello scorrimento con cui la mappa segue il veicolo, ms.
   * Coincide con l'intervallo tra due posizioni GPS: il movimento risulta
   * continuo invece che a scatti.
   */
  followEaseMs: 950,
  minZoom: 3,
  maxZoom: 19,
} as const;

// La sorgente cartografica e' definita in `config/mapProviders.ts`:
// e' astratta dietro `MapTileProvider` perche' cambiare fornitore non debba
// mai richiedere modifiche a MapView.
export { ACTIVE_MAP_PROVIDER, MAP_PROVIDERS } from './mapProviders';
export type { MapTileProvider } from './mapProviders';

// ---------------------------------------------------------------------------
// VOCE (ZERO TOUCH)
// ---------------------------------------------------------------------------
/**
 * Parametri del riconoscimento vocale e degli avvisi parlati.
 *
 * ATTENZIONE, ed e' il punto piu' importante di questo blocco: il
 * riconoscimento vocale dei browser e' per impostazione predefinita un
 * servizio REMOTO. L'audio lascia il dispositivo. ROAD SENSE chiede quindi
 * l'elaborazione locale quando il browser la offre, e lascia la voce spenta
 * finche' non viene attivata esplicitamente.
 */
export const VOICE = {
  /** Lingua del riconoscimento. */
  lang: 'it-IT',
  /**
   * ASCOLTO SU RICHIESTA.
   *
   * ROAD SENSE non ascolta di continuo. Un tocco su VOCE apre UNA sessione,
   * si pronuncia il comando, la sessione si chiude. Per un'altra
   * segnalazione serve un altro tocco.
   *
   * Perche' non l'ascolto permanente, che pure era l'idea iniziale:
   * - su iPhone un riconoscitore sempre aperto tiene attiva una sessione
   *   audio di registrazione, e l'impianto dell'auto viene silenziato;
   * - su Android il riconoscitore si chiude da solo dopo ogni silenzio, e
   *   riaprirlo significa far suonare il tono di attivazione ogni pochi
   *   secondi, per tutto il viaggio.
   *
   * Nessuna delle due si risolve con una costante. Una sessione per tocco
   * costa un gesto e toglie entrambi i problemi.
   */
  session: {
    /**
     * Quanto si resta in ascolto se non succede nulla, ms.
     *
     * Deve bastare a pronunciare una parola con calma dopo aver toccato lo
     * schermo - "buca" richiede meno di un secondo, ma fra il tocco e la
     * voce passa qualche istante. Oltre, si chiude da soli invece di
     * lasciare il microfono aperto.
     */
    timeoutMs: 10_000,
  },
  /**
   * Parole di attivazione, non piu' richieste.
   *
   * Servivano all'ascolto permanente: senza, ogni conversazione in auto
   * sarebbe diventata una segnalazione. Con l'ascolto su richiesta il tocco
   * su VOCE dice gia' che si sta parlando all'applicazione, e pretendere
   * anche "ROAD SENSE" sarebbe un ostacolo senza scopo.
   *
   * Restano riconosciute e rimosse se pronunciate per abitudine.
   */
  wakeWords: ['road sense', 'roadsense', 'rodesense', 'rod sense'],
  /**
   * Confidenza assegnata a una segnalazione vocale singola.
   * Volutamente sotto la soglia di allerta: una voce sola non conferma nulla,
   * esattamente come un solo rilevamento automatico.
   */
  singleReportConfidence: 0.55,
  /** Durata della conferma visiva "SEGNALAZIONE RICEVUTA", ms. */
  confirmationMs: 4500,
} as const;

/**
 * Avvisi parlati. Sono un'USCITA dell'AlertEngine, non un motore parallelo:
 * non decidono nulla, leggono cio' che l'alert ha gia' deciso.
 */
export const SPEECH = {
  lang: 'it-IT',
  rate: 1.05,
  pitch: 1,
  volume: 1,
  /** Non ripetere lo stesso avviso prima di questo intervallo, ms. */
  cooldownMs: 90_000,
  /** Intervallo minimo fra due enunciati QUALSIASI, ms. */
  minGapMs: 8000,
  /**
   * Tempo oltre il quale un enunciato si considera concluso anche se il
   * browser non ha mai emesso `end`.
   *
   * Serve come rete di sicurezza: su iOS `onend` a volte non arriva, e senza
   * questo limite il riconoscitore resterebbe in pausa per sempre, cioe' la
   * voce smetterebbe di funzionare del tutto. Stimato dalla lunghezza del
   * testo, con un minimo.
   */
  maxUtteranceMs: 12000,
  minUtteranceMs: 2500,
  /** Millisecondi stimati per carattere pronunciato, per la stima di durata. */
  msPerChar: 75,
} as const;

// ---------------------------------------------------------------------------
// PRIVACY / IDENTIFICATORI
// ---------------------------------------------------------------------------
export const PRIVACY = {
  /** Rotazione dell'identificatore anonimo: 12 ore. */
  anonIdRotationMs: 12 * HOUR,
  /** Decimali di arrotondamento delle coordinate inviate (~1.1 m). */
  coordDecimals: 5,
} as const;

// ---------------------------------------------------------------------------
// BACKEND (opzionale)
// ---------------------------------------------------------------------------
export const API = {
  /** Vuoto = modalita' solo-locale, nessuna chiamata di rete. */
  base: (import.meta.env?.VITE_API_BASE ?? '').trim(),
  /** Raggio di richiesta eventi vicini, m. */
  fetchRadiusM: 5000,
  /** Intervallo minimo tra due sincronizzazioni, ms. */
  syncIntervalMs: 90_000,
  /** Distanza percorsa che forza una nuova sincronizzazione, m. */
  syncDistanceM: 2000,
  timeoutMs: 8000,
} as const;

// ---------------------------------------------------------------------------
// DEMO MODE
// ---------------------------------------------------------------------------
/**
 * Parametri dello scenario simulato. La demo serve a verificare la catena
 * GPS -> percorso -> evento -> distanza -> direzione -> confidenza -> alert
 * senza guidare, quindi deve somigliare alla guida urbana reale.
 */
export const DEMO = {
  /** Velocita' simulata: guida urbana. */
  minSpeedMps: 20 / 3.6,
  maxSpeedMps: 50 / 3.6,
  /**
   * Periodo dell'oscillazione di velocita', in metri percorsi. Una variazione
   * legata alla distanza, non al tempo, resta coerente anche se cambia la
   * frequenza dei campioni.
   */
  speedPeriodM: 700,
  /** Quanto si rallenta in curva, come frazione massima di velocita' persa. */
  turnSlowdown: 0.55,
  /** Distanza entro cui si "vede" la curva in arrivo, in metri. */
  turnLookaheadM: 45,
  /**
   * Costante di tempo del filtro che rende graduali i cambi di velocita', in
   * secondi. E' espressa nel tempo e non "per campione" di proposito: cosi' il
   * comportamento non cambia se cambia la frequenza di campionamento.
   * Con 3 s una variazione di 6 m/s viene assorbita in poco meno di 2 m/s al
   * secondo, circa 0.2 g: una guida tranquilla.
   */
  speedTimeConstantS: 3,
  /** Frequenza dei campioni di movimento simulati, Hz. */
  motionHz: 50,
  /** Intervallo tra due posizioni simulate, ms: come un GPS reale. */
  geoIntervalMs: 1000,
  /** Precisione dichiarata dalle posizioni simulate, m. */
  accuracyM: 8,
  /** Rumore di fondo dell'asfalto simulato, ampiezza in m/s^2. */
  roadNoise: 1.2,
  /**
   * RETE ROAD SENSE SIMULATA.
   *
   * Due veicoli fittizi percorrono lo stesso tracciato del veicolo
   * principale, leggermente davanti a lui, e rilevano una buca che il
   * principale incontrera' dopo. Serve a mostrare la catena:
   *   un veicolo rileva -> ROAD SENSE condivide -> un altro viene avvisato
   *   -> un ulteriore passaggio conferma.
   *
   * NON esiste alcuna rete reale: nessuna API, nessun backend, nessuna
   * connessione. Gli eventi prodotti sono normali RoadEvent marcati `demo`,
   * e la confidenza sale attraverso il ConfidenceEngine vero.
   */
  network: {
    /** Punto in cui i veicoli simulati rilevano la buca, frazione del percorso. */
    potholeAt: 0.05,
    /** Frequenza di aggiornamento dei veicoli simulati, ms. */
    tickMs: 250,
    /** Durata del lampeggio "BUCA RILEVATA" sul veicolo, ms. */
    flashMs: 2600,
    /**
     * I veicoli partono DAVANTI al principale, a velocita' costante: cosi'
     * incontrano la buca prima di lui, che e' il presupposto della
     * narrazione. Le distanze sono in metri dall'inizio del tracciato.
     */
    vehicles: [
      { id: 'demo-veh-a', startDistanceM: 270, speedMps: 12 },
      { id: 'demo-veh-b', startDistanceM: 220, speedMps: 11 },
    ],
    /**
     * Impulso del rilevamento simulato. Un picco di 9.5 m/s^2 corrisponde a
     * una buca profonda: e' voluto, perche' la soglia di allerta non venga
     * superata artificialmente ma per merito della severita' reale
     * dell'evento e della concordanza fra due veicoli.
     */
    detection: { peak: 9.5, impulseMs: 150, baselineRms: 0.4, speedMps: 11 },
    /**
     * Secondo punto dello scenario: un veicolo simulato segnala A VOCE un
     * veicolo in avaria in seconda corsia, e il secondo lo conferma passando
     * di li'. Serve a mostrare che una voce sola non basta.
     */
    voiceReport: {
      at: 0.12,
      phrase: 'ROAD SENSE, auto in avaria ferma in seconda corsia',
    },
    /**
     * Terzo punto: un pericolo CRITICO segnalato da UN SOLO veicolo.
     *
     * Serve a mostrare che gravita' e affidabilita' sono cose diverse: un
     * camion contromano viene annunciato anche senza conferma, dichiarando
     * pero' che nessun altro lo ha ancora visto. Aspettare una seconda voce
     * prima di nominarlo sarebbe indifendibile.
     */
    criticalReport: {
      at: 0.17,
      phrase: 'ROAD SENSE, camion contromano',
      /** Indice del veicolo che segnala: uno solo, per restare non confermato. */
      byVehicle: 0,
    },
  },

  /**
   * Anomalie lungo il percorso, come frazione della lunghezza totale.
   * `peak` e' il picco verticale in m/s^2, `durationMs` la durata dell'impulso.
   */
  anomalies: [
    { at: 0.13, peak: 6.5, durationMs: 120 },
    { at: 0.36, peak: 9.5, durationMs: 160 },
    { at: 0.61, peak: 4.2, durationMs: 90 },
    { at: 0.84, peak: 7.8, durationMs: 140 },
  ],
} as const;

// ---------------------------------------------------------------------------
// ROAD WEATHER (solo DEMO nella v0.1.0)
// ---------------------------------------------------------------------------
/**
 * Parametri degli avvisi meteo simulati.
 *
 * ATTENZIONE: nella v0.1.0 il meteo esiste ESCLUSIVAMENTE in DEMO MODE ed e'
 * una simulazione visiva di una possibile integrazione futura. NOWCAST non e'
 * collegato a ROAD SENSE: non esistono API, connessioni o dipendenze.
 *
 * Le distanze sono molto maggiori di quelle degli eventi stradali: una buca si
 * annuncia a 200 m, una cella temporalesca ha senso annunciarla a chilometri.
 */
export const WEATHER = {
  /**
   * Quanto lontano si cerca l'incontro lungo la strada, in metri.
   * Su un anello urbano una cella "vicina" in linea d'aria puo' trovarsi a
   * chilometri di percorso: e' la distanza stradale che conta.
   */
  maxSearchM: 6000,
  /** Passo di campionamento della ricerca, m. Poi si raffina per bisezione. */
  searchStepM: 25,
  /** Oltre questo tempo previsto l'incontro e' troppo lontano per interessare, s. */
  maxEtaSec: 600,
  /** Sotto questa velocita' non si prevede nulla: da fermi non si arriva. */
  minSpeedMps: 2,
  /**
   * Costante di tempo con cui si livella la velocita' usata per il tempo
   * previsto, in secondi. Il tempo di arrivo risponde al ritmo di marcia, non
   * all'accelerata del momento: dividendo per la velocita' istantanea il
   * testo saltava fra "circa 3 min" e "circa 5 min" a ogni secondo.
   */
  speedSmoothingSec: 30,
  /**
   * Il tempo mostrato cambia solo se la stima si sposta di almeno questo
   * valore, in secondi. Evita che l'arrotondamento al minuto oscilli attorno
   * a una soglia.
   */
  etaDeadbandSec: 20,
  /**
   * Soglie di distanza stradale che fanno ri-annunciare la stessa cella.
   * L'avviso torna quando la situazione cambia davvero, invece di restare
   * fisso sullo schermo o di ripetersi a caso.
   */
  bandsM: [3000, 1500, 700] as readonly number[],
  /**
   * Collegamento a NOWCAST: sola lettura, nessun parametro, nessuna
   * credenziale. La posizione di chi guida non lascia il dispositivo.
   */
  nowcast: {
    url: 'https://nowcast.pezzalihub.app/api/road-alerts',
    timeoutMs: 5000,
    /**
     * Intervallo fra due richieste, ms.
     *
     * Cinque minuti non sono arbitrari: il cono di NOWCAST ha passo 5 minuti
     * ed e' costruito su frame radar della stessa cadenza. Chiedere piu'
     * spesso non produce dati nuovi, produce solo carico su un server che
     * oggi riceve ogni richiesta - la cache della rete di distribuzione NON
     * e' attiva su questo percorso (misurato: cf-cache-status DYNAMIC).
     */
    pollMs: 300_000,
    /** Sfasamento casuale, ms: evita che tutti i dispositivi chiamino insieme. */
    jitterMs: 30_000,
    /** Attesa crescente dopo richieste fallite, ms. */
    backoffMs: [300_000, 600_000, 1_200_000] as readonly number[],
  },
  /** Durata di visualizzazione dell'avviso, ms. */
  displayMs: 14_000,
  /** Non ripetere la stessa cella nella stessa fascia prima di questo tempo, ms. */
  cooldownMs: 30_000,
  /**
   * Intervallo minimo fra due avvisi meteo QUALSIASI.
   * Senza questo, appena scade un avviso ne parte subito un altro e la mappa
   * diventa un bollettino: il meteo deve restare un contorno.
   */
  minGapMs: 20_000,
  /**
   * Raggio entro cui un evento stradale viene considerato correlato alla
   * cella. E' il cuore dell'idea: due sorgenti indipendenti che indicano lo
   * stesso pericolo nello stesso punto.
   */
  correlationRadiusM: 700,
  /**
   * Cadenza con cui la demo avanza l'orologio delle celle, ms.
   * E' l'UNICO orologio: alimenta sia il disegno sulla mappa sia la
   * previsione dell'incontro. Cinque aggiornamenti al secondo bastano per una
   * deriva di pochi metri al secondo e restano leggeri su uno smartphone.
   */
  demoTickMs: 200,
  /** Durata di un ciclo di pulsazione del bordo e di raffica, ms. */
  animationCycleMs: 3500,
} as const;

// ---------------------------------------------------------------------------
// STORAGE
// ---------------------------------------------------------------------------
export const STORAGE = {
  eventsKey: 'roadsense.events.v1',
  eventsKeyDemo: 'roadsense.events.demo.v1',
  anonIdKey: 'roadsense.anon.v1',
  settingsKey: 'roadsense.settings.v1',
  /** Tetto agli eventi conservati localmente. */
  maxEvents: 3000,
} as const;
