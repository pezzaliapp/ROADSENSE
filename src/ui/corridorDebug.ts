/**
 * ROAD SENSE - cosa sta facendo il corridoio, in chiaro.
 *
 * Serve a un solo scopo: verificare su un telefono reale se il ramo
 * `road-geometry` funziona davvero. `querySourceFeatures` non esiste in Node,
 * quindi nessun test automatico puo' dimostrarlo: si dimostra guardandolo.
 *
 * NON TOCCA IL CORRIDOIO
 * Il motivo del ripiego non viene calcolato dentro `forwardCorridor.ts`: si
 * deduce qui, da fuori, dai dati che il corridoio ha gia' prodotto e dal
 * contesto in cui e' stato costruito. Il modulo che decide resta invariato,
 * e l'osservazione non puo' alterare cio' che osserva.
 *
 * NON CONSERVA NULLA
 * Conteggi e stati, mai coordinate. Nessuna cronologia, nessuna persistenza:
 * il valore vive finche' e' a schermo e sparisce chiudendo la pagina.
 */

import type { CorridorSource, CorridorStatus, ForwardCorridor } from '../core/forwardCorridor';
import { CORRIDOR } from '../config/config';

/**
 * Perche' il corridoio non e' agganciato alla strada.
 *
 *   no-heading              direzione sconosciuta: non esiste un "davanti"
 *   low-speed               troppo lenti perche' la direzione GPS valga
 *   no-road-features        la mappa non ha consegnato alcuna geometria
 *   insufficient-geometry   geometria presente ma nessuna strada agganciabile
 *                           (troppo lontana, o trasversale alla marcia)
 *   ambiguous               agganciato, ma fermato a una biforcazione
 */
export type CorridorFallbackReason =
  | 'no-heading'
  | 'low-speed'
  | 'no-road-features'
  | 'insufficient-geometry'
  | 'ambiguous'
  | null;

export interface CorridorDebug {
  source: CorridorSource;
  status: CorridorStatus;
  roadEvidence: boolean;
  confidence: number;
  /** Geometrie stradali candidate consegnate dalla mappa. */
  roadFeatures: number;
  /** Punti che compongono il corridoio. */
  points: number;
  /** Lunghezza approssimata, m. */
  lengthM: number;
  reason: CorridorFallbackReason;
}

export interface CorridorContext {
  heading: number | null;
  speedMps: number | null;
  /** Quante polilinee ha restituito la mappa per questa posizione. */
  roadFeatures: number;
}

/**
 * Fotografia leggibile del corridoio. Funzione pura: non legge la UI, non
 * conserva stato, non puo' modificare nulla.
 */
export function corridorDebug(
  corridor: ForwardCorridor | null | undefined,
  context: CorridorContext,
): CorridorDebug {
  const base = {
    roadFeatures: context.roadFeatures,
    confidence: corridor?.confidence ?? 0,
    points: corridor?.points.length ?? 0,
    lengthM: Math.round(corridor?.lengthM ?? 0),
  };

  if (!corridor || corridor.source === 'none') {
    return {
      ...base,
      source: 'none',
      status: 'unavailable',
      roadEvidence: false,
      reason: motivoAssenza(context),
    };
  }

  return {
    ...base,
    source: corridor.source,
    status: corridor.status,
    roadEvidence: corridor.roadEvidence,
    reason:
      corridor.source === 'heading'
        ? context.roadFeatures === 0
          ? 'no-road-features'
          : 'insufficient-geometry'
        : corridor.status === 'uncertain'
          ? 'ambiguous'
          : null,
  };
}

/** Quale delle due precondizioni e' mancata. */
function motivoAssenza(context: CorridorContext): CorridorFallbackReason {
  if (context.heading === null || !Number.isFinite(context.heading)) return 'no-heading';
  if (
    context.speedMps === null ||
    !Number.isFinite(context.speedMps) ||
    context.speedMps < CORRIDOR.minSpeedMps
  ) {
    return 'low-speed';
  }
  return null;
}
