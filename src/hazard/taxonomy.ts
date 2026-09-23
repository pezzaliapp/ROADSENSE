/**
 * ROAD SENSE - tassonomia dei pericoli stradali.
 *
 * E' un RAFFINAMENTO del modello esistente, non una sua sostituzione.
 * `EventType` resta la famiglia grossolana su cui lavorano gli engine gia'
 * collaudati - TTL, raggio di aggregazione, icone, ConfidenceEngine - mentre
 * `HazardType` descrive con precisione che cosa e' stato osservato.
 *
 * Ogni pericolo appartiene a esattamente una famiglia: nessun motore esistente
 * deve essere modificato per capire un pericolo nuovo.
 */

import type { EventType } from '../core/types';

export const HAZARD_TYPES = [
  // --- strada -------------------------------------------------------------
  'pothole',
  'road_surface_anomaly',
  'water_on_road',
  'flooding',
  'ice',
  'mud',
  'landslide',
  'debris',
  'fallen_tree',
  'generic_obstacle',
  'damaged_road',
  'blocked_road',

  // --- veicoli ------------------------------------------------------------
  'accident',
  'broken_down_vehicle',
  'stopped_vehicle',
  'dangerous_vehicle_behaviour',
  'wrong_way_car',
  'wrong_way_truck',
  'lost_load',
  'heavy_vehicle_in_difficulty',

  // --- persone e animali --------------------------------------------------
  'person_on_road',
  'cyclist_hazard',
  'animals_on_road',
  'herd_on_road',

  // --- traffico ed eventi -------------------------------------------------
  'roadworks',
  'sudden_queue',
  'blocked_toll_booth',
  'road_closed',
  'demonstration',
  'procession',
  'event_on_road',

  // --- meteo --------------------------------------------------------------
  'hail',
  'intense_rain',
  'violent_gusts',
  'possible_downburst',
  'sudden_fog',
  'snow',
  'ice_weather',

  /**
   * Frase compresa come pericolo ma non classificabile con sufficiente
   * sicurezza. Esiste di proposito: e' meglio registrare "qualcosa di
   * pericoloso, non identificato" che indovinare una categoria sbagliata.
   */
  'unknown_hazard',
] as const;

export type HazardType = (typeof HAZARD_TYPES)[number];

/** Raggruppamenti usati solo per leggibilita' e documentazione. */
export type HazardCategory = 'road' | 'vehicle' | 'people' | 'traffic' | 'weather' | 'unknown';

/**
 * Urgenza semantica del pericolo.
 *
 * NON E' LA CONFIDENZA, e la distinzione e' sostanziale: un veicolo
 * contromano e' CRITICAL fin dalla prima segnalazione, ma resta NON
 * CONFERMATO finche' un secondo segnalatore indipendente non concorda.
 * La priorita' dice "quanto e' grave se e' vero"; la confidenza dice
 * "quanto e' probabile che sia vero". Servono entrambe.
 */
export type HazardPriority = 'critical' | 'high' | 'medium';

interface HazardMeta {
  category: HazardCategory;
  /** Famiglia del modello esistente: decide TTL, aggregazione e icona. */
  family: EventType;
  priority: HazardPriority;
  /** Etichetta breve in italiano, usata a schermo e negli avvisi vocali. */
  label: string;
}

