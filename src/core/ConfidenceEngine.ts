/**
 * ROAD SENSE - ConfidenceEngine.
 *
 * PROBLEMA
 * Un singolo rilevamento automatico non e' una verita'. Un tombino, una
 * cinghia di sicurezza che sbatte, un telefono mal fissato possono generare un
 * falso positivo. Allo stesso tempo, una buca vera viene incontrata da molti
 * veicoli: e' la CONCORDANZA a produrre fiducia.
 *
 * METODO
 * 1) AGGREGAZIONE SPAZIALE
 *    Rilevamenti dello stesso tipo entro MERGE_RADIUS_M[type] formano un
 *    cluster. Il raggio dipende dalla categoria: una buca e' puntuale (20 m),
 *    un cantiere occupa un tratto (120 m).
 *
 * 2) AGGREGAZIONE DIREZIONALE
 *    Se i rilevamenti hanno direzioni di marcia coerenti, il cluster eredita
 *    una direzione: serve a non allertare chi percorre la carreggiata opposta.
 *    Se le direzioni sono discordi il cluster resta senza direzione e allerta
 *    tutti (scelta prudenziale).
 *
 * 3) PESO PER SEGNALATORE
 *    Ogni segnalatore anonimo contribuisce con firstReportWeight al primo
 *    rilevamento e con repeatReportWeight ai successivi, fino a un tetto
 *    (maxWeightPerReporter). Cosi' un singolo dispositivo che ripassa dieci
 *    volte non puo' "creare" da solo un evento confermato, ma il fatto che
 *    ripassi e rilevi ancora conta qualcosa.
 *    Le segnalazioni manuali pesano piu' di quelle automatiche: una persona
 *    ha visto il pericolo.
 *
 * 4) SATURAZIONE
 *    confidence_base = 1 - exp(-k * pesoTotale)
 *    Curva crescente e saturante: il secondo segnalatore aggiunge molto, il
 *    decimo quasi nulla. Nessuna soglia arbitraria a gradini.
 *
 * 5) DECADIMENTO TEMPORALE
 *    La confidenza viene moltiplicata per 0.5 + 0.5 * (TTL residuo / TTL),
 *    quindi un evento vicino alla scadenza vale al massimo meta'. Oltre il TTL
 *    l'evento sparisce del tutto (vedi EventStore).
 *
 * 6) INTENSITA'
 *    Rilevamenti gravi alzano leggermente la confidenza: un impatto forte e'
 *    meno probabilmente rumore.
 *
 * I parametri stanno tutti in config/config.ts.
 */

import { CONFIDENCE, MERGE_RADIUS_M, TTL_MS } from '../config/config';
import { averageHeading, distanceM } from './geo';
import type { ConfidenceLevel, EventCluster, RoadEvent, Severity } from './types';

/**
 * Raggruppa gli eventi in cluster e calcola la confidenza di ciascuno.
 * Gli eventi scaduti vengono ignorati.
 */
export function buildClusters(events: readonly RoadEvent[], now: number = Date.now()): EventCluster[] {
  const alive = events.filter((e) => !isExpired(e, now));
  // Ordine temporale: il cluster nasce dal rilevamento piu' vecchio e i
  // successivi vi si agganciano. Rende il risultato deterministico.
  const sorted = [...alive].sort((a, b) => a.ts - b.ts);

  const groups: RoadEvent[][] = [];

  for (const ev of sorted) {
    const radius = MERGE_RADIUS_M[ev.type];
    let placed = false;
    for (const group of groups) {
      const head = group[0] as RoadEvent;
      if (head.type !== ev.type) continue;
      const c = centroid(group);
      if (distanceM(c, { lat: ev.lat, lon: ev.lon }) <= radius) {
        group.push(ev);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([ev]);
  }

  return groups.map((group) => toCluster(group, now));
}

function toCluster(group: RoadEvent[], now: number): EventCluster {
  const head = group[0] as RoadEvent;
  const c = centroid(group);
  const lastTs = group.reduce((m, e) => Math.max(m, e.ts), 0);
  const ttl = TTL_MS[head.type];

  const headings = group
    .map((e) => e.heading)
    .filter((h): h is number => typeof h === 'number');

  const reporters = new Set(group.map((e) => e.reporterId));

  return {
    // Id stabile e deterministico: tipo + centroide arrotondato.
    id: `${head.type}:${c.lat.toFixed(4)}:${c.lon.toFixed(4)}`,
    lat: c.lat,
    lon: c.lon,
    type: head.type,
    severity: maxSeverity(group),
    confidence: clusterConfidence(group, lastTs, ttl, now),
    count: group.length,
    reporters: reporters.size,
    lastTs,
    heading: averageHeading(headings),
    expiresAt: lastTs + ttl,
    demo: group.some((e) => e.demo),
  };
}

/** Calcolo della confidenza aggregata. Funzione pura, testabile. */
export function clusterConfidence(
  group: readonly RoadEvent[],
  lastTs: number,
  ttlMs: number,
  now: number,
): number {
  // Peso per segnalatore, con tetto.
  const byReporter = new Map<string, number>();
  for (const ev of group) {
    const base = ev.source === 'manual' ? CONFIDENCE.manualWeight : CONFIDENCE.autoWeight * ev.confidence;
    const seen = byReporter.has(ev.reporterId);
    const contribution = base * (seen ? CONFIDENCE.repeatReportWeight : CONFIDENCE.firstReportWeight);
    const next = Math.min(
      CONFIDENCE.maxWeightPerReporter,
      (byReporter.get(ev.reporterId) ?? 0) + contribution,
    );
    byReporter.set(ev.reporterId, next);
  }

  let totalWeight = 0;
  for (const w of byReporter.values()) totalWeight += w;

  const base = 1 - Math.exp(-CONFIDENCE.saturationK * totalWeight);

  // Bonus intensita': eventi gravi sono meno probabilmente rumore.
  const avgSeverity = group.reduce((s, e) => s + e.severity, 0) / group.length;
  const intensityBonus = 0.05 * (avgSeverity - 1); // 0 .. 0.10

  // Decadimento temporale sul rilevamento piu' recente.
  const remaining = Math.max(0, 1 - (now - lastTs) / ttlMs);
  const freshness = 0.5 + 0.5 * remaining;

  const value = (base + intensityBonus) * freshness;
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

/** Soglie qualitative usate dalla UI. */
export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= CONFIDENCE.confirmed) return 'confirmed';
  if (confidence >= CONFIDENCE.probable) return 'probable';
  return 'possible';
}

export function isExpired(event: RoadEvent, now: number = Date.now()): boolean {
  return now - event.ts > TTL_MS[event.type];
}

function centroid(group: readonly RoadEvent[]): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  for (const e of group) {
    lat += e.lat;
    lon += e.lon;
  }
  return { lat: lat / group.length, lon: lon / group.length };
}

function maxSeverity(group: readonly RoadEvent[]): Severity {
  return group.reduce<Severity>((m, e) => (e.severity > m ? e.severity : m), 1);
}
