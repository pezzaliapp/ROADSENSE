/**
 * ROAD SENSE - verifiche sulle correzioni emerse dall'audit pre-beta.
 *
 * Coprono il permesso ai sensori su iOS, l'onesta' dell'indicatore SENSORI e
 * l'assenza di formule che facciano credere a una rete collaborativa che non
 * esiste ancora.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SENSORS } from '../config/config';
import { SensorEngine } from './SensorEngine';
import { installMemoryStorage } from './testUtils';
import type { SensorProvider, SensorProviderEvents } from './sensors/SensorProvider';
import type { SensorCapabilities, SystemStatus } from './types';

installMemoryStorage();
const ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Legge un file tenendo solo il CODICE.
 *
 * I commenti di ROAD SENSE parlano volutamente di iOS, di await e di wizard
 * per spiegare le scelte fatte: cercarli nel testo grezzo farebbe fallire i
 * test proprio per merito della documentazione.
 */
function code(...parts: string[]): string {
  const raw = readFileSync(resolve(ROOT, ...parts), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/.*$/gm, '');
}

const FULL_CAPS: SensorCapabilities = {
  geolocation: true,
  accelerometer: true,
  gyroscope: true,
  orientation: true,
  needsMotionPermission: false,
};

/** Provider pilotabile a mano: dichiara i sensori ma emette solo su richiesta. */
class ScriptedProvider implements SensorProvider {
  readonly id = 'scripted';
  readonly label = 'pilotato';
  handlers: SensorProviderEvents = {};
  constructor(private readonly caps: SensorCapabilities = FULL_CAPS) {}
  async probe(): Promise<SensorCapabilities> {
    return this.caps;
  }
  async requestPermissions(): Promise<SensorCapabilities> {
    return this.caps;
  }
  async start(handlers: SensorProviderEvents): Promise<void> {
    this.handlers = handlers;
  }
  stop(): void {
    this.handlers = {};
  }
  emitMotion(verticalAccel: number | null, rotationRate: number | null): void {
    this.handlers.onMotion?.({ ts: Date.now(), verticalAccel, totalAccel: verticalAccel, rotationRate });
  }
}

describe('B1 - permesso movimento richiesto dal gesto utente', () => {
  const source = code('src', 'core', 'sensors', 'PhoneSensorProvider.ts');

  it('la richiesta parte PRIMA di qualunque await', () => {
    const body = source.slice(
      source.indexOf('async requestPermissions()'),
      source.indexOf('return this.caps;', source.indexOf('async requestPermissions()')),
    );
    const call = body.indexOf('beginMotionPermissionRequest()');
    const firstAwait = body.indexOf('await ');
    expect(call).toBeGreaterThan(-1);
    expect(firstAwait).toBeGreaterThan(-1);
    expect(call).toBeLessThan(firstAwait);
  });

  it('la funzione che avvia la richiesta e\' sincrona', () => {
    // Se fosse async, il solo chiamarla introdurrebbe un microtask.
    expect(source).toMatch(
      /function beginMotionPermissionRequest\(\): Promise<'granted' \| 'denied' \| 'default'> \| null/,
    );
    expect(source).not.toMatch(/async function beginMotionPermissionRequest/);
  });

  it('nessun ramo specifico per piattaforma: dove l\'API manca si prosegue', () => {
    expect(source).toMatch(/if \(typeof api\?\.requestPermission !== 'function'\) return null;/);
    expect(source).not.toMatch(/iOS|iPhone|userAgent/);
  });

  it('la catena da App fino alla richiesta non contiene await intermedi', () => {
    const engine = code('src', 'core', 'SensorEngine.ts');
    const body = engine
      .slice(
        engine.indexOf('async start(handlers: SensorEngineHandlers)'),
        engine.indexOf('await this.provider.requestPermissions()'),
      )
      // La guardia di rientro contiene un await, ma esce prima: e' un ramo
      // che non raggiunge mai la richiesta di permessi.
      .split('\n')
      .filter((line) => !line.includes('if (this.running) return'))
      .join('\n');
    expect(body).not.toMatch(/await /);
  });
});

