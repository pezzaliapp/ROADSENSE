/**
 * ROAD SENSE - derivazione della grammatica vocale dalla fonte semantica.
 *
 * PERCHE' QUESTO FILE ESISTE
 *
 * Prima esistevano due elenchi indipendenti di parole italiane: quelle che il
 * parser sapeva interpretare (39 pericoli) e quelle che il decoder sapeva
 * pronunciare (quattro). Nessun legame fra i due. Il risultato non era una
 * grammatica povera: era codice irraggiungibile. "Nebbia", "frana", "auto
 * contromano" erano casi gestiti dal parser che nessuna voce poteva attivare,
 * perche' Vosk non poteva emettere quelle parole.
 *
 * Qui la grammatica si CALCOLA dal lessico. Aggiungere un sinonimo in
 * `lexicon.ts` lo rende pronunciabile nello stesso commit, senza toccare nulla
 * di questo file.
 *
 * COSA CHIEDE VOSK, DAVVERO (verificato nel sorgente, non dedotto)
 *
 * `vosk-api/src/recognizer.cc` spezza ogni voce sugli spazi e cerca ogni token
 * nel vocabolario del modello; i token assenti li SCARTA IN SILENZIO. Poi
 * `language_model.cc` stima un modello di linguaggio di ordine 2 e, per ogni
 * stato, aggiunge un arco epsilon di backoff verso lo stato unigramma
 * (`language_model.cc:199`).
 *
 * Da quell'arco discende tutto il disegno di questo file: NON e' una grammatica
 * di frasi, e' un bigramma con backoff. Qualunque sequenza delle parole elencate
 * e' decodificabile. Enumerare le frasi non le abilita - le rende solo piu'
 * probabili - e infatti misurando il decoder 1081 frasi enumerate producono un
 * FST piu' PICCOLO (42 stati) di 185 parole singole (186 stati): l'ordine 2
 * collassa l'enumerazione.
 *
 * Percio' qui si elencano i TERMINI, piu' le espressioni multi-parola che il
 * lessico gia' conosce come SEMI di bigramma: quelle pesano le sequenze che ci
 * aspettiamo davvero ("corsia di emergenza", "strada allagata"), al costo di
 * una sessantina di archi.
 */

import { VOICE } from '../../config/config';
import {
  GRAMMAR_ONLY,
  HAZARD_HINTS,
  LANES,
  normalize,
  RULES,
  STATES,
  SUBJECTS,
} from '../lexicon';

/**
 * Ogni espressione che la fonte semantica conosce, normalizzata con la STESSA
 * funzione che il parser applichera' alla trascrizione. Se le due
 * normalizzazioni divergessero, la grammatica ammetterebbe una forma che il
 * parser non riconosce piu': un accento di troppo basterebbe.
 */
export function sourcePhrases(): readonly string[] {
  const out = new Set<string>();
  const aggiungi = (raw: string): void => {
    const n = normalize(raw);
    if (n.length > 0) out.add(n);
  };

  for (const rule of RULES) for (const group of rule.all) for (const w of group) aggiungi(w);
  for (const { words } of SUBJECTS) for (const w of words) aggiungi(w);
  for (const { words } of STATES) for (const w of words) aggiungi(w);
  for (const { words } of LANES) for (const w of words) aggiungi(w);
  for (const w of HAZARD_HINTS) aggiungi(w);
  for (const w of GRAMMAR_ONLY) aggiungi(w);
  // La parola di attivazione e' obbligatoria in guida: se non e' in grammatica,
  // il decoder non puo' trascriverla e NESSUNA segnalazione passa il parser.
  for (const w of VOICE.wakeWords) aggiungi(w);

  return [...out].sort();
}

/** I termini distinti: e' l'unita' che Vosk cerca nel vocabolario del modello. */
export function sourceTokens(): readonly string[] {
  const out = new Set<string>();
  for (const frase of sourcePhrases()) for (const t of frase.split(' ')) out.add(t);
  return [...out].sort();
}

/** Espressioni di piu' parole: semi di bigramma, non enumerazione di frasi. */
export function seedPhrases(): readonly string[] {
  return sourcePhrases().filter((f) => f.includes(' '));
}
