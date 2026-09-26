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
import { HAZARD_HINTS, LANES, normalize, RULES, STATES, SUBJECTS } from './lexicon';

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
