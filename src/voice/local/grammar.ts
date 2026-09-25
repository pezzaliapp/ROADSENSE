/**
 * ROAD SENSE - vocabolario ammesso dal decoder locale.
 *
 * Vive in un modulo minuscolo e senza dipendenze per una ragione precisa: il
 * decoder Vosk pesa 5,8 MB, e importarlo solo per leggere un elenco di parole
 * trascinerebbe quei megabyte nel bundle di partenza dell'applicazione. Qui non
 * c'e' niente da caricare.
 *
 * `[unk]` e' la voce piu' importante dell'elenco. Senza di lui il decoder e'
 * OBBLIGATO a scegliere la meno improbabile fra le parole note, anche davanti
 * alla radio o a un colpo di tosse. Con `[unk]` gli si concede di rispondere
 * "non era nessuna di queste", che in un abitacolo e' la verita' quasi sempre.
 */
export const VOICE_GRAMMAR: readonly string[] = [
  'buca',
  'ostacolo',
  'acqua',
  'incidente',
  '[unk]',
];
