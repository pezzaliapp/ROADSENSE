/**
 * ROAD SENSE - verifiche sul caricamento del modello vocale.
 *
 * Il modello arriva in pezzi perche' gli asset statici hanno un limite di
 * 25 MiB per file e l'archivio pesa 47,3 MB. Ricomporre pezzi e' un'operazione
 * dove un errore non si vede: i byte ci sono tutti, sono solo nell'ordine
 * sbagliato, e il risultato e' un archivio che non si apre. E' successo davvero
 * una volta, con un indice sbagliato di UN carattere.
 *
 * Questi test verificano l'ordine, il conteggio e cio' che accade quando un
 * pezzo manca.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  loadModelUrl,
  MODEL_BYTES,
  MODEL_NAME,
  MODEL_PARTS,
  partUrl,
  type ModelSourceEnv,
} from './modelChunks';

/** Limite di Cloudflare per singolo asset statico, su tutti i piani. */
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MODEL_DIR = join(process.cwd(), 'public', 'assets', 'model', MODEL_NAME);

function fakeEnv(parti: Uint8Array[], mancanti: number[] = []): ModelSourceEnv & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: (url: string) => {
      urls.push(url);
      const indice = Number(url.slice(url.lastIndexOf('-') + 1));
      if (mancanti.includes(indice)) {
        return Promise.resolve({
          ok: false,
          status: 404,
          arrayBuffer: () => Promise.reject(new Error('non dovrebbe essere letto')),
        });
      }
      const pezzo = parti[indice] as Uint8Array;
      return Promise.resolve({
        ok: true,
        status: 200,
        // Copia in un ArrayBuffer nuovo: `pezzo.buffer` e' tipizzato come
        // ArrayBufferLike, che comprende SharedArrayBuffer.
        arrayBuffer: () => {
          const copia = new ArrayBuffer(pezzo.byteLength);
          new Uint8Array(copia).set(pezzo);
          return Promise.resolve(copia);
        },
      });
    },
    createObjectURL: () => 'blob:finto',
  };
}

/** Pezzi che sommati fanno esattamente MODEL_BYTES, con contenuto distinguibile. */
function partiValide(): Uint8Array[] {
  const base = Math.floor(MODEL_BYTES / MODEL_PARTS);
  const out: Uint8Array[] = [];
  let totale = 0;
  for (let i = 0; i < MODEL_PARTS; i++) {
    const n = i === MODEL_PARTS - 1 ? MODEL_BYTES - totale : base;
    out.push(new Uint8Array(n).fill(i + 1));
    totale += n;
  }
  return out;
}

describe('modelChunks / indirizzi', () => {
  it('i pezzi sono numerati con due cifre, sotto la nostra origine', () => {
    expect(partUrl(0)).toBe(`/assets/model/${MODEL_NAME}/part-00`);
    expect(partUrl(3)).toBe(`/assets/model/${MODEL_NAME}/part-03`);
    // Nessun dominio: un URL assoluto vorrebbe dire audio o dati fuori origine.
    expect(partUrl(0).startsWith('/')).toBe(true);
  });

  it('la versione del modello e nel percorso', () => {
    // E' cio' che rende sicuro dichiarare gli asset immutabili: un modello
    // diverso avra' un URL diverso.
    expect(partUrl(0)).toContain('0.22');
  });
});

