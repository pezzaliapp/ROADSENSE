/**
 * ROAD SENSE - vocabolario del parser vocale italiano.
 *
 * Tenuto separato dal parser perche' e' la parte che cambiera' piu' spesso:
 * aggiungere un sinonimo deve essere una riga, non una modifica alla logica.
 *
 * REGOLA CHE GOVERNA TUTTO IL FILE: si riconosce solo cio' che viene DETTO.
 * Nessuna voce di questo vocabolario deve introdurre un attributo che chi
 * parla non ha pronunciato.
 */

import type { HazardSubject, HazardState, RoadLane } from '../core/types';

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
