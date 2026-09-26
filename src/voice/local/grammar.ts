/**
 * ROAD SENSE - vocabolario ammesso dal decoder locale.
 *
 * Vive in un modulo minuscolo e senza dipendenze dal decoder per una ragione
 * precisa: Vosk pesa 5,8 MB, e importarlo solo per leggere un elenco di parole
 * trascinerebbe quei megabyte nel bundle di partenza dell'applicazione. Qui non
 * c'e' niente da caricare.
 *
 * L'ELENCO NON E' SCRITTO A MANO. Si compone di due fattori:
 *
 *   `grammarSource.ts`     cio' che il lessico e le 39 regole sanno dire
 *   `modelVocabulary.ts`   cio' che il modello italiano sa pronunciare
 *
 * L'intersezione e' la grammatica. Il primo fattore impedisce che il parser
 * conosca parole che il decoder non puo' produrre - era il difetto: 39 pericoli
 * interpretabili, 4 pronunciabili. Il secondo impedisce l'inverso, cioe' di
 * mettere in grammatica parole che il modello non ha e che Vosk scarterebbe in
 * silenzio (`recognizer.cc:84`), lasciando un pericolo muto senza alcun segnale.
 *
 * `[unk]` e' la voce piu' importante dell'elenco. Senza di lui il decoder e'
 * OBBLIGATO a scegliere la meno improbabile fra le parole note, anche davanti
 * alla radio o a un colpo di tosse. Con `[unk]` gli si concede di rispondere
 * "non era nessuna di queste", che in un abitacolo e' la verita' quasi sempre.
 */

import { seedPhrases, sourceTokens } from './grammarSource';
import { MODEL_VOCABULARY } from './modelVocabulary';

/** La voce che permette al decoder di dire "non era nessuna di queste". */
export const UNKNOWN_TOKEN = '[unk]';

/**
 * Costruisce la grammatica tenendo solo cio' che il modello sa pronunciare.
 *
 * Il vocabolario arriva come parametro, invece di essere letto qui dentro,
 * perche' cosi' il test puo' dimostrare il filtro su un vocabolario finto senza
 * dipendere dai 49 MB del modello.
 */
export function buildGrammar(vocabulary: ReadonlySet<string>): readonly string[] {
  const termini = sourceTokens().filter((t) => vocabulary.has(t));
  // Una frase-seme vale solo se OGNI sua parola esiste: un token mancante la
  // renderebbe indecodificabile, e il seme sarebbe peso morto.
  const semi = seedPhrases().filter((f) => f.split(' ').every((t) => vocabulary.has(t)));
  return [...termini, ...semi, UNKNOWN_TOKEN];
}

/** I termini del modello verificati dal certificato. */
export const VERIFIED_WORDS: ReadonlySet<string> = new Set(MODEL_VOCABULARY.present);

export const VOICE_GRAMMAR: readonly string[] = buildGrammar(VERIFIED_WORDS);
