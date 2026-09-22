import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE, TTL_MS } from '../config/config';
import { EventStore } from './EventStore';
import { installMemoryStorage } from './testUtils';
import type { RoadEvent } from './types';

const storage = installMemoryStorage();
// Tempo reale: EventStore applica il TTL anche al caricamento da storage,
// quindi una base dei tempi fittizia nel passato risulterebbe gia' scaduta.
const NOW = Date.now();

let n = 0;
function ev(overrides: Partial<RoadEvent> = {}): RoadEvent {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    lat: 45.4642,
    lon: 9.19,
    ts: NOW,
    type: 'pothole',
    severity: 2,
    source: 'auto',
    confidence: 0.4,
    heading: 90,
    reporterId: '0123456789abcdef',
    ...overrides,
  };
}

describe('EventStore', () => {
  beforeEach(() => {
    storage.fail(false);
    storage.clear();
  });

  it('aggiunge e rilegge gli eventi', () => {
    const store = new EventStore(false);
    expect(store.add([ev(), ev()], NOW)).toBe(2);
    expect(store.all(NOW)).toHaveLength(2);
  });

  it('ignora i duplicati per id', () => {
    const store = new EventStore(false);
    const e = ev();
    store.add([e], NOW);
    expect(store.add([e], NOW)).toBe(0);
    expect(store.all(NOW)).toHaveLength(1);
  });

  it('non accetta eventi gia\' scaduti', () => {
    const store = new EventStore(false);
    const added = store.add([ev({ type: 'accident', ts: NOW - TTL_MS.accident - 1 })], NOW);
    expect(added).toBe(0);
  });

  it('nasconde gli eventi scaduti in lettura', () => {
    const store = new EventStore(false);
    store.add([ev({ type: 'water' })], NOW);
    expect(store.all(NOW)).toHaveLength(1);
    expect(store.all(NOW + TTL_MS.water + 1)).toHaveLength(0);
  });

  it('purge rimuove definitivamente gli scaduti', () => {
    const store = new EventStore(false);
    store.add([ev({ type: 'water' }), ev({ type: 'pothole' })], NOW);
    expect(store.purge(NOW + TTL_MS.water + 1)).toBe(1);
    expect(store.all(NOW + TTL_MS.water + 1)).toHaveLength(1);
  });

  it('persiste tra due istanze', () => {
    const a = new EventStore(false);
    a.add([ev()], NOW);
    const b = new EventStore(false);
    expect(b.all(NOW)).toHaveLength(1);
  });

  it('tiene separati dati reali e dati demo', () => {
    const reale = new EventStore(false);
    const demo = new EventStore(true);
    reale.add([ev()], NOW);
    demo.add([ev({ demo: true })], NOW);
    expect(reale.all(NOW)).toHaveLength(1);
    expect(demo.all(NOW)).toHaveLength(1);
    expect(reale.all(NOW).every((e) => !e.demo)).toBe(true);
    expect(demo.all(NOW).every((e) => e.demo)).toBe(true);
  });

  it('rispetta il tetto massimo di eventi conservati', () => {
    const store = new EventStore(false);
    const molti = Array.from({ length: STORAGE.maxEvents + 50 }, (_, i) => ev({ ts: NOW - i }));
    store.add(molti, NOW);
    expect(store.all(NOW).length).toBeLessThanOrEqual(STORAGE.maxEvents);
  });

  it('notifica i sottoscrittori', () => {
    const store = new EventStore(false);
    let chiamate = 0;
    const off = store.subscribe(() => chiamate++);
    store.add([ev()], NOW);
    expect(chiamate).toBe(1);
    off();
    store.add([ev()], NOW);
    expect(chiamate).toBe(1);
  });

  it('clear svuota l\'archivio', () => {
    const store = new EventStore(false);
    store.add([ev()], NOW);
    store.clear();
    expect(store.all(NOW)).toHaveLength(0);
  });

  it('continua a funzionare se lo storage non e\' disponibile', () => {
    storage.fail(true);
    const store = new EventStore(false);
    expect(store.all(NOW)).toHaveLength(0);
    expect(store.add([ev()], NOW)).toBe(1);
    expect(store.all(NOW)).toHaveLength(1); // in memoria per la sessione
  });

  it('ignora dati corrotti nello storage', () => {
    localStorage.setItem(STORAGE.eventsKey, '{non json');
    expect(new EventStore(false).all(NOW)).toHaveLength(0);
    localStorage.setItem(STORAGE.eventsKey, JSON.stringify([{ pippo: 1 }, null, 42]));
    expect(new EventStore(false).all(NOW)).toHaveLength(0);
  });
});