describe('modelChunks / ricomposizione', () => {
  it('scarica tutti i pezzi, IN ORDINE', async () => {
    const env = fakeEnv(partiValide());
    await loadModelUrl(() => undefined, env);
    expect(env.urls).toEqual(
      Array.from({ length: MODEL_PARTS }, (_, i) => partUrl(i)),
    );
  });

  it('il contenuto viene concatenato nell ordine dei pezzi', async () => {
    const parti = partiValide();
    let visto: Blob | null = null;
    const env = fakeEnv(parti);
    env.createObjectURL = (blob) => {
      visto = blob;
      return 'blob:x';
    };
    await loadModelUrl(() => undefined, env);

    expect(visto).not.toBeNull();
    const bytes = new Uint8Array(await (visto as unknown as Blob).arrayBuffer());
    expect(bytes.byteLength).toBe(MODEL_BYTES);
    // Primo byte dal primo pezzo, ultimo dall'ultimo: se l'ordine si
    // invertisse, l'archivio non si aprirebbe e nessun altro test lo direbbe.
    expect(bytes[0]).toBe(1);
    expect(bytes[bytes.byteLength - 1]).toBe(MODEL_PARTS);
  });

  it('riferisce l avanzamento, mai oltre il 100%', async () => {
    const letture: number[] = [];
    await loadModelUrl((p) => letture.push(p.ratio), fakeEnv(partiValide()));
    expect(letture[0]).toBe(0);
    expect(letture.at(-1)).toBe(1);
    // Monotono: una barra che torna indietro e' un difetto visibile.
    for (let i = 1; i < letture.length; i++) {
      expect(letture[i] as number).toBeGreaterThanOrEqual(letture[i - 1] as number);
      expect(letture[i] as number).toBeLessThanOrEqual(1);
    }
  });

  it('un pezzo mancante e un errore dichiarato, non un archivio corrotto', async () => {
    await expect(loadModelUrl(() => undefined, fakeEnv(partiValide(), [2]))).rejects.toThrow(
      /part-02 ha risposto 404/,
    );
  });

  it('un totale diverso dall atteso viene rifiutato', async () => {
    // Meglio nessun modello che un modello a meta': Vosk fallirebbe con un
    // messaggio incomprensibile.
    const corti = partiValide();
    corti[0] = new Uint8Array(10);
    await expect(loadModelUrl(() => undefined, fakeEnv(corti))).rejects.toThrow(/incompleto/);
  });

  it('un pezzo alla volta, non quattro richieste in parallelo', async () => {
    // In parallelo su rete mobile si ostacolano e il progresso mente.
    let inVolo = 0;
    let massimo = 0;
    const parti = partiValide();
    const env = fakeEnv(parti);
    const originale = env.fetch;
    env.fetch = async (url: string) => {
      inVolo++;
      massimo = Math.max(massimo, inVolo);
      await Promise.resolve();
      const r = await originale(url);
      inVolo--;
      return r;
    };
    await loadModelUrl(() => undefined, env);
    expect(massimo).toBe(1);
  });
});

describe('modelChunks / i pezzi pubblicati', () => {
  const presenti = (() => {
    try {
      return readdirSync(MODEL_DIR).filter((f) => f.startsWith('part-')).sort();
    } catch {
      return [];
    }
  })();

  it('esistono e sono quanti il codice si aspetta', () => {
    expect(presenti).toHaveLength(MODEL_PARTS);
    expect(presenti).toEqual(Array.from({ length: MODEL_PARTS }, (_, i) => partUrl(i).split('/').pop()));
  });

  it('nessun pezzo supera il limite di 25 MiB per asset', () => {
    // E' il vincolo che ha imposto questa architettura: un file unico da
    // 47,3 MB non sarebbe pubblicabile.
    for (const f of presenti) {
      const size = statSync(join(MODEL_DIR, f)).size;
      expect(size, `${f} supera il limite`).toBeLessThanOrEqual(MAX_ASSET_BYTES);
      expect(size).toBeGreaterThan(0);
    }
  });

  it('la somma dei pezzi e esattamente la dimensione dichiarata nel codice', () => {
    // Se qualcuno rigenera i pezzi e dimentica di aggiornare MODEL_BYTES, il
    // controllo di completezza nel client fallirebbe sul telefono. Meglio qui.
    const totale = presenti.reduce((n, f) => n + statSync(join(MODEL_DIR, f)).size, 0);
    expect(totale).toBe(MODEL_BYTES);
  });

  it('il primo pezzo comincia con l intestazione gzip', () => {
    // 0x1f 0x8b: e' un .tar.gz, ed e' cio' che l'estrattore di Vosk attende.
    const testa = readFileSync(join(MODEL_DIR, 'part-00')).subarray(0, 2);
    expect([...testa]).toEqual([0x1f, 0x8b]);
  });
});

describe('modelChunks / cache', () => {
  it('chiede al browser di usare la cache senza rivalidare', async () => {
    // I pezzi sono immutabili e il loro URL contiene la versione: dopo la prima
    // volta non deve partire nemmeno una richiesta di validazione.
    const spia = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
    );
    vi.stubGlobal('fetch', spia);
    const { browserModelEnv } = await import('./modelChunks');
    await browserModelEnv().fetch('/assets/model/x/part-00');
    expect(spia).toHaveBeenCalledWith('/assets/model/x/part-00', { cache: 'force-cache' });
    vi.unstubAllGlobals();
  });
});
