/**
 * ROAD SENSE - client del backend collaborativo (OPZIONALE).
 *
 * COMPORTAMENTO PER DEFAULT: `API.base` e' vuoto, quindi nessuna chiamata di
 * rete viene mai effettuata e ROAD SENSE funziona in modalita' solo-locale.
 *
 * PRIVACY: si inviano EVENTI, NON TRACCE.
 * - la posizione continua non lascia mai il dispositivo;
 * - la richiesta di eventi vicini usa la posizione ARROTONDATA (~1 km) e non
 *   viene registrata dal server;
 * - nessun cookie, nessun header identificativo, nessuna cronologia.
 *
 * ROBUSTEZZA: qualunque errore (backend assente, offline, 404, JSON invalido)
 * degrada silenziosamente al funzionamento locale. Il backend non e' mai un
 * requisito per usare l'app.
 */

import { API } from '../config/config';
import type { RoadEvent } from '../core/types';
import { validateEvent } from '../core/validation';

export const backendEnabled = (): boolean => API.base.length > 0;

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API.timeoutMs);
  try {
    const res = await fetch(`${API.base}${path}`, {
      ...init,
      signal: controller.signal,
      // Nessuna credenziale: ROAD SENSE non ha sessioni.
      credentials: 'omit',
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) throw new Error('risposta non JSON');
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Invia uno o piu' eventi. Gli eventi DEMO non vengono mai inviati.
 * Ritorna true se l'invio e' riuscito.
 */
export async function postEvents(events: readonly RoadEvent[]): Promise<boolean> {
  if (!backendEnabled()) return false;
  const payload = events.filter((e) => !e.demo);
  if (payload.length === 0) return false;
  try {
    await request('/events', { method: 'POST', body: JSON.stringify({ events: payload }) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scarica gli eventi vicini. La posizione inviata e' volutamente arrotondata
 * a 2 decimali (~1 km) per non rivelare la posizione esatta al server.
 */
export async function fetchNearby(lat: number, lon: number, radiusM: number): Promise<RoadEvent[]> {
  if (!backendEnabled()) return [];
  const q = new URLSearchParams({
    lat: lat.toFixed(2),
    lon: lon.toFixed(2),
    radius: String(Math.round(radiusM)),
  });
  try {
    const data = await request(`/events?${q.toString()}`);
    if (typeof data !== 'object' || data === null) return [];
    const list = (data as { events?: unknown }).events;
    if (!Array.isArray(list)) return [];
    // Non ci si fida nemmeno del proprio backend: rivalidazione lato client.
    const out: RoadEvent[] = [];
    for (const raw of list) {
      // maxPastMs infinito: un evento a lungo TTL e' legittimamente vecchio.
      const r = validateEvent(raw, Date.now(), { maxPastMs: Number.POSITIVE_INFINITY });
      if (r.ok) out.push(r.value);
    }
    return out;
  } catch {
    return [];
  }
}
