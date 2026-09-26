/**
 * ROAD SENSE - COSA POSSO DIRE: il catalogo di cio' che si puo' segnalare.
 *
 * PERCHE' ESISTE
 *
 * ROAD SENSE capisce 39 pericoli diversi, e fino a ieri l'unico modo di
 * scoprirlo era leggere il codice. Chi apriva l'applicazione poteva intuire
 * "buca" e nient'altro: tutto il resto era una capacita' reale e invisibile.
 *
 * LA REGOLA CHE GOVERNA QUESTO FILE
 *
 * Ogni frase qui dentro dichiara il pericolo che DEVE produrre. Non e' una
 * didascalia: e' un contratto, e `voiceGuide.test.ts` lo verifica passando
 * ogni singola frase al parser VERO. Se una frase smettesse di funzionare, o
 * producesse un pericolo diverso, il test fallirebbe.
 *
 * E' l'unico modo di evitare il difetto peggiore per una guida: promettere a
 * chi guida parole che il sistema non capisce. Meglio mostrare meno che
 * mentire.
 *
 * Il test verifica anche il contrario - che nessuna capacita' vocale reale
 * resti fuori da questo elenco - cosi' aggiungere un pericolo al lessico
 * senza raccontarlo qui rompe la build.
 */

import type { RoadLane } from '../core/types';
import type { HazardType } from '../hazard/taxonomy';

export interface GuideItem {
  /** Come lo direbbe una persona. E' anche la frase che il test prova. */
  say: string;
  /** Altri modi realmente accettati per la stessa cosa. */
  also?: readonly string[];
  /** Il pericolo che il parser deve riconoscere. Contratto verificato. */
  hazard: HazardType;
}

export interface GuideCategory {
  id: string;
  title: string;
  items: readonly GuideItem[];
}

/**
 * Le dieci parole della prima schermata.
 *
 * Scelte perche' sono quelle che vengono in mente per prime a chi guida, non
 * perche' coprono la tassonomia: coprire e' compito del catalogo. Qui conta
 * capire in tre secondi che si puo' parlare.
 */
export const FAVOURITES: readonly string[] = [
  'Buca',
  'Incidente',
  'Pericolo',
  'Coda',
  'Ostacolo',
  'Grandine',
  'Neve',
  'Bufera',
  'Acqua',
  'Ghiaccio',
];

/**
 * Categorie pensate come le pensa chi guida, non come le organizza il codice:
 * "acqua, ghiaccio e fango" sta insieme perche' fa scivolare, anche se
 * internamente sono famiglie diverse.
 */
