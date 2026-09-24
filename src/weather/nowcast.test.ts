/**
 * ROAD SENSE - lettura degli alert reali di NOWCAST.
 *
 * Due cose vengono verificate qui, e sono quelle che tengono separati i due
 * progetti:
 *   1. ROAD SENSE non decide se un pericolo esiste - riceve alert gia' decisi;
 *   2. qualunque cosa vada storta in NOWCAST si ferma a "nessuna cella meteo",
 *      mai a un errore di ROAD SENSE.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { WEATHER } from '../config/config';
import {
  NowcastWeatherProvider,
  type NowcastEnvironment,
} from './NowcastWeatherProvider';

const ROOT = resolve(import.meta.dirname, '..', '..');
const FRAME = 1_790_000_000;

/** Payload realistico, nella forma prodotta da /api/road-alerts. */
function payload(
  over: Record<string, unknown> = {},
  alertOver: Record<string, unknown> = {},
  cellaOver: Record<string, unknown> = {},
) {
  return {
    contratto: 1,
    frame_time: FRAME,
    orizzonte_min: 75,
    dati_fermi: false,
    alerts: [
      {
        id: '5d736b42b0',
        track_id: 123,
        hazard: 'grandine',
        livello: 'probabile',
        issued_at: FRAME - 60,
        origine: 'grandine dichiarata da MeteoSwiss',
        lead_minutes: 15,
        eta_dato_min: 0.0,
        grandine_mm: 12.0,
        raffica_kmh: null,
        cella: {
          lat: 45.5,
          lon: 9.2,
          radius_km: 2.5,
          speed_kmh: 36,
          heading_deg: 215,
          moto_affidabile: true,
          age_minutes: 5,
          cone: [
            { minutes: 0, lon: 9.2, lat: 45.5, radius_km: 2.5 },
            { minutes: 5, lon: 9.1, lat: 45.4, radius_km: 4.5 },
          ],
          ...cellaOver,
        },
        ...alertOver,
      },
    ],
    ...over,
  };
}

/**
 * Ambiente con risposta pilotabile e orologio LOCALE pilotabile.
 *
 * L'orologio e' quello del telefono, ed e' deliberatamente indipendente da
 * `frame_time`: e' proprio la loro separazione che questi test verificano.
 */
function makeEnv(risposta: unknown | (() => Promise<unknown>), now = FRAME * 1000 + 60_000) {
  let clock = now;
  const get = vi.fn(async (_url: string, _timeout: number) =>
    typeof risposta === 'function' ? await (risposta as () => Promise<unknown>)() : risposta,
  );
  const env: NowcastEnvironment = { get, now: () => clock };
  return { env, get, avanza: (ms: number) => (clock += ms) };
}

const MINUTI = 60_000;
/** Orizzonte dichiarato dal payload di prova. */
const ORIZZONTE = 75 * MINUTI;

