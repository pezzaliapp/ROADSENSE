/**
 * ROAD SENSE - popolamento della DEMO MODE.
 *
 * Genera eventi "di altri utenti" collocati SULLA STESSA ROUTE percorsa dal
 * veicolo simulato, leggermente spostati a lato per stare a ridosso della
 * carreggiata. Cosi' gli alert scattano davvero mentre ci si avvicina, e la
 * catena distanza -> direzione -> confidenza -> alert risulta verificabile.
 *
 * Il numero di segnalatori indipendenti cresce da un punto all'altro, per
 * mostrare come la confidenza aumenti con la concordanza dei rilevamenti.
 *
 * Tutti gli eventi prodotti qui hanno `demo: true` e non lasciano mai il
 * dispositivo.
 */

import { positionAtDistance, ROUTE_LENGTH_M } from '../demo/route';
import { destinationPoint, normalizeDeg } from './geo';
import { newEventId } from './anonId';
import type { EventType, RoadEvent, Severity } from './types';

interface SeedSpec {
  /** Posizione lungo il percorso, come frazione della lunghezza totale. */
  at: number;
  type: EventType;
  severity: Severity;
  /** Numero di segnalatori indipendenti simulati. */
  reporters: number;
  source: 'auto' | 'manual';
  /** Minuti nel passato del rilevamento piu' recente. */
  ageMin: number;
}

/**
 * Le posizioni sono scelte a distanza dalle anomalie automatiche (DEMO.anomalies)
 * per non sovrapporre i due meccanismi.
 */
const SPECS: SeedSpec[] = [
  { at: 0.05, type: 'water', severity: 2, reporters: 3, source: 'manual', ageMin: 25 },
  { at: 0.24, type: 'pothole', severity: 3, reporters: 5, source: 'auto', ageMin: 90 },
  { at: 0.47, type: 'roadworks', severity: 1, reporters: 2, source: 'manual', ageMin: 300 },
  { at: 0.7, type: 'obstacle', severity: 2, reporters: 1, source: 'manual', ageMin: 12 },
  { at: 0.92, type: 'slippery', severity: 2, reporters: 4, source: 'manual', ageMin: 45 },
];

/** Scostamento laterale dalla mezzeria, in metri: sul bordo della carreggiata. */
const LATERAL_OFFSET_M = 3;

function fakeReporterId(seed: number): string {
  // Identificatori anonimi finti ma formalmente validi (16 hex).
  return (seed * 0x9e3779b1).toString(16).padStart(16, '0').slice(-16);
}

/** Costruisce gli eventi demo lungo il percorso. */
export function buildDemoEvents(now: number = Date.now()): RoadEvent[] {
  const out: RoadEvent[] = [];
  let seed = 1;

  for (const spec of SPECS) {
    const base = positionAtDistance(spec.at * ROUTE_LENGTH_M);
    // Spostamento verso destra rispetto alla direzione di marcia.
    const side = destinationPoint(base, normalizeDeg(base.heading + 90), LATERAL_OFFSET_M);

    for (let i = 0; i < spec.reporters; i++) {
      // Ogni segnalatore vede il punto con qualche metro di scarto: e'
      // esattamente cio' che il ConfidenceEngine deve saper aggregare.
      // Lo scarto resta contenuto per non uscire dalla carreggiata.
      const jitter = destinationPoint(side, (i * 97) % 360, 2 + i * 1.5);
      out.push({
        id: newEventId(),
        lat: jitter.lat,
        lon: jitter.lon,
        ts: now - (spec.ageMin + i * 7) * 60_000,
        type: spec.type,
        severity: spec.severity,
        source: spec.source,
        confidence: spec.source === 'manual' ? 0.8 : 0.45,
        // La direzione dell'evento e' quella della strada: serve all'AlertEngine
        // per non allertare chi percorre la carreggiata opposta.
        heading: base.heading,
        reporterId: fakeReporterId(seed++),
        demo: true,
      });
    }
  }

  return out;
}
