import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';


/** Unico punto di verita' per la versione: package.json. */
const APP_VERSION: string = JSON.parse(readFileSync('./package.json', 'utf8')).version;

/**
 * IDENTITA' DELLA BUILD.
 *
 * Il problema che risolve: la versione da sola non basta a sapere quale build
 * si ha in mano. Durante i test su dispositivo si apre il sito e non si
 * distingue la build di ieri da quella di adesso, perche' due build diverse
 * possono dichiarare la stessa versione.
 *
 * Il commit breve lo risolve, ed e' ricavato automaticamente: nessun hash
 * viene scritto a mano nel sorgente. Si guarda, in ordine:
 *
 *   1. le variabili che il servizio di build espone da se'
 *      (`CF_PAGES_COMMIT_SHA` su Cloudflare Pages, `GITHUB_SHA` nelle Actions);
 *   2. il repository locale, per `npm run build` sulla propria macchina;
 *   3. altrimenti si dichiara `sconosciuto`, senza far fallire la build - una
 *      copia scaricata come archivio zip non ha alcun repository.
 *
 * Nessun servizio esterno, nessuna rete, nessun costo.
 */
function buildCommit(): string {
  const daServizio = process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? '';
  if (daServizio.length >= 7) return daServizio.slice(0, 7);
  try {
    const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // Un albero sporco NON e' il commit che dichiara di essere: senza questo
    // segno si testerebbe una build con modifiche non committate credendola
    // uguale a quella pubblicata.
    const sporco = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().length > 0;
    return sporco ? `${sha}+` : sha;
  } catch {
    return 'sconosciuto';
  }
}

const APP_COMMIT: string = buildCommit();

/**
 * Porta la stessa versione dentro al service worker.
 *
 * `public/sw.js` non passa per il bundler - e' un file statico servito
 * cosi' com'e' - quindi il segnaposto viene sostituito sul file emesso.
 * Senza questo, versione dell'app e versione delle cache divergerebbero al
 * primo rilascio, e il banner di aggiornamento non comparirebbe piu'.
 */
function serviceWorkerVersion(): Plugin {
  return {
    name: 'roadsense-sw-version',
    apply: 'build',
    closeBundle() {
      const file = resolve('dist', 'sw.js');
      const source = readFileSync(file, 'utf8');
      if (!source.includes('__APP_VERSION__')) {
        throw new Error('sw.js non contiene il segnaposto __APP_VERSION__');
      }
      writeFileSync(file, source.replaceAll('__APP_VERSION__', APP_VERSION), 'utf8');
    },
  };
}

// ROAD SENSE - configurazione build.
// `server.host` e' abilitato per poter aprire l'app dal telefono sulla stessa LAN
// durante lo sviluppo (la geolocalizzazione richiede comunque HTTPS o localhost).
export default defineConfig({
  plugins: [react(), serviceWorkerVersion()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_COMMIT__: JSON.stringify(APP_COMMIT),
  },
  server: { host: true, port: 5173 },
  // MapLibre istanzia il proprio worker con `{ type: 'module' }`: il chunk
  // emesso da Vite deve quindi essere un modulo ES, non il formato iife
  // predefinito.
  worker: { format: 'es' },
  preview: { host: true, port: 4173 },
  // Stessa ragione: in sviluppo il pacchetto collegato va comunque
  // pre-elaborato, altrimenti `npm run dev` fallirebbe come la build.
  optimizeDeps: { include: ['vosk-browser'] },
  build: {
    target: 'es2022',
    // `vosk-browser` e' una dipendenza LOCALE (`file:vendor/vosk-browser`),
    // quindi npm la collega con un symlink e il percorso risolto cade fuori da
    // `node_modules`. Vite applica l'interoperabilita' CommonJS solo dentro
    // node_modules: senza questa riga il bundle UMD non espone i suoi export e
    // la build fallisce con «"Model" is not exported».
    commonjsOptions: { include: [/vendor[\\/]vosk-browser/, /node_modules/] },
    sourcemap: false,
    rollupOptions: {
      // Due pagine indipendenti.
      //
      // `voice-lab.html` e' il prototipo diagnostico della Fase 0: microfono
      // continuo, buffer, cancello di parola, decoder locale. NON e' ROAD
      // SENSE e non importa nulla dell'applicazione, quindi non entra nel suo
      // bundle - c'e' un test che lo verifica in entrambe le direzioni.
      //
      // E' una pagina a se' e non un percorso dentro l'app di proposito: cosi'
      // il prototipo puo' essere pubblicato, misurato e poi rimosso senza
      // lasciare un solo bivio nel codice che gira durante la guida.
      // `resolve` senza `__dirname`: la configurazione e' un modulo ES e Vite
      // gira dalla radice del progetto, come gia' fa il plugin del sw sopra.
      // La chiave `index` mantiene ai file dell'applicazione il nome che
      // avevano prima (`index-<hash>.js`): il prototipo non deve cambiare
      // l'aspetto della build di ROAD SENSE piu' di quanto sia inevitabile.
      input: {
        index: resolve('index.html'),
        voiceLab: resolve('voice-lab.html'),
      },
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