describe('N4 - errore dei permessi gestito in un solo posto', () => {
  it('il provider non tenta di notificare da solo', () => {
    const source = code('src', 'core', 'sensors', 'PhoneSensorProvider.ts');
    const body = source.slice(
      source.indexOf('async requestPermissions()'),
      source.indexOf('async start(', source.indexOf('async requestPermissions()')),
    );
    expect(body).not.toMatch(/this\.handlers\.onError/);
  });

  it('App distingue permesso negato da sensore assente', () => {
    const app = code('src', 'App.tsx');
    expect(app).toMatch(/caps\.needsMotionPermission/);
    expect(app).toMatch(/Accesso ai sensori di movimento negato/);
    expect(app).toMatch(/Sensori di movimento non disponibili/);
  });
});

describe('N1 - lo stato SENSORI riflette i dati, non l\'esistenza dell\'API', () => {
  let stati: SystemStatus['sensors'][];

  beforeEach(() => {
    vi.useFakeTimers();
    stati = [];
  });
  afterEach(() => vi.useRealTimers());

  const avvia = async (provider: ScriptedProvider) => {
    const engine = new SensorEngine(provider);
    await engine.start({ onStatus: (_gps, sensors) => stati.push(sensors) });
    return engine;
  };

  it('durante l\'attesa non dichiara i sensori funzionanti', async () => {
    const engine = await avvia(new ScriptedProvider());
    expect(stati.at(-1)).toBe('partial');
    expect(engine.hasMotionData()).toBe(false);
    engine.stop();
  });

  it('senza alcun dato, allo scadere dell\'attesa dichiara i sensori assenti', async () => {
    const engine = await avvia(new ScriptedProvider());
    await vi.advanceTimersByTimeAsync(SENSORS.motionGraceMs + 100);
    expect(stati.at(-1)).toBe('off');
    expect(engine.hasMotionData()).toBe(false);
    engine.stop();
  });

  it('con dati reali di accelerometro e giroscopio dichiara ok', async () => {
    const provider = new ScriptedProvider();
    const engine = await avvia(provider);
    provider.emitMotion(0.4, 3);
    expect(stati.at(-1)).toBe('ok');
    expect(engine.hasMotionData()).toBe(true);
    // E resta ok anche dopo la finestra di attesa.
    await vi.advanceTimersByTimeAsync(SENSORS.motionGraceMs + 100);
    expect(stati.at(-1)).toBe('ok');
    engine.stop();
  });

  it('con accelerometro ma senza giroscopio resta parziale', async () => {
    const provider = new ScriptedProvider();
    const engine = await avvia(provider);
    provider.emitMotion(0.4, null);
    await vi.advanceTimersByTimeAsync(SENSORS.motionGraceMs + 100);
    expect(stati.at(-1)).toBe('partial');
    engine.stop();
  });

  it('un evento senza valori utili non conta come dato', async () => {
    const provider = new ScriptedProvider();
    const engine = await avvia(provider);
    provider.emitMotion(null, null);
    await vi.advanceTimersByTimeAsync(SENSORS.motionGraceMs + 100);
    expect(stati.at(-1)).toBe('off');
    expect(engine.hasMotionData()).toBe(false);
    engine.stop();
  });

  it('senza permesso l\'indicatore e\' spento fin da subito', async () => {
    const engine = await avvia(
      new ScriptedProvider({ ...FULL_CAPS, accelerometer: false, gyroscope: false }),
    );
    expect(stati.at(-1)).toBe('off');
    engine.stop();
  });

  it('lo stato non viene ricalcolato a ogni campione, ma solo sulle transizioni', async () => {
    const provider = new ScriptedProvider();
    const engine = await avvia(provider);
    const prima = stati.length;
    for (let i = 0; i < 50; i++) provider.emitMotion(0.3, 2);
    // Due transizioni: primo movimento e prima rotazione.
    expect(stati.length - prima).toBeLessThanOrEqual(2);
    engine.stop();
  });

  it('lo stop azzera lo stato: il riavvio riparte dall\'attesa', async () => {
    const provider = new ScriptedProvider();
    const engine = await avvia(provider);
    provider.emitMotion(0.4, 3);
    expect(engine.hasMotionData()).toBe(true);
    engine.stop();
    expect(engine.hasMotionData()).toBe(false);
  });

  it('il permesso negato alla posizione resta visibile anche dopo l\'attesa', () => {
    // Regressione possibile: il timer della finestra di attesa ricalcola lo
    // stato, e se "negato" vivesse fuori dal motore verrebbe sovrascritto.
    const engine = code('src', 'core', 'SensorEngine.ts');
    expect(engine).toMatch(/private geoDenied = false;/);
    expect(engine).toMatch(/this\.geoDenied \? 'denied' : 'off'/);
    // App non deve piu' dedurre da sola lo stato "negato": lo riceve.
    // Il reset a 'off' allo stop resta legittimo e non viene toccato.
    const app = code('src', 'App.tsx');
    expect(app).not.toMatch(/'denied'/);
  });

  it('l\'app prosegue comunque: GPS e segnalazione manuale restano', async () => {
    const provider = new ScriptedProvider({ ...FULL_CAPS, accelerometer: false });
    const engine = await avvia(provider);
    await vi.advanceTimersByTimeAsync(SENSORS.motionGraceMs + 100);
    // Nessuna eccezione, motore avviato, posizione ancora gestita.
    expect(engine.isRunning()).toBe(true);
    engine.stop();
  });
});

