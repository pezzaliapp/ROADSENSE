/**
 * ROAD SENSE - vocabolario vocale italiano: UNICA FONTE SEMANTICA.
 *
 * Questo file e' l'origine di due cose che prima vivevano separate:
 *
 *   1. cio' che il PARSER sa interpretare  (RULES + i vocabolari sotto)
 *   2. cio' che il DECODER sa pronunciare  (`grammar.ts` lo DERIVA da qui)
 *
 * Erano due elenchi indipendenti, e divergevano. Il parser conosceva 39
 * pericoli; la grammatica Vosk ne ammetteva quattro. Le altre trentacinque
 * categorie erano codice irraggiungibile: nessuna frase poteva attivarle,
 * perche' il decoder non poteva produrne le parole.
 *
 * Ora la grammatica si calcola da queste strutture. Aggiungere un sinonimo qui
 * lo rende pronunciabile nello stesso commit: la divergenza non e' piu'
 * possibile per costruzione, non per disciplina.
 *
 * REGOLA CHE GOVERNA TUTTO IL FILE: si riconosce solo cio' che viene DETTO.
 * Nessuna voce di questo vocabolario deve introdurre un attributo che chi
 * parla non ha pronunciato.
 */

import type { HazardSubject, HazardState, RoadLane } from '../core/types';
import type { HazardType } from '../hazard/taxonomy';

/** Normalizza una frase: minuscole, senza accenti, senza punteggiatura. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Soggetti, con i sinonimi che si usano davvero parlando. */
export const SUBJECTS: ReadonlyArray<{ subject: HazardSubject; words: readonly string[] }> = [
  { subject: 'truck', words: ['camion', 'autocarro', 'tir', 'autoarticolato', 'bilico', 'mezzo pesante', 'autotreno'] },
  { subject: 'car', words: ['auto', 'automobile', 'macchina', 'vettura', 'autovettura'] },
  { subject: 'motorcycle', words: ['moto', 'motociclo', 'motociclista', 'scooter'] },
  { subject: 'bicycle', words: ['bici', 'bicicletta', 'ciclista'] },
  { subject: 'person', words: ['uomo', 'donna', 'persona', 'pedone', 'bambino', 'gente'] },
  { subject: 'animal', words: ['animale', 'animali', 'cane', 'cinghiale', 'cinghiali', 'cervo', 'capriolo', 'mucca', 'mucche', 'pecore', 'gregge', 'mandria', 'cavallo'] },
  { subject: 'vehicle', words: ['veicolo', 'mezzo'] },
];

/** Stati, riconosciuti solo se pronunciati. */
export const STATES: ReadonlyArray<{ state: HazardState; words: readonly string[] }> = [
  { state: 'broken_down', words: ['in avaria', 'avaria', 'in panne', 'guasto', 'guasta', 'rotto', 'rotta'] },
  { state: 'wrong_way', words: ['contromano', 'contro mano', 'senso vietato', 'senso contrario'] },
  { state: 'stopped', words: ['fermo', 'ferma', 'fermi', 'ferme', 'in sosta', 'arrestato'] },
  { state: 'blocking', words: ['blocca', 'bloccata', 'bloccato', 'di traverso'] },
  { state: 'moving', words: ['in movimento', 'che procede', 'in marcia'] },
];

/**
 * Corsie. Nessuna deduzione: se la frase non nomina la corsia, il campo resta
 * vuoto. "Auto ferma" non diventa mai "auto ferma in prima corsia".
 */
export const LANES: ReadonlyArray<{ lane: RoadLane; words: readonly string[] }> = [
  { lane: 'emergency_lane', words: ['corsia di emergenza', 'corsia demergenza', 'piazzola di emergenza'] },
  { lane: 'overtaking_lane', words: ['corsia di sorpasso', 'corsia sorpasso'] },
  { lane: 'driving_lane', words: ['corsia di marcia', 'corsia marcia'] },
  { lane: 'central_lane', words: ['corsia centrale', 'corsia di centro'] },
  { lane: 'fifth_lane', words: ['quinta corsia'] },
  { lane: 'fourth_lane', words: ['quarta corsia'] },
  { lane: 'third_lane', words: ['terza corsia'] },
  { lane: 'second_lane', words: ['seconda corsia'] },
  { lane: 'first_lane', words: ['prima corsia'] },
  { lane: 'roadside', words: ['bordo strada', 'sul bordo', 'banchina'] },
  { lane: 'carriageway', words: ['carreggiata'] },
];

/**
 * Parole che indicano un pericolo senza identificarlo.
 * Servono a produrre `unknown_hazard` invece di scartare la frase: meglio
 * registrare "qualcosa di pericoloso" che perdere la segnalazione.
 */
