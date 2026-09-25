import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Unico punto di verita' per la versione: package.json. */
const APP_VERSION: string = JSON.parse(readFileSync('./package.json', 'utf8')).version;

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
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  server: { host: true, port: 5173 },
  // MapLibre istanzia il proprio worker con `{ type: 'module' }`: il chunk
  // emesso da Vite deve quindi essere un modulo ES, non il formato iife
  // predefinito.
  worker: { format: 'es' },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
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
