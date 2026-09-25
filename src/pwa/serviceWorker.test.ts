/**
 * ROAD SENSE - verifiche sul service worker REALE.
 *
 * Non su una copia della sua logica: il file `public/sw.js` viene letto dal
 * disco ed eseguito con un ambiente finto. Una riscrittura parallela avrebbe
 * verificato la riscrittura, non il file che finisce sul telefono.
 *
 * PERCHE' QUESTI TEST NASCONO ADESSO
 *
 * Finche' l'origine ha servito una sola pagina, `navigationStrategy` non poteva
 * sbagliare: ogni navigazione ERA la shell. Pubblicando una seconda pagina -
 * il laboratorio diagnostico `/voice-lab.html` - la stessa funzione avrebbe
 * salvato quella pagina sotto `/index.html`, cioe' sotto la chiave da cui ROAD
 * SENSE riparte quando la rete manca. Al primo avvio offline si sarebbe aperto
 * il laboratorio al posto dell'applicazione.
 *
 * Il difetto e' stato corretto; questi test esistono perche' non torni.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

const SW_PATH = join(process.cwd(), 'public', 'sw.js');
const ORIGIN = 'https://roadsense.example';

// -- ambiente finto ---------------------------------------------------------

class FakeResponse {
  constructor(
    readonly body: string,
    readonly init: { status?: number; headers?: Record<string, string> } = {},
  ) {}
  get status(): number {
    return this.init.status ?? 200;
  }
  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }
  clone(): FakeResponse {
    return new FakeResponse(this.body, this.init);
  }
}

class FakeRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  constructor(url: string, init: { method?: string; mode?: string } = {}) {
    this.url = new URL(url, ORIGIN).toString();
    this.method = init.method ?? 'GET';
    this.mode = init.mode ?? 'no-cors';
  }
}

/** Chiave normalizzata: `put('/index.html')` e una Request devono coincidere. */
const keyOf = (x: string | FakeRequest): string =>
  typeof x === 'string' ? new URL(x, ORIGIN).toString() : x.url;

class FakeCache {
  readonly entries = new Map<string, FakeResponse>();
  async put(key: string | FakeRequest, response: FakeResponse): Promise<void> {
    this.entries.set(keyOf(key), response);
  }
  async match(key: string | FakeRequest): Promise<FakeResponse | undefined> {
    return this.entries.get(keyOf(key));
  }
  async addAll(keys: (string | FakeRequest)[]): Promise<void> {
    for (const key of keys) this.entries.set(keyOf(key), new FakeResponse(`precache:${keyOf(key)}`));
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return cache;
  }
  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
  async match(key: string | FakeRequest): Promise<FakeResponse | undefined> {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(key);
      if (hit) return hit;
    }
    return undefined;
  }
}

interface Harness {
  storage: FakeCacheStorage;
  /** Percorsi che la rete deve rifiutare: simula l'assenza di connessione. */
  offline: Set<string>;
  /** true = qualunque richiesta di rete fallisce. */
  allOffline: boolean;
  listeners: Map<string, ((event: unknown) => void)[]>;
  navigate: (path: string) => Promise<FakeResponse | null>;
  request: (path: string, mode?: string) => Promise<FakeResponse | null>;
  shell: () => Promise<FakeResponse | undefined>;
  install: () => Promise<void>;
}

