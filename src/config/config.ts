/**
 * ROAD SENSE - configurazione centralizzata.
 *
 * Tutte le soglie dell'euristica, i TTL e i parametri di alert stanno QUI.
 * Sono volutamente leggibili e modificabili senza toccare la logica.
 */

import type { EventType } from '../core/types';

export const APP = {
  name: 'ROAD SENSE',
  version: '0.1.0',
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
// MAPPA / TILE PROVIDER (sostituibile)
// ---------------------------------------------------------------------------
export const MAP = {
  /** Centro di fallback quando non c'e' posizione: Italia. */
  fallbackCenter: [41.9, 12.5] as [number, number],
  fallbackZoom: 6,
  followZoom: 17,
  minZoom: 4,
  maxZoom: 19,
} as const;

/**
 * Tile provider. Astratto per poter essere sostituito senza toccare la UI.
 * OpenStreetMap standard: uso moderato, nessun prefetch, attribution obbligatoria.
 */
export const TILE_PROVIDER = {
  id: 'osm',
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
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
