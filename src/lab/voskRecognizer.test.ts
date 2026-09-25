/**
 * ROAD SENSE / LABORATORIO FASE 0 - verifiche sul caricamento del modello.
 *
 * PERCHE' QUESTI TEST ESISTONO
 *
 * Sul Samsung, con l'audio che funzionava, il pannello ha mostrato
 * "CARICAMENTO..." per minuti davanti a un banale 404. La causa non era il 404:
 * era che `createModel()` di vosk-browser si iscrive SOLO all'evento `load`,
 * mentre il worker, fallendo, emette `error`. La sua Promise non si risolveva e
 * non si rifiutava: restava pendente, e con lei l'interfaccia.
 *
 * Un difetto del genere non si vede a occhio e non si vede in un test di
 * successo. Si vede solo esercitando i percorsi di FALLIMENTO, che e' ciò che
 * fa questo file. Ogni esito possibile deve CONCLUDERSI e diventare uno stato.
 *
 * Il modello finto serve esattamente a questo: riprodurre i quattro modi in cui
 * il worker reale puo' comportarsi, senza dispositivo e senza 48 MB.
 */

import { describe, expect, it, vi } from 'vitest';

import { LocalRecognizer, type ModelLike } from './voskRecognizer';

type Listener = (message: unknown) => void;

/** Riproduce il contratto a eventi del modello di vosk-browser. */
class FakeModel implements ModelLike {
  readonly listeners = new Map<string, Listener[]>();
  terminated = 0;
  readonly recognizers: FakeRecognizer[] = [];

  on(event: 'load' | 'error', listener: Listener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }
  terminate(): void {
    this.terminated++;
  }
  emit(event: string, message: unknown): void {
    for (const l of this.listeners.get(event) ?? []) l(message);
  }

  get KaldiRecognizer(): ModelLike['KaldiRecognizer'] {
    // Fabbrica invece di sottoclasse: registra il riconoscitore creato senza
    // dover catturare `this` in una classe annidata.
    const registro = this.recognizers;
    const Costruttore = function (this: FakeRecognizer, sampleRate: number, grammar?: string) {
      const rec = new FakeRecognizer(sampleRate, grammar);
      registro.push(rec);
      return rec;
    };
    return Costruttore as unknown as ModelLike['KaldiRecognizer'];
  }
}

class FakeRecognizer {
  readonly listeners = new Map<string, Listener[]>();
  words = false;
  removed = 0;
  readonly fed: { samples: number; sampleRate: number }[] = [];
  flushes = 0;

  constructor(
    readonly sampleRate: number,
    readonly grammar?: string,
  ) {}

  on(event: string, listener: Listener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }
  emit(event: string, message: unknown): void {
    for (const l of this.listeners.get(event) ?? []) l(message);
  }
  setWords(value: boolean): void {
    this.words = value;
  }
  acceptWaveformFloat(buffer: Float32Array, sampleRate: number): void {
    this.fed.push({ samples: buffer.length, sampleRate });
  }
  retrieveFinalResult(): void {
    this.flushes++;
  }
  remove(): void {
    this.removed++;
  }
}

const handlers = () => ({
  onResult: vi.fn(),
  onPartial: vi.fn(),
  onError: vi.fn(),
});

/** Modello che si comporta in un modo scelto quando viene costruito. */
function modelThat(behaviour: (model: FakeModel) => void): {
  factory: (url: string) => ModelLike;
  urls: string[];
  models: FakeModel[];
} {
  const urls: string[] = [];
  const models: FakeModel[] = [];
  return {
    urls,
    models,
    factory: (url: string) => {
      urls.push(url);
      const model = new FakeModel();
      models.push(model);
      // L'evento arriva dopo la sottoscrizione, come nel worker reale.
      queueMicrotask(() => behaviour(model));
      return model;
    },
  };
}