function boot(): Harness {
  const storage = new FakeCacheStorage();
  const offline = new Set<string>();
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const state = { allOffline: false };

  const self = {
    location: { origin: ORIGIN },
    clients: { claim: async () => undefined },
    skipWaiting: () => undefined,
    addEventListener: (type: string, cb: (event: unknown) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(cb);
      listeners.set(type, list);
    },
  };

  const fetchImpl = async (request: FakeRequest | string): Promise<FakeResponse> => {
    const url = keyOf(request as string | FakeRequest);
    const path = new URL(url).pathname;
    if (state.allOffline || offline.has(path)) throw new Error('rete assente');
    return new FakeResponse(`rete:${path}`);
  };

  const source = readFileSync(SW_PATH, 'utf8');
  // Gli argomenti ombreggiano i globali: il file viene eseguito tale e quale.
  const run = new Function('self', 'caches', 'fetch', 'Response', 'Request', 'URL', source);
  run(self, storage, fetchImpl, FakeResponse, FakeRequest, URL);

  const fire = async (type: string, event: Record<string, unknown>): Promise<void> => {
    for (const cb of listeners.get(type) ?? []) cb(event);
    const pending = event.__pending as Promise<unknown>[] | undefined;
    if (pending) await Promise.all(pending);
  };

  async function dispatch(path: string, mode: string): Promise<FakeResponse | null> {
    const request = new FakeRequest(path, { mode });
    let answered: Promise<FakeResponse> | null = null;
    const pending: Promise<unknown>[] = [];
    await fire('fetch', {
      request,
      __pending: pending,
      respondWith: (p: Promise<FakeResponse>) => {
        answered = p;
        pending.push(p.catch(() => undefined));
      },
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    });
    // `null` distingue "non intercettata" da "intercettata e risposta".
    return answered === null ? null : await answered;
  }

  return {
    storage,
    offline,
    get allOffline() {
      return state.allOffline;
    },
    set allOffline(v: boolean) {
      state.allOffline = v;
    },
    listeners,
    navigate: (path) => dispatch(path, 'navigate'),
    request: (path, mode = 'no-cors') => dispatch(path, mode),
    shell: async () => {
      const shellCache = [...storage.caches.entries()].find(([n]) => n.startsWith('roadsense-shell'));
      return shellCache?.[1].match('/index.html');
    },
    install: async () => {
      const pending: Promise<unknown>[] = [];
      await fire('install', { __pending: pending, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    },
  };
}

// -- test -------------------------------------------------------------------

let sw: Harness;
beforeEach(() => {
  sw = boot();
});

describe('service worker / la shell offline appartiene solo a ROAD SENSE', () => {
  it('visitare /voice-lab.html NON sostituisce /index.html', async () => {
    await sw.navigate('/');
    const shellPrima = await sw.shell();
    expect(shellPrima?.body).toBe('rete:/');

    const lab = await sw.navigate('/voice-lab.html');
    expect(lab?.body).toBe('rete:/voice-lab.html');

    // La shell e' rimasta quella dell'applicazione.
    const shellDopo = await sw.shell();
    expect(shellDopo?.body).toBe('rete:/');
  });

  it('il laboratorio non entra in cache in alcuna forma', async () => {
    await sw.navigate('/voice-lab.html');
    for (const cache of sw.storage.caches.values()) {
      for (const key of cache.entries.keys()) {
        expect(key).not.toContain('voice-lab');
      }
    }
  });

  it('REGRESSIONE: dopo aver visitato il laboratorio, offline si apre ROAD SENSE', async () => {
    // E' il test che il difetto avrebbe fatto fallire.
    await sw.navigate('/');
    await sw.navigate('/voice-lab.html');

    sw.allOffline = true;
    const home = await sw.navigate('/');
    expect(home?.body).toBe('rete:/');
    expect(home?.body).not.toContain('voice-lab');
    expect(home?.status).toBe(200);
  });

  it('offline il laboratorio si dichiara non disponibile, non finge di essere l app', async () => {
    await sw.navigate('/');
    sw.allOffline = true;
    const lab = await sw.navigate('/voice-lab.html');
    expect(lab?.status).toBe(503);
    // Soprattutto: non restituisce la shell dell'applicazione.
    expect(lab?.body).not.toBe('rete:/');
  });
});

describe('service worker / comportamento dell applicazione invariato', () => {
  it('la navigazione alla radice viene conservata come /index.html', async () => {
    const risposta = await sw.navigate('/');
    expect(risposta?.body).toBe('rete:/');
    expect((await sw.shell())?.body).toBe('rete:/');
  });

  it('anche /index.html esplicito viene conservato', async () => {
    await sw.navigate('/index.html');
    expect((await sw.shell())?.body).toBe('rete:/index.html');
  });

  it('rete per prima: una shell piu fresca sostituisce quella in cache', async () => {
    await sw.navigate('/');
    await sw.navigate('/index.html');
    expect((await sw.shell())?.body).toBe('rete:/index.html');
  });

  it('offline senza nulla in cache dichiara l indisponibilita', async () => {
    sw.allOffline = true;
    const risposta = await sw.navigate('/');
    expect(risposta?.status).toBe(503);
  });

  it('il precaricamento riguarda solo la shell dell applicazione', async () => {
    await sw.install();
    const cache = [...sw.storage.caches.values()][0];
    const chiavi = [...(cache?.entries.keys() ?? [])].map((k) => new URL(k).pathname);
    expect(chiavi).toContain('/');
    expect(chiavi).toContain('/index.html');
    expect(chiavi.some((k) => k.includes('lab'))).toBe(false);
    expect(chiavi.some((k) => k.includes('voice'))).toBe(false);
  });

  it('gli asset con hash restano cache-first', async () => {
    const prima = await sw.request('/assets/index-abc123.js');
    expect(prima?.body).toBe('rete:/assets/index-abc123.js');
    // Seconda volta dalla cache, anche senza rete.
    sw.allOffline = true;
    const seconda = await sw.request('/assets/index-abc123.js');
    expect(seconda?.body).toBe('rete:/assets/index-abc123.js');
  });

  it('la cartografia di terze parti non viene mai intercettata', async () => {
    // La Tile Usage Policy vieta l'archiviazione offline: il service worker non
    // deve nemmeno vedere passare quelle richieste.
    const tile = await sw.request('https://tiles.openfreemap.org/planet/1/2/3.pbf');
    expect(tile).toBeNull();
    expect(sw.storage.caches.size).toBe(0);
  });

  it('le API non vengono mai messe in cache', async () => {
    expect(await sw.request('/api/road-alerts')).toBeNull();
  });

  it('le richieste non-GET non vengono intercettate', async () => {
    const request = new FakeRequest('/', { method: 'POST', mode: 'navigate' });
    let answered = false;
    for (const cb of sw.listeners.get('fetch') ?? []) {
      cb({ request, respondWith: () => (answered = true), waitUntil: () => undefined });
    }
    expect(answered).toBe(false);
  });
});