describe('N2 - nessuna falsa impressione di rete collaborativa', () => {
  const banner = code('src', 'ui', 'AlertBanner.tsx');
  const app = code('src', 'App.tsx');

  it('in modalita\' reale senza backend i rilevamenti sono del dispositivo', () => {
    expect(banner).toMatch(/RILEVAMENTO' : 'RILEVAMENTI'\} · QUESTO DISPOSITIVO/);
  });

  it('la parola "segnalazioni" resta solo per il caso con backend attivo', () => {
    const local = banner.slice(banner.indexOf("if (source === 'local')"));
    expect(local).toMatch(/SEGNALAZIONE' : 'SEGNALAZIONI'/);
    // e compare dopo il ramo locale, cioe' solo nel ramo di rete
    expect(banner.indexOf('QUESTO DISPOSITIVO')).toBeLessThan(banner.indexOf("'SEGNALAZIONI'"));
  });

  it('la demo continua a dichiarare i veicoli simulati', () => {
    expect(banner).toMatch(/ROAD SENSE · SIMULATO/);
  });

  it('App sceglie la formula in base a demo e disponibilita\' del backend', () => {
    expect(app).toMatch(/source=\{demo \? 'demo' : backendEnabled\(\) \? 'network' : 'local'\}/);
  });
});

describe('N3 - una sola riga di spiegazione', () => {
  const app = code('src', 'App.tsx');

  it('compare solo in modalita\' reale e a monitoraggio fermo', () => {
    expect(app).toMatch(/\{!demo && !running && \(\s*<p className="intro">/);
  });

  it('dice cosa usa e dove restano i dati', () => {
    expect(app).toMatch(/usa posizione e sensori del telefono/);
    expect(app).toMatch(/i dati restano sul dispositivo/);
  });

  it('non introduce registrazione, profilo o procedure guidate', () => {
    expect(app).not.toMatch(/registrazione|onboarding|wizard|tutorial|accedi|login/i);
  });
});

describe('N5 - una sola versione', () => {
  it('package.json, applicazione e service worker usano la stessa origine', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    const config = code('src', 'config', 'config.ts');
    const sw = code('public', 'sw.js');
    const vite = code('vite.config.ts');

    expect(config).toMatch(/version: __APP_VERSION__/);
    expect(sw).toMatch(/const VERSION = '__APP_VERSION__';/);
    expect(vite).toMatch(/JSON\.parse\(readFileSync\('\.\/package\.json', 'utf8'\)\)\.version/);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('la build sostituisce davvero il segnaposto nel service worker', () => {
    const vite = code('vite.config.ts');
    expect(vite).toMatch(/replaceAll\('__APP_VERSION__', APP_VERSION\)/);
    // Fallisce forte se il segnaposto sparisse per errore.
    expect(vite).toMatch(/non contiene il segnaposto __APP_VERSION__/);
  });
});
