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

describe('segnalazioni di giorni fa: dati legittimi, non residui', () => {
  /**
   * Sull'iPhone, dopo un aggiornamento, erano ancora presenti una sessantina
   * di segnalazioni di due giorni prima. Non e' un difetto: e' il motivo per
   * cui ROAD SENSE esiste. Una buca non sparisce in due giorni, e il TTL lo
   * dice esplicitamente.
   *
   * Questo test fissa l'intenzione, cosi' che nessuno "ripulisca" per sbaglio
   * dati che l'utente ha prodotto e che servono ancora.
   */
  const GIORNO = 24 * 60 * 60 * 1000;

  it('una buca di due giorni fa e ancora viva: il suo TTL e 45 giorni', () => {
    expect(TTL_MS.pothole).toBe(45 * GIORNO);
    const store = new EventStore(false);
    store.clear();
    const ora = Date.now();
    store.add([ev({ type: 'pothole', ts: ora - 2 * GIORNO })], ora);
    expect(store.all(ora)).toHaveLength(1);
  });

  it('cio che e davvero scaduto viene tolto alla lettura', () => {
    // La pulizia c'e' ed e' automatica: si applica a ogni lettura e scrittura.
    const store = new EventStore(false);
    store.clear();
    const ora = Date.now();
    store.add([ev({ type: 'pothole', ts: ora - 46 * GIORNO })], ora);
    expect(store.all(ora)).toHaveLength(0);
  });

  it('i tipi effimeri scadono in fretta, quelli persistenti no', () => {
    // Un contromano dura minuti, una buca settimane: le due cose non possono
    // avere la stessa scadenza.
    expect(TTL_MS.wrong_way).toBeLessThan(TTL_MS.pothole);
    expect(TTL_MS.accident).toBeLessThan(TTL_MS.roadworks);
    expect(TTL_MS.pothole).toBeGreaterThan(30 * GIORNO);
  });

  it('sessanta segnalazioni di due giorni fa sopravvivono tutte', () => {
    // E' esattamente il caso osservato sull'iPhone.
    const store = new EventStore(false);
    store.clear();
    const ora = Date.now();
    for (let i = 0; i < 60; i++) {
      store.add([ev({ type: 'pothole', ts: ora - 2 * GIORNO, lat: 45 + i * 0.01 })], ora);
    }
    expect(store.all(ora)).toHaveLength(60);
  });
});
