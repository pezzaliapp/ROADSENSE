/**
 * ROAD SENSE - popolamento della DEMO MODE.
 *
 * Genera eventi "di altri utenti" lungo l'anello simulato, con un numero
 * crescente di segnalatori indipendenti, per mostrare come la confidenza
 * aumenta con la concordanza dei rilevamenti.
 *
 * Tutti gli eventi prodotti qui hanno `demo: true` e non lasciano mai il
 * dispositivo.
 */

import { destinationPoint, normalizeDeg } from './geo';
import { newEventId } from './anonId';
import type { EventType, RoadEvent, Severity } from './types';

interface SeedSpec {
  /** Posizione lungo l'anello, 0..1. */
  at: number;
  type: EventType;
  severity: Severity;
  /** Numero di segnalatori indipendenti simulati. */
  reporters: number;
  source: 'auto' | 'manual';
  /** Minuti nel passato del rilevamento piu' recente. */
  ageMin: number;
}

const SPECS: SeedSpec[] = [
  { at: 0.05, type: 'water', severity: 2, reporters: 3, source: 'manual', ageMin: 25 },
  { at: 0.22, type: 'pothole', severity: 3, reporters: 5, source: 'auto', ageMin: 90 },
  { at: 0.45, type: 'roadworks', severity: 1, reporters: 2, source: 'manual', ageMin: 300 },
  { at: 0.66, type: 'obstacle', severity: 2, reporters: 1, source: 'manual', ageMin: 12 },
  { at: 0.9, type: 'slippery', severity: 2, reporters: 4, source: 'manual', ageMin: 45 },
];

function fakeReporterId(seed: number): string {
  // Identificatori anonimi finti ma formalmente validi (16 hex).
  return (seed * 0x9e3779b1).toString(16).padStart(16, '0').slice(-16);
}

/** Costruisce gli eventi demo attorno a un centro e a un raggio dati. */
export function buildDemoEvents(
  center: { lat: number; lon: number },
  radiusM: number,
  now: number = Date.now(),
): RoadEvent[] {
  const out: RoadEvent[] = [];
  let seed = 1;

  for (const spec of SPECS) {
    const angle = spec.at * 360;
    const base = destinationPoint(center, angle, radiusM);
    const heading = normalizeDeg(angle + 90);

    for (let i = 0; i < spec.reporters; i++) {
      // Ogni segnalatore vede il punto con qualche metro di scarto: e'
      // esattamente cio' che il ConfidenceEngine deve saper aggregare.
      // Scarto contenuto (max ~10 m): resta dentro il raggio di unione anche
      // per la categoria piu' stretta, la buca.
      const jitter = destinationPoint(base, (i * 97) % 360, 2 + i * 2);
      out.push({
        id: newEventId(),
        lat: jitter.lat,
        lon: jitter.lon,
        ts: now - (spec.ageMin + i * 7) * 60_000,
        type: spec.type,
        severity: spec.severity,
        source: spec.source,
        confidence: spec.source === 'manual' ? 0.8 : 0.45,
        heading,
        reporterId: fakeReporterId(seed++),
        demo: true,
      });
    }
  }

  return out;
}
