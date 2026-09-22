/**
 * ROAD SENSE - traduzione da celle meteo ad aree disegnabili.
 *
 * Unico punto in cui il concetto "meteo" incontra il disegno della mappa.
 * MapView resta generico, e questo modulo puo' cambiare senza toccarlo.
 *
 * La posizione dell'area e' ESATTAMENTE quella della cella ricevuta: nessun
 * ricalcolo, nessuna interpolazione grafica. Se la cella arriva gia' portata
 * all'istante corrente, l'area disegnata e' l'istante corrente.
 */

import type { WeatherCell, WeatherKind } from '../weather/WeatherProvider';
import type { AreaOverlay } from './areaOverlay';
import { WEATHER_META } from './weatherMeta';

/**
 * Tratti visivi per fenomeno.
 *
 * La pioggia e' volutamente la piu' spenta: e' un contorno, non il soggetto.
 * La grandine si distingue per i punti interni, il downburst per i vettori
 * divergenti. Sono differenze di lettura, non effetti.
 */
const LOOK: Record<WeatherKind, Pick<AreaOverlay, 'fillOpacity' | 'pulse' | 'speckles' | 'gusts'>> =
  {
    heavyRain: { fillOpacity: 0.1, pulse: 0.12, speckles: 0, gusts: 0 },
    hail: { fillOpacity: 0.14, pulse: 0.3, speckles: 7, gusts: 0 },
    downburst: { fillOpacity: 0.11, pulse: 0.26, speckles: 0, gusts: 5 },
  };

export function weatherCellsToOverlays(
  cells: readonly WeatherCell[],
  phase: number,
): AreaOverlay[] {
  return cells.map((cell) => {
    const meta = WEATHER_META[cell.kind];
    return {
      id: cell.id,
      // Stessa posizione della cella: e' il punto di tutto il lavoro.
      lat: cell.lat,
      lon: cell.lon,
      radiusM: cell.radiusM,
      color: meta.color,
      driftHeading: cell.driftHeading,
      glyph: meta.glyph,
      // "NOWCAST" identifica la sorgente ipotetica del dato, non un servizio
      // realmente contattato.
      caption: 'NOWCAST',
      label: meta.label,
      ...LOOK[cell.kind],
      phase,
    };
  });
}
