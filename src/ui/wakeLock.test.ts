/**
 * ROAD SENSE - verifiche sul blocco schermo.
 *
 * Nascono da un audit: la versione precedente chiedeva un nuovo blocco a ogni
 * ritorno di visibilita', anche quando ne possedeva gia' uno valido, e il
 * riferimento al precedente andava perso senza essere rilasciato.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  WakeLockController,
  type WakeLockEnvironment,
  type WakeLockSentinelLike,
  type WakeLockStatus,
} from './wakeLockController';

/** Sentinella finta che si comporta come quella del browser. */
class FakeSentinel implements WakeLockSentinelLike {
  released = false;
  private listeners = new Set<() => void>();
  constructor(readonly serial: number) {}

  release = vi.fn(async () => {
    this.released = true;
    this.fire();
  });

  addEventListener(type: string, listener: () => void): void {
    if (type === 'release') this.listeners.add(listener);
  }
  removeEventListener(_type: string, listener: () => void): void {
    this.listeners.delete(listener);
  }
  /** Simula il rilascio deciso dal sistema, es. passando in secondo piano. */
  releasedBySystem(): void {
    this.released = true;
    this.fire();
  }
  private fire(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** Ambiente pilotabile: visibilita', esito della richiesta, sentinelle create. */
function makeEnv(options: { supported?: boolean; failing?: boolean } = {}) {
  const supported = options.supported ?? true;
  let visible = true;
  let serial = 0;
  const created: FakeSentinel[] = [];
  const listeners = new Set<() => void>();
  let pending: Array<() => void> = [];

  const env: WakeLockEnvironment = {
    request: supported
      ? () =>
          new Promise<WakeLockSentinelLike>((resolve, reject) => {
            const settle = () => {
              if (options.failing) {
                reject(new Error('non consentito'));
                return;
              }
              const s = new FakeSentinel(++serial);
              created.push(s);
              resolve(s);
            };
            pending.push(settle);
          })
      : null,
    isVisible: () => visible,
    onVisibilityChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    env,
    created,
    /** Completa tutte le richieste in attesa. */
    async settle() {
      const toSettle = pending;
      pending = [];
      for (const fn of toSettle) fn();
      await Promise.resolve();
      await Promise.resolve();
    },
    inFlight: () => pending.length,
    setVisible(value: boolean) {
      visible = value;
      for (const l of [...listeners]) l();
    },
    listenerCount: () => listeners.size,
  };
}

function track() {
  const stati: WakeLockStatus[] = [];
  return { stati, push: (s: WakeLockStatus) => stati.push(s) };
}

describe('1. su START viene chiesto il blocco schermo', () => {
  it('chiede subito request("screen")', async () => {
    const harness = makeEnv();
    const spy = vi.spyOn(harness.env, 'request' as never);
    const controller = new WakeLockController(harness.env);
    controller.start();
    expect(harness.inFlight()).toBe(1);
    await harness.settle();
    expect(controller.isHeld()).toBe(true);
    expect(spy).toBeDefined();
  });

  it('lo stato diventa attivo', async () => {
    const harness = makeEnv();
    const t = track();
    const controller = new WakeLockController(harness.env, t.push);
    controller.start();
    await harness.settle();
    expect(controller.currentStatus()).toBe('active');
    expect(t.stati).toContain('active');
  });
});

describe('2. resta attivo durante il monitoraggio', () => {
  it('non viene rilasciato da solo', async () => {
    const harness = makeEnv();
    const controller = new WakeLockController(harness.env);
    controller.start();
    await harness.settle();
    await harness.settle();
    expect(controller.isHeld()).toBe(true);
    expect(harness.created[0]!.release).not.toHaveBeenCalled();
  });
});

describe('3. riacquisizione quando la pagina torna visibile', () => {
  it('se il sistema lo ha rilasciato, lo riprende', async () => {
    const harness = makeEnv();
    const controller = new WakeLockController(harness.env);
    controller.start();
    await harness.settle();

    // Il browser lo toglie passando in secondo piano.
    harness.created[0]!.releasedBySystem();
    harness.setVisible(false);
    expect(controller.isHeld()).toBe(false);
    expect(controller.currentStatus()).toBe('idle');

    // Tornando visibili viene ripreso.
    harness.setVisible(true);
    await harness.settle();
    expect(controller.isHeld()).toBe(true);
    expect(controller.currentStatus()).toBe('active');
    expect(harness.created).toHaveLength(2);
  });

  it('a pagina nascosta non prova nemmeno a chiederlo', async () => {
    const harness = makeEnv();
    const controller = new WakeLockController(harness.env);
    controller.start();
    await harness.settle();
    harness.created[0]!.releasedBySystem();
    harness.setVisible(false);
    // Nessuna richiesta in volo: a pagina nascosta fallirebbe comunque.
    expect(harness.inFlight()).toBe(0);
  });
});

describe('4. su STOP viene sempre rilasciato', () => {
  it('rilascia la sentinella posseduta', async () => {
    const harness = makeEnv();
    const controller = new WakeLockController(harness.env);
    controller.start();
    await harness.settle();
    controller.stop();
    expect(harness.created[0]!.release).toHaveBeenCalledTimes(1);
    expect(controller.isHeld()).toBe(false);
    expect(controller.currentStatus()).toBe('idle');
  });

  it('rilascia anche se la richiesta era ancora in volo', async () => {
    const harness = makeEnv();
    const controller = new WakeLockController(harness.env);
    controller.start();
    // Stop PRIMA che la richiesta si concluda.
    controller.stop();
    await harness.settle();
    expect(harness.created[0]!.release).toHaveBeenCalledTimes(1);
    expect(controller.isHeld()).toBe(false);
  });

  it('smette di ascoltare i cambi di visibilita\'', async () => {
    const harness = makeEnv();
    const controller = new WakeLockController(harness.env);
    controller.start();
    await harness.settle();
    expect(harness.listenerCount()).toBe(1);
    controller.stop();
    expect(harness.listenerCount()).toBe(0);
  });

  it('dopo lo stop un ritorno di visibilita\' non riaccende nulla', async () => {
    const harness = makeEnv();
    const controller = new WakeLockController(harness.env);
    controller.start();
    await harness.settle();
    controller.stop();
    harness.setVisible(false);
    harness.setVisible(true);
    await harness.settle();
    expect(harness.created).toHaveLength(1);
  });
});

describe('5. senza supporto l\'app continua senza errori', () => {
  it('dichiara lo stato e non lancia', () => {
    const harness = makeEnv({ supported: false });
    const t = track();
    const controller = new WakeLockController(harness.env, t.push);
    expect(controller.currentStatus()).toBe('unsupported');
    expect(() => controller.start()).not.toThrow();
    expect(() => controller.stop()).not.toThrow();
    expect(controller.isHeld()).toBe(false);
  });

  it('una richiesta rifiutata non interrompe il monitoraggio', async () => {
    const harness = makeEnv({ failing: true });
    const controller = new WakeLockController(harness.env);
    controller.start();
    await harness.settle();
    expect(controller.currentStatus()).toBe('idle');
    expect(controller.isHeld()).toBe(false);
    expect(() => controller.stop()).not.toThrow();
  });
});

describe('6. mai piu\' di un blocco per volta', () => {
  it('tornare visibili con il blocco ancora valido NON ne crea un altro', async () => {
    const harness = makeEnv();
    const controller = new WakeLockController(harness.env);
    controller.start();
    await harness.settle();

    // Il sistema NON lo ha rilasciato: la pagina torna visibile e basta.
    harness.setVisible(true);
    harness.setVisible(true);
    await harness.settle();

    expect(harness.created).toHaveLength(1);
    expect(controller.isHeld()).toBe(true);
  });

  it('due richieste sovrapposte non producono due sentinelle', async () => {
    const harness = makeEnv();
    const controller = new WakeLockController(harness.env);
    controller.start();
    // Cambio di visibilita' mentre la prima richiesta e' ancora in volo.
    harness.setVisible(true);
    harness.setVisible(true);
    expect(harness.inFlight()).toBe(1);
    await harness.settle();
    expect(harness.created).toHaveLength(1);
  });

  it('start chiamata due volte non raddoppia il blocco', async () => {
    const harness = makeEnv();
    const controller = new WakeLockController(harness.env);
    controller.start();
    controller.start();
    await harness.settle();
    expect(harness.created).toHaveLength(1);
  });

  it('nessuna sentinella resta senza essere rilasciata', async () => {
    const harness = makeEnv();
    const controller = new WakeLockController(harness.env);
    controller.start();
    await harness.settle();

    // Ciclo completo: perso dal sistema, ripreso, e cosi' via.
    for (let i = 0; i < 3; i++) {
      harness.created.at(-1)!.releasedBySystem();
      harness.setVisible(false);
      harness.setVisible(true);
      await harness.settle();
    }
    controller.stop();

    // Ogni sentinella creata e' stata o rilasciata dal sistema o da noi.
    expect(harness.created.length).toBe(4);
    for (const s of harness.created) expect(s.released).toBe(true);
  });
});