describe('un alert NOWCAST diventa una cella', () => {
  it('mappa grandine su hail, senza decidere nulla', async () => {
    const { env } = makeEnv(payload());
    const p = new NowcastWeatherProvider(env);
    await p.refresh();

    const cells = p.cells();
    expect(cells).toHaveLength(1);
    const c = cells[0]!;
    expect(c.id).toBe('5d736b42b0');
    expect(c.kind).toBe('hail');
    // NOWCAST ha gia' deciso che questo pericolo va annunciato.
    expect(c.announce).toBe(true);
    expect(c.simulated).toBe(false);
    expect(c.radiusM).toBe(2500);
    expect(c.driftSpeedMps).toBeCloseTo(10, 3);
    expect(c.driftHeading).toBe(215);
  });

  it('mappa downburst su downburst', async () => {
    const { env } = makeEnv(payload({}, { hazard: 'downburst' }));
    const p = new NowcastWeatherProvider(env);
    await p.refresh();
    expect(p.cells()[0]?.kind).toBe('downburst');
  });

  it('un pericolo che ROAD SENSE non sa tradurre viene scartato', async () => {
    // NOWCAST calcola anche vento e supercella, ma non li allerta: non si
    // indovina una traduzione.
    for (const hazard of ['vento', 'supercella', 'qualcosa']) {
      const { env } = makeEnv(payload({}, { hazard }));
      const p = new NowcastWeatherProvider(env);
      await p.refresh();
      expect([hazard, p.cells().length]).toEqual([hazard, 0]);
    }
  });

  it('la severita\' viene dal livello deciso da NOWCAST, non da punteggi', async () => {
    for (const [livello, atteso] of [
      ['probabile', 2],
      ['molto probabile', 3],
    ] as const) {
      const { env } = makeEnv(payload({}, { livello }));
      const p = new NowcastWeatherProvider(env);
      await p.refresh();
      expect([livello, p.cells()[0]?.severity]).toEqual([livello, atteso]);
    }
  });

  it('moto non affidabile: nessuna direzione inventata', async () => {
    const { env } = makeEnv(payload({}, {}, { moto_affidabile: false }));
    const p = new NowcastWeatherProvider(env);
    await p.refresh();
    const c = p.cells()[0]!;
    expect(c.driftHeading).toBeNull();
    expect(c.driftSpeedMps).toBe(0);
  });

  it('il cono arriva in metri e in ordine di minuti', async () => {
    const { env } = makeEnv(payload());
    const p = new NowcastWeatherProvider(env);
    await p.refresh();
    const cone = p.cells()[0]?.cone;
    expect(cone).toHaveLength(2);
    expect(cone?.[0]).toEqual({ minutes: 0, lat: 45.5, lon: 9.2, radiusM: 2500 });
    expect(cone?.[1]?.radiusM).toBe(4500);
  });
});

describe('la posizione di chi guida non esce dal dispositivo', () => {
  it('la richiesta non ha parametri ne\' corpo', async () => {
    const { env, get } = makeEnv(payload());
    await new NowcastWeatherProvider(env).refresh();

    const url = get.mock.calls[0]?.[0] as string;
    expect(url).toBe(WEATHER.nowcast.url);
    expect(url).not.toMatch(/[?&]/);
    expect(url).not.toMatch(/lat|lon|pos|coord/i);
  });

  it('cells() e\' sincrona e non contatta nessuno', async () => {
    const { env, get } = makeEnv(payload());
    const p = new NowcastWeatherProvider(env);
    await p.refresh();
    const chiamate = get.mock.calls.length;
    p.cells();
    p.cells();
    expect(get.mock.calls.length).toBe(chiamate);
  });
});

describe('degrado: nessun guasto di NOWCAST diventa un guasto di ROAD SENSE', () => {
  const casi: Array<[string, unknown]> = [
    ['contratto sconosciuto', { ...payload(), contratto: 2 }],
    ['dati dichiarati fermi', { ...payload(), dati_fermi: true }],
    ['frame assente', { ...payload(), frame_time: null }],
    ['orizzonte assente', { ...payload(), orizzonte_min: null }],
    ['risposta non oggetto', 'non un oggetto'],
    ['risposta nulla', null],
    ['alerts non array', { ...payload(), alerts: 'boh' }],
  ];

  for (const [nome, risposta] of casi) {
    it(`${nome}: nessuna cella, nessuna eccezione`, async () => {
      const { env } = makeEnv(risposta);
      const p = new NowcastWeatherProvider(env);
      await expect(p.refresh()).resolves.toBeUndefined();
      expect(p.cells()).toEqual([]);
      expect(p.isAvailable()).toBe(false);
    });
  }

  it('un alert malformato non invalida gli altri', async () => {
    const buono = payload().alerts[0];
    const { env } = makeEnv({
      ...payload(),
      alerts: [{ id: 'rotto' }, null, { ...buono, cella: { lat: 'x' } }, buono],
    });
    const p = new NowcastWeatherProvider(env);
    await p.refresh();
    expect(p.cells()).toHaveLength(1);
  });

  it('rete assente o timeout: nessuna eccezione propagata', async () => {
    const { env } = makeEnv(() => Promise.reject(new Error('timeout')));
    const p = new NowcastWeatherProvider(env);
    await expect(p.refresh()).resolves.toBeUndefined();
    expect(p.cells()).toEqual([]);
    expect(p.unavailableReason).toMatch(/non raggiungibile/i);
  });

  it('cono vuoto: la cella resta valida, senza cono', async () => {
    const { env } = makeEnv(payload({}, {}, { cone: [] }));
    const p = new NowcastWeatherProvider(env);
    await p.refresh();
    expect(p.cells()).toHaveLength(1);
    expect(p.cells()[0]?.cone).toBeUndefined();
  });
});

