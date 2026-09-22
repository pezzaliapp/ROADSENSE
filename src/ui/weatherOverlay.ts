/**
 * ROAD SENSE - traduzione da celle meteo ad aree disegnabili.
 *
 * Unico punto in cui il concetto "meteo" incontra il disegno della mappa.
 * MapView resta generico, e questo modulo puo' cambiare senza toccarlo.
 */

import type { WeatherCell } from '../weather/WeatherProvider';
import type { AreaOverlay } from './areaOverlay';
import { WEATHER_META } from './weatherMeta';

export function weatherCellsToOverlays(cells: readonly WeatherCell[]): AreaOverlay[] {
  return cells.map((cell) => {
    const meta = WEATHER_META[cell.kind];
    return {
      id: cell.id,
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
    };
  });
}