export const HAZARD_HINTS: readonly string[] = [
  'pericolo',
  'pericoloso',
  'pericolosa',
  'attenzione',
  'problema',
  'strano',
  'brutto',
  'rischio',
];

export interface Rule {
  hazard: HazardType;
  /**
   * Tutti i gruppi devono trovare una corrispondenza: ogni gruppo e' un
   * elenco di alternative. Cosi' "camion contromano" richiede sia il mezzo
   * sia la condizione, senza dipendere dall'ordine delle parole.
   */
  all: readonly (readonly string[])[];
  subject?: HazardSubject;
  state?: HazardState;
}

/**
 * Regole in ordine di specificita': la prima che corrisponde vince.
 * "camion contromano" deve battere "contromano" generico, e "strada
 * allagata" deve battere "acqua".
 */
export const RULES: readonly Rule[] = [
  // --- contromano (massima specificita': cambia la categoria) --------------
  { hazard: 'wrong_way_truck', all: [['camion', 'autocarro', 'tir', 'autoarticolato', 'bilico', 'mezzo pesante', 'autotreno'], ['contromano', 'contro mano', 'senso contrario', 'senso vietato']], subject: 'truck', state: 'wrong_way' },
  { hazard: 'wrong_way_car', all: [['auto', 'automobile', 'macchina', 'vettura', 'veicolo', 'moto'], ['contromano', 'contro mano', 'senso contrario', 'senso vietato']], subject: 'car', state: 'wrong_way' },
  { hazard: 'wrong_way_car', all: [['contromano', 'contro mano']] },

  // --- persone e animali --------------------------------------------------
  { hazard: 'herd_on_road', all: [['gregge', 'mandria', 'pecore', 'mucche']], subject: 'animal' },
  { hazard: 'animals_on_road', all: [['animale', 'animali', 'cane', 'cinghiale', 'cinghiali', 'cervo', 'capriolo', 'mucca', 'cavallo']], subject: 'animal' },
  { hazard: 'cyclist_hazard', all: [['ciclista', 'bici', 'bicicletta']], subject: 'bicycle' },
  { hazard: 'person_on_road', all: [['uomo', 'donna', 'persona', 'pedone', 'bambino', 'gente']], subject: 'person' },

  // --- veicoli ------------------------------------------------------------
  { hazard: 'lost_load', all: [['carico perso', 'perso il carico', 'carico sulla strada', 'carico caduto']] },
  { hazard: 'heavy_vehicle_in_difficulty', all: [['camion', 'autocarro', 'tir', 'mezzo pesante', 'autoarticolato'], ['in difficolta', 'in salita', 'bloccato', 'di traverso']], subject: 'truck' },
  { hazard: 'broken_down_vehicle', all: [['in avaria', 'avaria', 'in panne', 'guasto', 'guasta', 'rotto', 'rotta']], state: 'broken_down' },
  // "pericoloso" da solo NON basta: "c'e' qualcosa di pericoloso" non parla
  // di un veicolo. Serve un mezzo nominato, oppure un'espressione che non
  // lasci dubbi.
  {
    hazard: 'dangerous_vehicle_behaviour',
    all: [
      ['auto', 'automobile', 'macchina', 'vettura', 'camion', 'autocarro', 'tir', 'veicolo', 'mezzo', 'moto', 'furgone', 'guidatore', 'conducente'],
      ['pericoloso', 'pericolosa', 'zigzag', 'ubriaco', 'sbanda', 'sbandando', 'contromano pericoloso'],
    ],
  },
  { hazard: 'dangerous_vehicle_behaviour', all: [['guida pericolosa', 'zigzag', 'sbandando', 'ubriaco']] },
  { hazard: 'accident', all: [['incidente', 'scontro', 'tamponamento', 'schianto', 'sinistro']] },
  { hazard: 'stopped_vehicle', all: [['auto', 'automobile', 'macchina', 'vettura', 'camion', 'autocarro', 'tir', 'veicolo', 'mezzo', 'moto', 'furgone'], ['fermo', 'ferma', 'fermi', 'ferme', 'in sosta', 'arrestato']] },

  // --- traffico ed eventi -------------------------------------------------
  { hazard: 'blocked_toll_booth', all: [['casello', 'barriera', 'pedaggio'], ['bloccato', 'bloccata', 'chiuso', 'chiusa', 'coda', 'fermo']] },
  { hazard: 'blocked_toll_booth', all: [['casello bloccato']] },
  { hazard: 'demonstration', all: [['manifestazione', 'corteo', 'protesta', 'presidio']] },
  { hazard: 'procession', all: [['processione']] },
  { hazard: 'event_on_road', all: [['evento', 'gara', 'corsa ciclistica', 'mercato']] },
  { hazard: 'road_closed', all: [['strada chiusa', 'chiusa la strada', 'strada sbarrata']] },
  { hazard: 'blocked_road', all: [['strada bloccata', 'carreggiata bloccata', 'bloccata la strada']] },
  { hazard: 'sudden_queue', all: [['coda', 'ingorgo', 'incolonnamento', 'traffico fermo', 'rallentamento']] },
  { hazard: 'roadworks', all: [['lavori', 'cantiere', 'lavori in corso']] },

  // --- strada -------------------------------------------------------------
  { hazard: 'landslide', all: [['frana', 'smottamento']] },
  { hazard: 'fallen_tree', all: [['albero caduto', 'albero sulla strada', 'ramo caduto', 'albero in strada']] },
  { hazard: 'flooding', all: [['allagata', 'allagato', 'allagamento', 'strada allagata']] },
  { hazard: 'water_on_road', all: [['acqua', 'pozzanghera', 'pozza']] },
  { hazard: 'ice', all: [['ghiaccio', 'ghiacciata', 'ghiacciato']] },
  { hazard: 'mud', all: [['fango', 'fangosa', 'fangoso']] },
  { hazard: 'debris', all: [['detriti', 'sassi', 'pietre', 'vetri', 'rottami']] },
  { hazard: 'damaged_road', all: [['strada danneggiata', 'asfalto rotto', 'strada rovinata', 'cedimento']] },
  { hazard: 'pothole', all: [['buca', 'buche']] },
  { hazard: 'road_surface_anomaly', all: [['fondo irregolare', 'sconnesso', 'sconnessa', 'dissestata', 'dissestato', 'asfalto brutto']] },
  { hazard: 'generic_obstacle', all: [['ostacolo', 'oggetto sulla strada', 'oggetto in strada', 'oggetto sulla carreggiata', 'oggetto in carreggiata']] },

  // --- meteo --------------------------------------------------------------
  { hazard: 'hail', all: [['grandine', 'grandina']] },
  { hazard: 'possible_downburst', all: [['downburst', 'bufera', 'tempesta', 'burrasca', 'tromba d aria']] },
  { hazard: 'violent_gusts', all: [['raffiche', 'vento forte', 'raffica']] },
  { hazard: 'sudden_fog', all: [['nebbia']] },
  { hazard: 'snow', all: [['neve', 'nevica']] },
  // "Rischio ghiaccio" e' meteo, non e' ghiaccio visto sull'asfalto: chi dice
  // "gelata" sta segnalando la condizione, non una lastra. Era l'unico pericolo
  // della tassonomia senza alcuna regola, quindi irraggiungibile da qualunque
  // frase, non solo dalla voce.
  { hazard: 'ice_weather', all: [['gelata', 'gelo', 'brina']] },
  { hazard: 'intense_rain', all: [['pioggia', 'diluvio', 'temporale', 'acquazzone']] },
];