describe('freschezza: un solo orologio, quello locale', () => {
  it('un frame nuovo rende il feed disponibile', async () => {
    const { env } = makeEnv(payload());
    const p = new NowcastWeatherProvider(env);
    await p.refresh();
    expect(p.isAvailable()).toBe(true);
    expect(p.cells()).toHaveLength(1);
  });

  it('lo stesso frame ricevuto di nuovo NON ringiovanisce il feed', async () => {
    // E' il caso che conta: interrogare piu' spesso non deve poter far
    // sembrare recente un frame fermo.
    const { env, avanza } = makeEnv(payload());
    const p = new NowcastWeatherProvider(env);
    await p.refresh();

    avanza(ORIZZONTE - MINUTI);
    await p.refresh(); // stesso frame_time
    expect(p.isAvailable()).toBe(true);

    avanza(2 * MINUTI); // ora sono passati piu' di 75 minuti dalla ricezione
    await p.refresh(); // ancora lo stesso frame_time
    expect(p.isAvailable()).toBe(false);
    expect(p.cells()).toEqual([]);
  });

  it('oltre l\'orizzonte lo stesso frame scade', async () => {
    const { env, avanza } = makeEnv(payload());
    const p = new NowcastWeatherProvider(env);
    await p.refresh();

    avanza(ORIZZONTE);
    expect(p.isAvailable()).toBe(true); // esattamente al limite, non oltre
    avanza(1);
    expect(p.isAvailable()).toBe(false);
  });

  it('un frame NUOVO rimette in moto l\'orologio e il feed torna valido', async () => {
    let frame = FRAME;
    const { env, avanza } = makeEnv(() => Promise.resolve(payload({ frame_time: frame })));
    const p = new NowcastWeatherProvider(env);
    await p.refresh();

    avanza(ORIZZONTE + MINUTI);
    expect(p.isAvailable()).toBe(false);

    frame = FRAME + 300; // NOWCAST ha elaborato un frame nuovo
    await p.refresh();
    expect(p.isAvailable()).toBe(true);
    expect(p.cells()).toHaveLength(1);
  });
});

describe('gli orologi di NOWCAST e del telefono restano separati', () => {
  it('frame_time molto AVANTI rispetto al telefono: nessuno scarto', async () => {
    // In simulazione i due orologi possono non avere alcuna relazione.
    const { env } = makeEnv(payload({ frame_time: FRAME + 10 * 365 * 24 * 3600 }));
    const p = new NowcastWeatherProvider(env);
    await p.refresh();
    expect(p.isAvailable()).toBe(true);
    expect(p.cells()).toHaveLength(1);
  });

  it('frame_time molto INDIETRO rispetto al telefono: nessuno scarto', async () => {
    const { env } = makeEnv(payload({ frame_time: 1 }));
    const p = new NowcastWeatherProvider(env);
    await p.refresh();
    expect(p.isAvailable()).toBe(true);
    expect(p.cells()).toHaveLength(1);
  });

  it('con il telefono INDIETRO il feed scade comunque', async () => {
    // Il verso pericoloso della vecchia implementazione: la differenza fra
    // i due orologi diventava negativa e il feed non scadeva mai.
    const { env, avanza } = makeEnv(payload({ frame_time: FRAME + 999_999 }));
    const p = new NowcastWeatherProvider(env);
    await p.refresh();
    avanza(ORIZZONTE + MINUTI);
    expect(p.isAvailable()).toBe(false);
  });

  it('issued_at avanti o indietro non ha alcun effetto', async () => {
    for (const issued of [0, FRAME - 10 * 365 * 24 * 3600, FRAME + 10 * 365 * 24 * 3600]) {
      const { env } = makeEnv(payload({}, { issued_at: issued }));
      const p = new NowcastWeatherProvider(env);
      await p.refresh();
      expect([issued, p.isAvailable(), p.cells().length]).toEqual([issued, true, 1]);
    }
  });

  it('issued_at non compare nel codice del provider', () => {
    // La freschezza non puo' dipendere da un campo che appartiene a un altro
    // orologio: il modo piu' sicuro e' non leggerlo affatto.
    const source = readFileSync(resolve(ROOT, 'src/weather/NowcastWeatherProvider.ts'), 'utf8');
    const codice = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(codice).not.toMatch(/issued_at/);
    // E nemmeno i due campi che non devono essere reinterpretati come eta'.
    expect(codice).not.toMatch(/age_minutes|eta_dato_min/);
  });
});

