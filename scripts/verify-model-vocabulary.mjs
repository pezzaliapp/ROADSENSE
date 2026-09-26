/**
 * ROAD SENSE - verifica che ogni parola della grammatica esista DAVVERO nel
 * modello Vosk, e ne scrive il certificato.
 *
 * IL DIFETTO CHE QUESTO SCRIPT RENDE IMPOSSIBILE
 *
 * `vosk-api/src/recognizer.cc:84` scarta in silenzio i token che il modello non
 * conosce: `KALDI_WARN "Ignoring word missing in vocabulary"`, e prosegue. In
 * produzione non si vede nulla. Semplicemente, un pericolo non si puo' piu'
 * dire. E' cosi' che `possible_downburst` e' rimasto vocalmente irraggiungibile
 * per tutta la vita del progetto: la sua unica parola era "downburst", che in un
 * modello italiano non esiste.
 *
 * COME SI LEGGE IL VOCABOLARIO SENZA BROWSER E SENZA AUDIO
 *
 * Il modello non contiene un `words.txt` separato: la tabella dei simboli e'
 * DENTRO `graph/Gr.fst`, nel formato binario di OpenFst. Dopo il magic
 * 2125658996 seguono il nome, `available_key`, `size`, e `size` coppie
 * (stringa, chiave). Sono 200.006 parole italiane, leggibili in un passaggio.
 *
 * Il certificato prodotto e' legato allo SHA-256 delle parti del modello: se il
 * modello cambia, il certificato non e' piu' valido e un test lo dichiara.
 *
 *     node scripts/verify-model-vocabulary.mjs
 */

import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import * as esbuild from 'esbuild';

const RADICE = process.cwd();
const MODELLO = 'vosk-model-small-it-0.22';
const PARTI = 4;
const DIR_MODELLO = join(RADICE, 'public', 'assets', 'model', MODELLO);
const CERTIFICATO = join(RADICE, 'src', 'voice', 'local', 'modelVocabulary.ts');
const MAGIC_SYMBOL_TABLE = 2125658996;

/** Le parti ricomposte, piu' l'impronta che lega il certificato a QUESTO modello. */
function leggiModello() {
  const pezzi = [];
  for (let i = 0; i < PARTI; i++) {
    pezzi.push(readFileSync(join(DIR_MODELLO, `part-${String(i).padStart(2, '0')}`)));
  }
  const archivio = Buffer.concat(pezzi);
  return { archivio, sha256: createHash('sha256').update(archivio).digest('hex') };
}

/** Estrae un file dal tar, leggendo gli header da 512 byte. */
function estraiDalTar(tar, finePercorso) {
  let p = 0;
  while (p + 512 <= tar.length) {
    const nome = tar.toString('utf8', p, p + 100).replace(/\0.*$/, '');
    if (nome.length === 0) break;
    const ottale = tar.toString('utf8', p + 124, p + 136).replace(/[\0 ]/g, '');
    const dimensione = parseInt(ottale, 8) || 0;
    const inizio = p + 512;
    if (nome.endsWith(finePercorso)) return tar.subarray(inizio, inizio + dimensione);
    p = inizio + Math.ceil(dimensione / 512) * 512;
  }
  throw new Error(`nel modello non c'e' ${finePercorso}`);
}

/** La tabella dei simboli di OpenFst: l'elenco delle parole che il modello sa. */
function leggiVocabolario(fst) {
  const atteso = Buffer.alloc(4);
  atteso.writeInt32LE(MAGIC_SYMBOL_TABLE);
  let da = 0;
  for (;;) {
    const off = fst.indexOf(atteso, da);
    if (off < 0) throw new Error('tabella dei simboli non trovata in Gr.fst');
    try {
      let p = off + 4;
      const lunghezzaNome = fst.readInt32LE(p);
      p += 4;
      const nome = fst.toString('utf8', p, p + lunghezzaNome);
      p += lunghezzaNome;
      p += 8; // available_key
      const quante = Number(fst.readBigInt64LE(p));
      p += 8;
      if (quante < 1000 || quante > 5_000_000) throw new Error('dimensione implausibile');
      const parole = new Set();
      for (let i = 0; i < quante; i++) {
        const ls = fst.readInt32LE(p);
        p += 4;
        parole.add(fst.toString('utf8', p, p + ls));
        p += ls + 8; // simbolo + chiave
      }
      return { nome, parole };
    } catch {
      da = off + 4; // non era una tabella: si prova l'occorrenza successiva
    }
  }
}