describe('LocalRecognizer / il caricamento si conclude SEMPRE', () => {
  it('successo: la fase diventa pronto', async () => {
    const { factory, models, urls } = modelThat((m) => m.emit('load', { result: true }));
    const r = new LocalRecognizer(factory);

    await r.load('blob:modello', 16_000, handlers());

    expect(r.phase()).toBe('pronto');
    expect(r.isReady()).toBe(true);
    expect(r.lastError()).toBeNull();
    expect(urls).toEqual(['blob:modello']);
    // Un modello che ha funzionato NON va terminato.
    expect(models[0]?.terminated).toBe(0);
  });

  it('errore dichiarato dal worker: fase errore e messaggio REALE', async () => {
    // E' il caso del 404: il worker lo segnalava, nessuno ascoltava.
    const { factory, models } = modelThat((m) =>
      m.emit('error', { event: 'error', error: 'HTTP error! status: 404' }),
    );
    const r = new LocalRecognizer(factory);

    await expect(r.load('/lab/model/assente.tar.gz', 16_000, handlers())).rejects.toThrow(
      'HTTP error! status: 404',
    );
    expect(r.phase()).toBe('errore');
    expect(r.lastError()).toBe('HTTP error! status: 404');
    expect(r.isReady()).toBe(false);
    // Il Worker non va lasciato vivo dietro un fallimento.
    expect(models[0]?.terminated).toBe(1);
  });

  it('load con result:false: rifiuto esplicito, non attesa', async () => {
    const { factory, models } = modelThat((m) => m.emit('load', { result: false }));
    const r = new LocalRecognizer(factory);

    await expect(r.load('blob:x', 16_000, handlers())).rejects.toThrow(/result: false/);
    expect(r.phase()).toBe('errore');
    expect(models[0]?.terminated).toBe(1);
  });

  it('nessuna risposta: il limite di tempo produce un errore, non un blocco', async () => {
    // Nessun evento emesso: e' il worker che non risponde affatto.
    const { factory, models } = modelThat(() => undefined);
    const r = new LocalRecognizer(factory, 20);

    await expect(r.load('blob:muto', 16_000, handlers())).rejects.toThrow(/nessuna risposta/);
    expect(r.phase()).toBe('errore');
    expect(models[0]?.terminated).toBe(1);
  });

  it('errore senza testo: si dichiara comunque una causa leggibile', async () => {
    const { factory } = modelThat((m) => m.emit('error', {}));
    const r = new LocalRecognizer(factory);

    await expect(r.load('blob:x', 16_000, handlers())).rejects.toThrow(/non specificato/);
    expect(r.lastError()).toMatch(/non specificato/);
  });

  it('la costruzione stessa che fallisce non lascia nulla in sospeso', async () => {
    const r = new LocalRecognizer(() => {
      throw new Error('Worker non creabile');
    });
    await expect(r.load('blob:x', 16_000, handlers())).rejects.toThrow('Worker non creabile');
    expect(r.phase()).toBe('errore');
  });

  it('NESSUNA Promise resta pendente, in nessuno dei quattro esiti', async () => {
    // Il difetto originale era esattamente questo: una Promise che non si
    // conclude. Qui si verifica che ogni esito arrivi a destinazione entro un
    // tempo finito, invece di verificare come ci arriva.
    const casi: ((m: FakeModel) => void)[] = [
      (m) => m.emit('load', { result: true }),
      (m) => m.emit('error', { error: 'guasto' }),
      (m) => m.emit('load', { result: false }),
      () => undefined,
    ];
    for (const caso of casi) {
      const { factory } = modelThat(caso);
      const r = new LocalRecognizer(factory, 20);
      const esito = await Promise.race([
        r.load('blob:x', 16_000, handlers()).then(
          () => 'risolta',
          () => 'rifiutata',
        ),
        new Promise((resolve) => setTimeout(() => resolve('PENDENTE'), 500)),
      ]);
      expect(esito).not.toBe('PENDENTE');
      expect(['pronto', 'errore']).toContain(r.phase());
    }
  });

  it('dopo un fallimento si puo riprovare: la fase non resta in caricamento', async () => {
    const primo = modelThat((m) => m.emit('error', { error: 'prima volta' }));
    const r = new LocalRecognizer(primo.factory);
    await expect(r.load('blob:x', 16_000, handlers())).rejects.toThrow();
    expect(r.phase()).toBe('errore');

    // Un secondo tentativo non deve essere rifiutato da "caricamento gia in corso".
    const secondo = modelThat((m) => m.emit('load', { result: true }));
    const r2 = new LocalRecognizer(secondo.factory);
    await r2.load('blob:y', 16_000, handlers());
    expect(r2.phase()).toBe('pronto');
  });
});

describe('LocalRecognizer / il riconoscitore dopo il caricamento', () => {
  async function pronto() {
    const { factory, models } = modelThat((m) => m.emit('load', { result: true }));
    const h = handlers();
    const r = new LocalRecognizer(factory);
    await r.load('blob:x', 16_000, h);
    return { r, h, model: models[0] as FakeModel };
  }

  it('la grammatica e la confidenza per parola sono richieste', async () => {
    const { model } = await pronto();
    const rec = model.recognizers[0] as unknown as FakeRecognizer;
    expect(rec.sampleRate).toBe(16_000);
    expect(rec.grammar).toContain('buca');
    expect(rec.grammar).toContain('[unk]');
    // Senza `setWords(true)` non arriverebbe alcuna confidenza.
    expect(rec.words).toBe(true);
  });

  it('un risultato arriva con la confidenza piu debole fra le parole', async () => {
    const { h, model } = await pronto();
    const rec = model.recognizers[0] as unknown as FakeRecognizer;
    rec.emit('result', {
      event: 'result',
      result: {
        text: 'buca',
        result: [
          { word: 'buca', conf: 0.91, start: 0.1, end: 0.5 },
          { word: 'x', conf: 0.42, start: 0.5, end: 0.6 },
        ],
      },
    });
    expect(h.onResult).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'buca', confidence: 0.42 }),
    );
  });

  it('senza parole la confidenza e nulla, non zero', async () => {
    const { h, model } = await pronto();
    const rec = model.recognizers[0] as unknown as FakeRecognizer;
    rec.emit('result', { event: 'result', result: { text: '' } });
    expect(h.onResult).toHaveBeenCalledWith(expect.objectContaining({ confidence: null }));
  });

  it('i campioni arrivano al decoder e il flush chiude l enunciato', async () => {
    const { r, model } = await pronto();
    r.feed(new Float32Array(1024), 16_000);
    r.flush();
    const rec = model.recognizers[0] as unknown as FakeRecognizer;
    expect(rec.fed).toEqual([{ samples: 1024, sampleRate: 16_000 }]);
    expect(rec.flushes).toBe(1);
  });

  it('senza modello caricato il decoder non riceve nulla e non esplode', () => {
    const r = new LocalRecognizer();
    expect(() => r.feed(new Float32Array(256), 16_000)).not.toThrow();
    expect(() => r.flush()).not.toThrow();
    expect(r.isReady()).toBe(false);
  });

  it('release chiude riconoscitore e worker', async () => {
    const { r, model } = await pronto();
    r.release();
    const rec = model.recognizers[0] as unknown as FakeRecognizer;
    expect(rec.removed).toBe(1);
    expect(model.terminated).toBe(1);
    expect(r.phase()).toBe('assente');
  });
});