export const HAZARD_META: Record<HazardType, HazardMeta> = {
  // --- strada -------------------------------------------------------------
  pothole: { category: 'road', family: 'pothole', priority: 'medium', label: 'Buca' },
  road_surface_anomaly: { category: 'road', family: 'rough', priority: 'medium', label: 'Fondo irregolare' },
  water_on_road: { category: 'road', family: 'water', priority: 'high', label: 'Acqua sulla carreggiata' },
  flooding: { category: 'road', family: 'water', priority: 'high', label: 'Strada allagata' },
  ice: { category: 'road', family: 'slippery', priority: 'high', label: 'Ghiaccio' },
  mud: { category: 'road', family: 'slippery', priority: 'high', label: 'Fango' },
  landslide: { category: 'road', family: 'blocked', priority: 'critical', label: 'Frana' },
  debris: { category: 'road', family: 'obstacle', priority: 'high', label: 'Detriti' },
  fallen_tree: { category: 'road', family: 'obstacle', priority: 'critical', label: 'Albero caduto' },
  generic_obstacle: { category: 'road', family: 'obstacle', priority: 'high', label: 'Ostacolo' },
  damaged_road: { category: 'road', family: 'rough', priority: 'medium', label: 'Strada danneggiata' },
  blocked_road: { category: 'road', family: 'blocked', priority: 'critical', label: 'Strada bloccata' },

  // --- veicoli ------------------------------------------------------------
  accident: { category: 'vehicle', family: 'accident', priority: 'critical', label: 'Incidente' },
  broken_down_vehicle: { category: 'vehicle', family: 'vehicle', priority: 'high', label: 'Veicolo in avaria' },
  stopped_vehicle: { category: 'vehicle', family: 'vehicle', priority: 'medium', label: 'Veicolo fermo' },
  dangerous_vehicle_behaviour: { category: 'vehicle', family: 'vehicle', priority: 'high', label: 'Veicolo pericoloso' },
  wrong_way_car: { category: 'vehicle', family: 'wrong_way', priority: 'critical', label: 'Auto contromano' },
  wrong_way_truck: { category: 'vehicle', family: 'wrong_way', priority: 'critical', label: 'Camion contromano' },
  lost_load: { category: 'vehicle', family: 'obstacle', priority: 'high', label: 'Carico perso' },
  heavy_vehicle_in_difficulty: { category: 'vehicle', family: 'vehicle', priority: 'high', label: 'Mezzo pesante in difficolta' },

  // --- persone e animali --------------------------------------------------
  person_on_road: { category: 'people', family: 'person', priority: 'critical', label: 'Persona sulla carreggiata' },
  cyclist_hazard: { category: 'people', family: 'person', priority: 'high', label: 'Ciclista in pericolo' },
  animals_on_road: { category: 'people', family: 'animal', priority: 'high', label: 'Animali sulla strada' },
  herd_on_road: { category: 'people', family: 'animal', priority: 'high', label: 'Gregge sulla strada' },

  // --- traffico ed eventi -------------------------------------------------
  roadworks: { category: 'traffic', family: 'roadworks', priority: 'medium', label: 'Lavori in corso' },
  sudden_queue: { category: 'traffic', family: 'queue', priority: 'medium', label: 'Coda improvvisa' },
  blocked_toll_booth: { category: 'traffic', family: 'queue', priority: 'medium', label: 'Casello bloccato' },
  road_closed: { category: 'traffic', family: 'blocked', priority: 'critical', label: 'Strada chiusa' },
  demonstration: { category: 'traffic', family: 'gathering', priority: 'medium', label: 'Manifestazione' },
  procession: { category: 'traffic', family: 'gathering', priority: 'medium', label: 'Processione' },
  event_on_road: { category: 'traffic', family: 'gathering', priority: 'medium', label: 'Evento sulla strada' },

  // --- meteo --------------------------------------------------------------
  hail: { category: 'weather', family: 'weather', priority: 'high', label: 'Grandine' },
  intense_rain: { category: 'weather', family: 'weather', priority: 'medium', label: 'Pioggia intensa' },
  violent_gusts: { category: 'weather', family: 'weather', priority: 'high', label: 'Raffiche violente' },
  possible_downburst: { category: 'weather', family: 'weather', priority: 'high', label: 'Possibile downburst' },
  sudden_fog: { category: 'weather', family: 'weather', priority: 'high', label: 'Nebbia improvvisa' },
  snow: { category: 'weather', family: 'weather', priority: 'high', label: 'Neve' },
  ice_weather: { category: 'weather', family: 'slippery', priority: 'high', label: 'Rischio ghiaccio' },

  unknown_hazard: { category: 'unknown', family: 'other', priority: 'medium', label: 'Pericolo non identificato' },
};

/** Famiglia del modello esistente a cui il pericolo appartiene. */
export function hazardFamily(hazard: HazardType): EventType {
  return HAZARD_META[hazard].family;
}

/** Urgenza semantica. Indipendente dalla confidenza. */
export function hazardPriority(hazard: HazardType): HazardPriority {
  return HAZARD_META[hazard].priority;
}

/** Ordine di urgenza, dal piu' grave. */
export const PRIORITY_ORDER: Record<HazardPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};
