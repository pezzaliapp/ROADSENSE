/**
 * ROAD SENSE - EventStore.
 *
 * Archivio LOCALE degli eventi (propri e ricevuti dal backend).
 * - persistenza su localStorage, sopravvive alla chiusura dell'app;
 * - applicazione del TTL per categoria a ogni lettura e scrittura;
 * - deduplicazione per id;
 * - tetto massimo di eventi conservati (i piu' vecchi cadono per primi);
 * - separazione totale tra dati reali e dati DEMO (chiavi diverse).
 *
 * NON conserva tracce GPS: solo eventi puntuali.
 */

import { STORAGE, TTL_MS } from '../config/config';
import type { RoadEvent } from './types';

export class EventStore {
  private key: string;
  private events: RoadEvent[] = [];
  private listeners = new Set<() => void>();

  constructor(demo: boolean) {
    this.key = demo ? STORAGE.eventsKeyDemo : STORAGE.eventsKey;
    this.events = this.load();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Eventi vivi (TTL applicato). */
  all(now: number = Date.now()): RoadEvent[] {
    return this.events.filter((e) => now - e.ts <= TTL_MS[e.type]);
  }

  /** Aggiunge eventi, ignorando i duplicati per id. Ritorna quanti ne ha aggiunti. */
  add(incoming: readonly RoadEvent[], now: number = Date.now()): number {
    if (incoming.length === 0) return 0;
    const known = new Set(this.events.map((e) => e.id));
    let added = 0;
    for (const ev of incoming) {
      if (known.has(ev.id)) continue;
      if (now - ev.ts > TTL_MS[ev.type]) continue; // gia' scaduto all'arrivo
      this.events.push(ev);
      known.add(ev.id);
      added++;
    }
    if (added > 0) {
      this.compact(now);
      this.persist();
      this.emit();
    }
    return added;
  }

  /** Rimuove gli eventi scaduti. Va chiamato periodicamente. */
  purge(now: number = Date.now()): number {
    const before = this.events.length;
    this.events = this.events.filter((e) => now - e.ts <= TTL_MS[e.type]);
    const removed = before - this.events.length;
    if (removed > 0) {
      this.persist();
      this.emit();
    }
    return removed;
  }

  /** Cancella tutto l'archivio (usato dal comando "cancella dati locali"). */
  clear(): void {
    this.events = [];
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* storage non disponibile */
    }
    this.emit();
  }

  // -- interni --------------------------------------------------------------

  private compact(now: number): void {
    this.events = this.events.filter((e) => now - e.ts <= TTL_MS[e.type]);
    if (this.events.length > STORAGE.maxEvents) {
      this.events.sort((a, b) => a.ts - b.ts);
      this.events = this.events.slice(this.events.length - STORAGE.maxEvents);
    }
  }

  private load(): RoadEvent[] {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const now = Date.now();
      return parsed.filter(
        (e): e is RoadEvent =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as RoadEvent).id === 'string' &&
          typeof (e as RoadEvent).lat === 'number' &&
          typeof (e as RoadEvent).lon === 'number' &&
          typeof (e as RoadEvent).ts === 'number' &&
          typeof (e as RoadEvent).type === 'string' &&
          TTL_MS[(e as RoadEvent).type] !== undefined &&
          now - (e as RoadEvent).ts <= TTL_MS[(e as RoadEvent).type],
      );
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.events));
    } catch {
      // Quota superata o storage negato: ROAD SENSE continua a funzionare
      // in memoria per la sessione corrente.
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