export const VOICE_GUIDE: readonly GuideCategory[] = [
  {
    id: 'fondo',
    title: 'BUCHE E FONDO STRADALE',
    items: [
      { say: 'Buca', also: ['Buche'], hazard: 'pothole' },
      {
        say: 'Strada dissestata',
        also: ['Strada sconnessa', 'Fondo irregolare'],
        hazard: 'road_surface_anomaly',
      },
      { say: 'Strada danneggiata', also: ['Strada rovinata'], hazard: 'damaged_road' },
    ],
  },
  {
    id: 'ostacoli',
    title: 'OSTACOLI SULLA STRADA',
    items: [
      { say: 'Ostacolo', also: ['Oggetto sulla carreggiata'], hazard: 'generic_obstacle' },
      { say: 'Detriti', also: ['Sassi', 'Vetri'], hazard: 'debris' },
      { say: 'Albero caduto', also: ['Ramo caduto'], hazard: 'fallen_tree' },
      { say: 'Carico perso', also: ['Carico caduto'], hazard: 'lost_load' },
    ],
  },
  {
    id: 'scivoloso',
    title: 'ACQUA, GHIACCIO E FANGO',
    items: [
      { say: 'Acqua', also: ['Pozzanghera'], hazard: 'water_on_road' },
      { say: 'Allagamento', also: ['Strada allagata'], hazard: 'flooding' },
      { say: 'Ghiaccio', also: ['Strada ghiacciata'], hazard: 'ice' },
      { say: 'Fango', hazard: 'mud' },
    ],
  },
  {
    id: 'interrotta',
    title: 'STRADA INTERROTTA',
    items: [
      { say: 'Strada chiusa', also: ['Strada sbarrata'], hazard: 'road_closed' },
      { say: 'Strada bloccata', also: ['Carreggiata bloccata'], hazard: 'blocked_road' },
      { say: 'Frana', also: ['Smottamento'], hazard: 'landslide' },
      { say: 'Lavori', also: ['Cantiere'], hazard: 'roadworks' },
    ],
  },
  {
    id: 'traffico',
    title: 'TRAFFICO',
    items: [
      { say: 'Incidente', also: ['Tamponamento', 'Scontro'], hazard: 'accident' },
      { say: 'Coda', also: ['Ingorgo', 'Rallentamento'], hazard: 'sudden_queue' },
      { say: 'Casello bloccato', also: ['Casello chiuso'], hazard: 'blocked_toll_booth' },
    ],
  },
  {
    id: 'veicoli',
    title: 'VEICOLI',
    items: [
      { say: 'Auto ferma', also: ['Veicolo fermo'], hazard: 'stopped_vehicle' },
      { say: 'Auto in avaria', also: ['In panne'], hazard: 'broken_down_vehicle' },
      { say: 'Auto contromano', also: ['Veicolo contromano'], hazard: 'wrong_way_car' },
      { say: 'Camion contromano', also: ['Tir contromano'], hazard: 'wrong_way_truck' },
      {
        say: 'Guida pericolosa',
        also: ['Auto che sbanda'],
        hazard: 'dangerous_vehicle_behaviour',
      },
      { say: 'Camion in difficoltà', hazard: 'heavy_vehicle_in_difficulty' },
    ],
  },
  {
    id: 'persone',
    title: 'PERSONE E ANIMALI',
    items: [
      { say: 'Persona sulla strada', also: ['Pedone'], hazard: 'person_on_road' },
      { say: 'Ciclista', also: ['Bicicletta'], hazard: 'cyclist_hazard' },
      { say: 'Animale sulla strada', also: ['Cinghiale', 'Cane'], hazard: 'animals_on_road' },
      { say: 'Gregge', also: ['Mandria'], hazard: 'herd_on_road' },
    ],
  },
  {
    id: 'meteo',
    title: 'METEO',
    items: [
      { say: 'Grandine', hazard: 'hail' },
      { say: 'Neve', hazard: 'snow' },
      { say: 'Pioggia intensa', also: ['Temporale', 'Acquazzone'], hazard: 'intense_rain' },
      { say: 'Vento forte', also: ['Raffiche'], hazard: 'violent_gusts' },
      {
        say: 'Bufera',
        also: ['Tempesta', 'Burrasca', "Tromba d'aria"],
        hazard: 'possible_downburst',
      },
      { say: 'Nebbia', hazard: 'sudden_fog' },
      { say: 'Gelata', also: ['Gelo', 'Brina'], hazard: 'ice_weather' },
    ],
  },
  {
    id: 'raduni',
    title: 'RADUNI ED EVENTI',
    items: [
      { say: 'Manifestazione', also: ['Corteo'], hazard: 'demonstration' },
      { say: 'Processione', hazard: 'procession' },
      { say: 'Gara', also: ['Mercato'], hazard: 'event_on_road' },
    ],
  },
  {
    id: 'altro',
    title: 'SE NON SAI COME CHIAMARLO',
    items: [{ say: 'Pericolo', also: ['Attenzione'], hazard: 'unknown_hazard' }],
  },
];

/**
 * Si puo' dire di piu' della sola categoria: la corsia, se la si nomina, viene
 * registrata. Non viene MAI dedotta, quindi dirla e' l'unico modo di averla.
 */
export const PRECISE_EXAMPLES: readonly { say: string; hazard: HazardType; lane: RoadLane }[] = [
  { say: 'Incidente in prima corsia', hazard: 'accident', lane: 'first_lane' },
  { say: 'Auto ferma in seconda corsia', hazard: 'stopped_vehicle', lane: 'second_lane' },
  { say: 'Ostacolo in terza corsia', hazard: 'generic_obstacle', lane: 'third_lane' },
  { say: 'Buca in quarta corsia', hazard: 'pothole', lane: 'fourth_lane' },
  { say: 'Detriti in quinta corsia', hazard: 'debris', lane: 'fifth_lane' },
  {
    say: 'Veicolo fermo in corsia di emergenza',
    hazard: 'stopped_vehicle',
    lane: 'emergency_lane',
  },
  { say: 'Camion fermo in corsia di sorpasso', hazard: 'stopped_vehicle', lane: 'overtaking_lane' },
  { say: 'Buca in banchina', hazard: 'pothole', lane: 'roadside' },
];
