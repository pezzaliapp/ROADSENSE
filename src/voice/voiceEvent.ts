/**
 * ROAD SENSE - da frase riconosciuta a evento.
 *
 * Il ponte fra il parser e il modello esistente. Volutamente sottile: la
 * comprensione sta nel parser, l'aggregazione nel ConfidenceEngine, qui c'e'
 * solo la traduzione.
 *
 * UNA SEGNALAZIONE VOCALE SINGOLA NON E' UN EVENTO CONFERMATO.
 * La confidenza assegnata sta sotto la soglia di allerta, esattamente come
 * per un singolo rilevamento automatico: serve la concordanza di un secondo
 * segnalatore indipendente. E' lo stesso principio applicato a una sorgente
 * diversa, non una regola nuova.
 */

import { PRIVACY, VOICE } from '../config/config';
import { newEventId } from '../core/anonId';
import { roundCoord } from '../core/geo';
import type { GeoSample, RoadEvent } from '../core/types';
import { hazardFamily } from '../hazard/taxonomy';
import type { ParsedVoiceReport } from './parser';

export interface VoiceEventOptions {
  reporterId: string;
  demo?: boolean;
  now?: number;
}

/**
 * Costruisce l'evento a partire dalla frase e dalla posizione corrente.
 *
 * Posizione, direzione, velocita' e istante arrivano dai sensori: chi guida
 * non deve dettarli, ed e' esattamente il punto di ZERO TOUCH.
 * Restituisce `null` senza posizione: una segnalazione senza coordinate non
 * servirebbe a nessuno.
 */
export function buildVoiceEvent(
  report: ParsedVoiceReport,
  geo: GeoSample | null,
  options: VoiceEventOptions,
): RoadEvent | null {
  if (!geo) return null;

  const now = options.now ?? Date.now();
  const event: RoadEvent = {
    id: newEventId(),
    lat: roundCoord(geo.lat, PRIVACY.coordDecimals),
    lon: roundCoord(geo.lon, PRIVACY.coordDecimals),
    ts: now,
    type: hazardFamily(report.hazard),
    // La severita' NON viene dedotta dalla frase: l'urgenza e' una proprieta'
    // della categoria (HazardPriority), non di come e' stata raccontata.
    severity: 2,
    source: 'voice',
    confidence: VOICE.singleReportConfidence,
    heading: geo.heading,
    reporterId: options.reporterId,
    hazard: report.hazard,
    rawTranscript: report.transcript,
  };

  // Solo cio' che e' stato pronunciato davvero.
  if (report.subject) event.subject = report.subject;
  if (report.state) event.state = report.state;
  if (report.lane) event.lane = report.lane;
  if (options.demo) event.demo = true;

  return event;
}