describe('dati dichiarati fermi', () => {
  it('rendono il feed immediatamente inutilizzabile', async () => {
    let fermi = false;
    const { env } = makeEnv(() => Promise.resolve(payload({ dati_fermi: fermi })));
    const p = new NowcastWeatherProvider(env);
    await p.refresh();
    expect(p.isAvailable()).toBe(true);

    fermi = true;
    await p.refresh();
    expect(p.isAvailable()).toBe(false);
    expect(p.cells()).toEqual([]);
  });

  it('un rifiuto non azzera l\'eta\' del frame', async () => {
    // Se il rifiuto resettasse la contabilita', lo stesso frame rifiutato e
    // poi riaccettato ripartirebbe da zero.
    let fermi = false;
    const { env, avanza } = makeEnv(() => Promise.resolve(payload({ dati_fermi: fermi })));
    const p = new NowcastWeatherProvider(env);
    await p.refresh();

    avanza(ORIZZONTE - MINUTI);
    fermi = true;
    await p.refresh();
    expect(p.isAvailable()).toBe(false);

    avanza(2 * MINUTI);
    fermi = false;
    await p.refresh(); // stesso frame_time, ora accettato
    expect(p.isAvailable()).toBe(false); // il frame e' comunque vecchio
  });
});

describe('attesa fra due richieste', () => {
  it('a regime e\' l\'intervallo previsto, con sfasamento', async () => {
    const { env } = makeEnv(payload());
    const p = new NowcastWeatherProvider(env);
    await p.refresh();
    const d = p.nextDelayMs();
    expect(d).toBeGreaterThanOrEqual(WEATHER.nowcast.pollMs - WEATHER.nowcast.jitterMs);
    expect(d).toBeLessThanOrEqual(WEATHER.nowcast.pollMs + WEATHER.nowcast.jitterMs);
  });

  it('dopo errori consecutivi l\'attesa cresce e non supera il tetto', async () => {
    const { env } = makeEnv(() => Promise.reject(new Error('giu')));
    const p = new NowcastWeatherProvider(env);
    const attese: number[] = [];
    for (let i = 0; i < 5; i++) {
      await p.refresh();
      attese.push(p.nextDelayMs());
    }
    const tetto = WEATHER.nowcast.backoffMs[WEATHER.nowcast.backoffMs.length - 1] as number;
    expect(attese[0]!).toBeLessThan(attese[2]!);
    for (const a of attese) expect(a).toBeLessThanOrEqual(tetto + WEATHER.nowcast.jitterMs);
  });

  it('un successo azzera l\'arretramento', async () => {
    let giu = true;
    const { env } = makeEnv(() => (giu ? Promise.reject(new Error('giu')) : Promise.resolve(payload())));
    const p = new NowcastWeatherProvider(env);
    await p.refresh();
    await p.refresh();
    giu = false;
    await p.refresh();
    expect(p.nextDelayMs()).toBeLessThanOrEqual(WEATHER.nowcast.pollMs + WEATHER.nowcast.jitterMs);
  });

  it('una sola richiesta in volo per volta', async () => {
    let sblocca: (v: unknown) => void = () => undefined;
    const { env, get } = makeEnv(() => new Promise((r) => (sblocca = r)));
    const p = new NowcastWeatherProvider(env);
    const a = p.refresh();
    const b = p.refresh();
    sblocca(payload());
    await Promise.all([a, b]);
    expect(get.mock.calls).toHaveLength(1);
  });
});
