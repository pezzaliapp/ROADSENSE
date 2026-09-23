/**
 * ROAD SENSE - parser delle segnalazioni vocali in italiano.
 *
 * Funzione pura: riceve una trascrizione, restituisce cio' che la frase
 * afferma. Nessuna rete, nessuno stato, nessun accesso al browser. E'
 * deliberatamente il pezzo piu' testabile del sistema, perche' e' quello in
 * cui un errore sarebbe piu' insidioso.
 *
 * IL PRINCIPIO, E NON E' NEGOZIABILE
 * Si registra SOLO cio' che la frase dice davvero.
 *
 *   "auto in avaria in seconda corsia"  ->  veicolo in avaria, seconda corsia
 *   "auto ferma"                        ->  veicolo fermo, nessuna corsia
 *
 * Nel secondo caso non si deduce ne' l'avaria, ne' la corsia, ne' la gravita'.
 * Un'interpretazione creativa qui produrrebbe avvisi falsi a chi guida, che e'
 * il danno peggiore che ROAD SENSE possa fare.
 *
 * Per lo stesso motivo la SEVERITA' non viene mai inferita dalla frase: la
 * urgenza e' gia' espressa dalla priorita' della categoria, che e' una
 * proprieta' del tipo di pericolo e non di come e' stato raccontato.
 */

import { VOICE } from '../config/config';
import type { HazardState, HazardSubject, RoadLane } from '../core/types';
import type { HazardType } from '../hazard/taxonomy';
import { HAZARD_HINTS, LANES, normalize, STATES, SUBJECTS } from './lexicon';

export interface ParsedVoiceReport {
  hazard: HazardType;
  subject?: HazardSubject;
  state?: HazardState;
  lane?: RoadLane;
  /** Frase normalizzata su cui e' stata presa la decisione. */
  transcript: string;
}

/** Esito del parsing, con il motivo quando non produce nulla. */
export type VoiceParseResult =
  | { ok: true; report: ParsedVoiceReport }
  | { ok: false; reason: 'no-wake-word' | 'empty' | 'not-understood' };

interface Rule {
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
const RULES: readonly Rule[] = [
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
  { hazard: 'generic_obstacle', all: [['ostacolo', 'oggetto sulla strada', 'oggetto in strada']] },

  // --- meteo --------------------------------------------------------------
  { hazard: 'hail', all: [['grandine', 'grandina']] },
  { hazard: 'possible_downburst', all: [['downburst']] },
  { hazard: 'violent_gusts', all: [['raffiche', 'vento forte', 'raffica']] },
  { hazard: 'sudden_fog', all: [['nebbia']] },
  { hazard: 'snow', all: [['neve', 'nevica']] },
  { hazard: 'intense_rain', all: [['pioggia', 'diluvio', 'temporale', 'acquazzone']] },
];

/** true se una delle alternative compare nella frase come parola intera. */
function mentions(text: string, words: readonly string[]): boolean {
  return words.some((w) => new RegExp(`(^| )${escapeRegExp(w)}($| )`).test(text));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Rimuove la parola di attivazione, se presente. */
function stripWakeWord(text: string): string | null {
  for (const wake of VOICE.wakeWords) {
    const normalized = normalize(wake);
    if (text === normalized) return '';
    if (text.startsWith(`${normalized} `)) return text.slice(normalized.length + 1).trim();
    // La parola puo' arrivare in mezzo se il riconoscimento ha agganciato
    // qualcosa prima: si tiene quello che viene dopo.
    const at = text.indexOf(` ${normalized} `);
    if (at >= 0) return text.slice(at + normalized.length + 2).trim();
  }
  return null;
}

/** Corsia, SOLO se pronunciata. */
export function findLane(text: string): RoadLane | undefined {
  for (const { lane, words } of LANES) {
    if (mentions(text, words)) return lane;
  }
  return undefined;
}

/** Soggetto, SOLO se pronunciato. */
export function findSubject(text: string): HazardSubject | undefined {
  for (const { subject, words } of SUBJECTS) {
    if (mentions(text, words)) return subject;
  }
  return undefined;
}

/** Stato, SOLO se pronunciato. */
export function findState(text: string): HazardState | undefined {
  for (const { state, words } of STATES) {
    if (mentions(text, words)) return state;
  }
  return undefined;
}

/**
 * Interpreta una trascrizione.
 *
 * `requireWakeWord` e' true durante la guida - il microfono resta acceso e
 * senza parola di attivazione ogni conversazione diventerebbe una
 * segnalazione - ed e' disattivabile nei test.
 */
export function parseVoiceReport(
  transcript: string,
  options: { requireWakeWord?: boolean } = {},
): VoiceParseResult {
  const requireWakeWord = options.requireWakeWord ?? true;
  const normalized = normalize(transcript);
  if (normalized.length === 0) return { ok: false, reason: 'empty' };

  const stripped = stripWakeWord(normalized);
  if (requireWakeWord && stripped === null) return { ok: false, reason: 'no-wake-word' };

  const body = (stripped ?? normalized).trim();
  if (body.length === 0) return { ok: false, reason: 'empty' };

  for (const rule of RULES) {
    if (!rule.all.every((group) => mentions(body, group))) continue;

    const report: ParsedVoiceReport = { hazard: rule.hazard, transcript: body };
    // Gli attributi della regola sono quelli che la regola stessa ha
    // verificato nella frase; gli altri si cercano, e restano assenti se non
    // sono stati pronunciati.
    const subject = rule.subject ?? findSubject(body);
    if (subject) report.subject = subject;
    const state = rule.state ?? findState(body);
    if (state) report.state = state;
    const lane = findLane(body);
    if (lane) report.lane = lane;

    return { ok: true, report };
  }

  // Nessuna categoria riconosciuta, ma la frase parla chiaramente di un
  // pericolo: meglio registrarlo come non identificato che perderlo.
  if (mentions(body, HAZARD_HINTS)) {
    const report: ParsedVoiceReport = { hazard: 'unknown_hazard', transcript: body };
    const subject = findSubject(body);
    if (subject) report.subject = subject;
    const lane = findLane(body);
    if (lane) report.lane = lane;
    return { ok: true, report };
  }

  return { ok: false, reason: 'not-understood' };
}