/**
 * Parole che il DECODER deve poter pronunciare ma che non cambiano l'esito.
 *
 * Servono per una ragione puramente acustica: la grammatica Vosk limita cio'
 * che il decoder puo' emettere, quindi senza "in" nessuno potrebbe trascrivere
 * "incidente in seconda corsia" - e la corsia andrebbe perduta insieme alla
 * preposizione. Sono in grammatica per rendere dicibile la frase intera.
 *
 * NON sono interpretate. Nessuna regola scatta su di esse, e in particolare gli
 * aggettivi di intensita' NON producono severita': la gravita' resta una
 * proprieta' della categoria di pericolo, come spiega `parser.ts`. "Grandine
 * forte" e "grandine" producono lo stesso evento; la differenza e' che la prima
 * ora si puo' dire.
 *
 * E' anche la parte a rischio piu' basso dell'intero vocabolario: essendo
 * inerti, un loro falso riconoscimento non puo' generare una segnalazione.
 */
export const GRAMMAR_ONLY: readonly string[] = [
  // preposizioni e articoli che tengono insieme le frasi
  'in', 'su', 'sul', 'sulla', 'sulle', 'a', 'alla', 'della', 'di', 'e',
  'la', 'il', 'lo', 'un', 'una', 'c', 'ce',
  // posizione, quando viene detta a parole invece che per corsia
  'destra', 'sinistra', 'centro', 'lato',
  // intensita': si sentono continuamente, non cambiano nulla
  'grande', 'grossa', 'grosso', 'enorme', 'profonda', 'profondo',
  'piccola', 'piccolo', 'lieve', 'grave', 'leggera', 'leggero',
  'forti', 'molto', 'intensa', 'intenso', 'fitta',
];
