/**
 * ROAD SENSE - il modello vocale, servito dalla nostra stessa origine.
 *
 * IL PROBLEMA, E PERCHE' LA SOLUZIONE HA QUESTA FORMA
 *
 * Il modello italiano pesa 47,3 MB come archivio. Gli asset statici di
 * Cloudflare Workers hanno un limite di 25 MiB PER FILE, su tutti i piani,
 * gratuito compreso. Un file unico non e' pubblicabile.
 *
 * Alternative esaminate e scartate, tutte per ragioni misurate:
 *   - alphacephei.com    non manda alcun header CORS: irraggiungibile da una
 *                        pagina web;
 *   - GitHub Releases    nessun CORS;
 *   - HuggingFace        CORS limitato al proprio dominio;
 *   - CDN di terze parti richiederebbe di allargare `connect-src`, cioe' di
 *                        indebolire la CSP dell'origine che serve ROAD SENSE;
 *   - servizio nuovo     escluso: nessun servizio aggiuntivo, nessun costo.
 *
 * Resta una sola strada: l'archivio viaggia in pezzi sotto 25 MiB, serviti
 * dalla nostra origine, e viene ricomposto nel dispositivo.
 *
 * PERCHE' SOTTO /assets/
 *
 * Non e' un dettaglio di gusto. Quel percorso ha gia' tutto cio' che serve, e
 * quindi NON si tocca niente:
 *   - `_headers` gli applica gia' `max-age=31536000, immutable`: scaricato una
 *     volta, non viene piu' richiesto;
 *   - il service worker lo mette gia' in cache-first;
 *   - `connect-src 'self'` lo consente gia'.
 * Il numero di versione e' nel percorso: un modello diverso sara' un URL
 * diverso, ed e' cio' che rende sicuro dichiararlo immutabile.
 *
 * COSA COSTA, DETTO CHIARAMENTE
 *
 * Il primo avvio scarica 47,3 MB. Finche' non sono arrivati, la voce non c'e';
 * tutto il resto di ROAD SENSE - sensori, mappa, rilevamento automatico,
 * pulsante di segnalazione - funziona esattamente come prima. Il download non
 * blocca nulla e non parte da solo: comincia quando si attiva la voce.
 */

/** Versione del modello. Compare nel percorso: cambiarla cambia l'URL. */
export const MODEL_NAME = 'vosk-model-small-it-0.22';

/** Cartella servita dalla nostra origine. */
export const MODEL_BASE = `/assets/model/${MODEL_NAME}`;

/** Quanti pezzi compongono l'archivio. */
export const MODEL_PARTS = 4;

/** Dimensione attesa dell'archivio ricomposto, in byte. */
export const MODEL_BYTES = 49_642_287;

export interface ModelProgress {
  /** Byte ricevuti finora. */
  received: number;
  /** Byte totali attesi. */
  total: number;
  /** Frazione 0..1. */
  ratio: number;
}

export interface ModelSourceEnv {
  fetch: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>;
  createObjectURL: (blob: Blob) => string;
}

export function browserModelEnv(): ModelSourceEnv {
  return {
    fetch: (url) => fetch(url, { cache: 'force-cache' }),
    createObjectURL: (blob) => URL.createObjectURL(blob),
  };
}

export function partUrl(index: number): string {
  return `${MODEL_BASE}/part-${String(index).padStart(2, '0')}`;
}

/**
 * Scarica i pezzi, li rimette insieme e restituisce un URL locale.
 *
 * `cache: 'force-cache'` e' voluto: dopo la prima volta i pezzi arrivano dalla
 * cache del browser senza nemmeno una richiesta di validazione, perche' sono
 * dichiarati immutabili e il loro URL contiene la versione.
 *
 * I pezzi vengono richiesti UNO ALLA VOLTA, non in parallelo. Su una rete
 * mobile quattro richieste simultanee da 12 MB si ostacolano a vicenda e
 * rendono il progresso illeggibile; in sequenza la barra dice la verita' e la
 * memoria di picco resta quella di un pezzo piu' il risultato.
 */
export async function loadModelUrl(
  onProgress: (p: ModelProgress) => void,
  env: ModelSourceEnv = browserModelEnv(),
): Promise<string> {
  const parti: ArrayBuffer[] = [];
  let ricevuti = 0;

  onProgress({ received: 0, total: MODEL_BYTES, ratio: 0 });

  for (let i = 0; i < MODEL_PARTS; i++) {
    const url = partUrl(i);
    const risposta = await env.fetch(url);
    if (!risposta.ok) {
      throw new Error(`modello non disponibile: ${url} ha risposto ${risposta.status}`);
    }
    const pezzo = await risposta.arrayBuffer();
    parti.push(pezzo);
    ricevuti += pezzo.byteLength;
    onProgress({
      received: ricevuti,
      total: MODEL_BYTES,
      // Il totale atteso e' noto: se un pezzo fosse piu' grande del previsto la
      // frazione non deve superare 1 e mostrare un progresso impossibile.
      ratio: Math.min(1, ricevuti / MODEL_BYTES),
    });
  }

  if (ricevuti !== MODEL_BYTES) {
    throw new Error(`modello incompleto: ${ricevuti} byte invece di ${MODEL_BYTES}`);
  }

  // `application/gzip` perche' l'archivio E' un tar.gz: il tipo non cambia i
  // byte, ma evita che qualcuno lo interpreti come testo.
  return env.createObjectURL(new Blob(parti, { type: 'application/gzip' }));
}
