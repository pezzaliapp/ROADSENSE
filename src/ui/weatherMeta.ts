/**
 * ROAD SENSE - etichette e colori dei fenomeni meteo simulati.
 *
 * Tenuti distinti da `eventMeta` di proposito: sulla mappa il meteo NON deve
 * essere confuso con un evento stradale. Gli eventi sono punti netti e
 * colorati; le celle sono aree fredde, semitrasparenti e senza contorno pieno.
 */

import type { WeatherKind } from '../weather/WeatherProvider';

export interface WeatherMeta {
  /** Etichetta breve mostrata sulla mappa sotto "NOWCAST". */
  label: string;
  glyph: string;
  color: string;
  /** Titolo dell'avviso quando non c'e' correlazione con la strada. */
  alertTitle: string;
}

export const WEATHER_META: Record<WeatherKind, WeatherMeta> = {
  heavyRain: {
    label: 'PIOGGIA INTENSA',
    glyph: '🌧️',
    color: '#4aa3ff',
    alertTitle: 'POSSIBILE PIOGGIA INTENSA SUL PERCORSO',
  },
  hail: {
    label: 'GRANDINE',
    glyph: '🌩️',
    color: '#8f7dff',
    alertTitle: 'POSSIBILE GRANDINE SUL PERCORSO',
  },
  downburst: {
    label: 'RAFFICHE',
    glyph: '💨',
    color: '#59c9c0',
    alertTitle: 'POSSIBILE DOWNBURST SUL PERCORSO',
  },
};

/** Dicitura che accompagna sempre i dati meteo: sono simulati, va detto. */
export const SIMULATION_NOTICE = 'SIMULAZIONE ROAD WEATHER';