/**
 * I token candidati vengono chiesti alla fonte vera - `grammarSource.ts` - non
 * riscritti qui: un elenco parallelo sarebbe esattamente il difetto che tutto
 * questo intervento elimina. esbuild e' gia' una dipendenza di Vite.
 */
async function tokenCandidati() {
  const temporaneo = join(tmpdir(), `roadsense-grammar-${process.pid}.mjs`);
  await esbuild.build({
    entryPoints: [join(RADICE, 'src', 'voice', 'local', 'grammarSource.ts')],
    outfile: temporaneo,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    // `config.ts` legge una costante che la build di Vite sostituisce: qui non
    // serve a nulla, ma senza dichiararla il bundle non parte.
    define: { __APP_VERSION__: '"non-rilevante-per-la-verifica"' },
  });
  try {
    const mod = await import(pathToFileURL(temporaneo).href);
    return { token: mod.sourceTokens(), frasi: mod.seedPhrases() };
  } finally {
    rmSync(temporaneo, { force: true });
  }
}

// -- esecuzione -------------------------------------------------------------

const { archivio, sha256 } = leggiModello();
console.log(`modello   : ${MODELLO} (${archivio.length} byte)`);
console.log(`sha256    : ${sha256}`);

const fst = estraiDalTar(gunzipSync(archivio), 'graph/Gr.fst');
const { nome, parole } = leggiVocabolario(fst);
console.log(`vocabolario: ${parole.size} parole (${nome})`);

const { token, frasi } = await tokenCandidati();
const presenti = token.filter((t) => parole.has(t));
const assenti = token.filter((t) => !parole.has(t));

console.log(`\ncandidati  : ${token.length} termini, ${frasi.length} frasi-seme`);
console.log(`presenti   : ${presenti.length}`);
console.log(`ASSENTI    : ${assenti.length}${assenti.length ? ' -> ' + assenti.join(', ') : ''}`);

const semiEsclusi = frasi.filter((f) => f.split(' ').some((t) => !parole.has(t)));
if (semiEsclusi.length > 0) console.log(`frasi-seme escluse: ${semiEsclusi.join(' | ')}`);

const elenco = (xs) => xs.map((x) => `    '${x}',`).join('\n');
writeFileSync(
  CERTIFICATO,
  `/**
 * ROAD SENSE - CERTIFICATO DEL VOCABOLARIO DEL MODELLO. FILE GENERATO.
 *
 * Non si modifica a mano. Lo riscrive:
 *
 *     node scripts/verify-model-vocabulary.mjs
 *
 * A COSA SERVE
 *
 * Vosk scarta in silenzio le parole che il modello non conosce
 * (\`recognizer.cc:84\`). Senza questo elenco, aggiungere un sinonimo che il
 * modello italiano non ha lo renderebbe inerte senza alcun segnale: nessun
 * errore, nessun avviso, solo un pericolo che non si puo' piu' dire.
 *
 * \`present\` contiene i termini della fonte semantica VERIFICATI nel modello:
 * la grammatica si costruisce da questi. \`absent\` contiene quelli che il
 * modello non ha, ed e' altrettanto importante, perche' rende visibile cio' che
 * altrimenti sparirebbe.
 *
 * \`sha256\` e' l'impronta delle parti del modello su disco: se il modello
 * cambia, questo certificato non vale piu' e un test lo dichiara.
 */

export const MODEL_VOCABULARY = {
  model: '${MODELLO}',
  sha256: '${sha256}',
  /** Parole del modello italiano: l'intero vocabolario, non solo il nostro. */
  modelWords: ${parole.size},
  /** Termini della fonte semantica presenti nel modello. */
  present: [
${elenco(presenti)}
  ],
  /** Termini della fonte semantica che il modello NON conosce. */
  absent: [
${elenco(assenti)}
  ],
} as const;
`,
  'utf8',
);
console.log(`\ncertificato scritto: ${CERTIFICATO.replace(RADICE + '/', '')}`);
