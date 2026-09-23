/**
 * ROAD SENSE - modello dati condiviso.
 *
 * PRINCIPIO: si monitora LA STRADA, NON LE PERSONE.
 * Nessun tipo definito qui contiene o puo' contenere identita' reali:
 * niente nome, email, telefono, targa, VIN, tracce GPS complete.
 */

/** Categorie di evento stradale gestite da ROAD SENSE. */
import type { HazardType } from '../hazard/taxonomy';

export const EVENT_TYPES = [
  'pothole', // buca
  'rough', // fondo irregolare / sconnesso (tipicamente automatico)
  'obstacle', // ostacolo sulla carreggiata
  'water', // acqua / allagamento
  'slippery', // fondo scivoloso (ghiaccio, gasolio, foglie)
  'accident', // incidente
  'roadworks', // lavori in corso
  // Famiglie introdotte con la tassonomia ZERO TOUCH. Sono additive: gli
  // engine esistenti continuano a funzionare senza modifiche, perche'
  // lavorano sulla famiglia e non sul pericolo specifico.
  'vehicle', // veicolo fermo, in avaria o dal comportamento pericoloso
  'wrong_way', // veicolo contromano
  'person', // persona o ciclista sulla carreggiata
  'animal', // animali sulla strada
  'blocked', // carreggiata interrotta: frana, strada chiusa
  'queue', // coda improvvisa, casello bloccato
  'gathering', // manifestazione, processione, evento sulla strada
  'weather', // fenomeno meteorologico segnalato da chi guida
  'other', // altro pericolo
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** 1 = lieve, 2 = medio, 3 = grave. */
export type Severity = 1 | 2 | 3;

/**
 * Origine del dato. Utile per pesare la confidenza, non per identificare
 * l'utente.
 *
 *   auto    rilevato dai sensori del dispositivo
 *   manual  scelto a mano dal pulsante SEGNALA
 *   voice   dettato a voce da chi guida, senza toccare il telefono
 */
export type EventSource = 'auto' | 'manual' | 'voice';

/**
 * Dati tecnici minimi allegati a un rilevamento automatico.
 * Servono a valutare la plausibilita' del rilevamento, non a ricostruire un viaggio.
 * Tutti i campi sono opzionali: un sensore mancante non deve generare errori.
 */
export interface EventSensorData {
  /** Picco di accelerazione verticale compensata, m/s^2. */
  peakVerticalAccel?: number;
  /** Durata dell'impulso, ms. */
  impulseMs?: number;
  /** Velocita' al momento del rilevamento, m/s (arrotondata). */
  speedMps?: number;
  /** Rumore di fondo (RMS) prima dell'impulso, m/s^2. */
  baselineRms?: number;
}

/**
 * Evento stradale.
 *
 * `reporterId` e' un identificatore ANONIMO A ROTAZIONE (vedi anonId.ts):
 * serve solo a deduplicare e a contare segnalatori indipendenti.
 * Non e' collegabile a una persona e cambia periodicamente.
 */
export interface RoadEvent {
  /** UUID generato sul client. */
  id: string;
  /** Latitudine WGS84, arrotondata a ~5 decimali (circa 1 m). */
  lat: number;
  /** Longitudine WGS84, arrotondata a ~5 decimali. */
  lon: number;
  /** Epoch ms del rilevamento. */
  ts: number;
  type: EventType;
  severity: Severity;
  source: EventSource;
  /** Confidenza del singolo rilevamento (0..1), non della zona. */
  confidence: number;
  /**
   * Direzione di marcia al momento del rilevamento, gradi 0..359 (nord = 0).
   * `null` se non determinabile. Serve a non allertare chi va nel senso opposto.
   */
  heading: number | null;
  /** Identificatore anonimo temporaneo del segnalatore. */
  reporterId: string;
  sensorData?: EventSensorData;

  /**
   * Classificazione fine del pericolo, quando disponibile.
   * `type` resta la famiglia su cui lavorano gli engine; `hazard` dice che
   * cosa e' stato osservato davvero. I rilevamenti automatici dei sensori non
   * lo valorizzano: un accelerometro non sa distinguere una buca da un tombino.
   */
  hazard?: HazardType;
  /** Soggetto coinvolto, se la segnalazione lo nomina esplicitamente. */
  subject?: HazardSubject;
  /** Stato del soggetto, se la segnalazione lo nomina esplicitamente. */
  state?: HazardState;
  /** Corsia, SOLO se pronunciata. Non viene mai dedotta. */
  lane?: RoadLane;
  /**
   * Trascrizione grezza della frase, conservata per poter capire perche' il
   * parser ha deciso cosi'. Non lascia mai il dispositivo: la validazione
   * lato backend scarta ogni campo non previsto.
   */
  rawTranscript?: string;

  /** true se generato in DEMO MODE: non viene mai inviato al backend. */
  demo?: boolean;
}

/**
 * Cluster di eventi vicini e coerenti: e' cio' che viene mostrato in mappa
 * e cio' su cui si basano gli alert.
 */
export interface EventCluster {
  id: string;
  lat: number;
  lon: number;
  type: EventType;
  severity: Severity;
  /** Confidenza aggregata della zona (0..1). */
  confidence: number;
  /** Numero di rilevamenti che compongono il cluster. */
  count: number;
  /** Numero di segnalatori anonimi distinti. */
  reporters: number;
  /** Epoch ms del rilevamento piu' recente. */
  lastTs: number;
  /** Direzione media di marcia dei rilevamenti, o null. */
  heading: number | null;
  /** Epoch ms di scadenza (TTL della categoria applicato al rilevamento piu' recente). */
  expiresAt: number;
  demo?: boolean;
}

/** Soggetto nominato in una segnalazione. */
export type HazardSubject =
  | 'car'
  | 'truck'
  | 'motorcycle'
  | 'bicycle'
  | 'person'
  | 'animal'
  | 'vehicle';

/** Stato del soggetto, quando pronunciato. */
export type HazardState = 'stopped' | 'broken_down' | 'moving' | 'wrong_way' | 'blocking';

/**
 * Corsia o posizione trasversale.
 * Viene valorizzata SOLO se pronunciata: dedurla sarebbe inventare.
 */
export type RoadLane =
  | 'first_lane'
  | 'second_lane'
  | 'third_lane'
  | 'driving_lane'
  | 'central_lane'
  | 'overtaking_lane'
  | 'emergency_lane'
  | 'carriageway'
  | 'roadside';

/** Livelli qualitativi derivati dalla confidenza aggregata. */
export type ConfidenceLevel = 'possible' | 'probable' | 'confirmed';

/** Campione normalizzato prodotto da un SensorProvider. */
export interface SensorSample {
  /** Epoch ms. */
  ts: number;
  /**
   * Accelerazione verticale (lungo la gravita'), m/s^2, gia' compensata
   * rispetto all'orientamento del telefono e priva della componente statica g.
   * `null` se l'accelerometro non e' disponibile.
   */
  verticalAccel: number | null;
  /** Modulo dell'accelerazione lineare totale, m/s^2. `null` se non disponibile. */
  totalAccel: number | null;
  /** Modulo della velocita' angolare, deg/s. `null` se il giroscopio manca. */
  rotationRate: number | null;
}

/** Posizione normalizzata prodotta da un SensorProvider. */
export interface GeoSample {
  ts: number;
  lat: number;
  lon: number;
  /** Precisione orizzontale in metri, se nota. */
  accuracyM: number | null;
  /** Velocita' in m/s, se nota. */
  speedMps: number | null;
  /** Direzione 0..359, se nota. */
  heading: number | null;
}

/** Disponibilita' effettiva dei sensori: guida il progressive enhancement. */
export interface SensorCapabilities {
  geolocation: boolean;
  accelerometer: boolean;
  gyroscope: boolean;
  orientation: boolean;
  /** true se il provider richiede un permesso esplicito da gesto utente (iOS). */
  needsMotionPermission: boolean;
}

/** Stato di salute mostrato nella status bar. */
export interface SystemStatus {
  gps: 'ok' | 'weak' | 'off' | 'denied';
  sensors: 'ok' | 'partial' | 'off';
  network: 'online' | 'offline' | 'local';
  /**
   * Riconoscimento vocale. Gli stati sono distinti perche' significano cose
   * diverse a chi guarda:
   *   unsupported  il browser non puo'
   *   off          si puo', ma non e' stato attivato
   *   ready        attivato, entrera' in ascolto con START
   *   listening    in ascolto adesso
   */
  voice:
    | 'unsupported'
    | 'off'
    /** In attesa di un consenso esplicito all'elaborazione remota dell'audio. */
    | 'consent'
    | 'ready'
    | 'listening'
    | 'restarting'
    | 'denied'
    | 'error';
}
