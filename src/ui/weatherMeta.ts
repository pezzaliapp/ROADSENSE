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
  /** Titolo quando l'incontro e' PREVISTO piu' avanti sul percorso. */
  onRoute: string;
  /**
   * Titolo quando il veicolo e' GIA' dentro l'area.
   * E' uno stato diverso, non una distanza: dire "fra 0 m" sarebbe assurdo.
   */
  inArea: string;
  /** Riga esplicativa opzionale. */
  note?: string;
}

export const WEATHER_META: Record<WeatherKind, WeatherMeta> = {
  heavyRain: {
    label: 'PIOGGIA INTENSA',
    glyph: '🌧️',
    color: '#4aa3ff',
    onRoute: 'PIOGGIA INTENSA SUL PERCORSO',
    inArea: 'PIOGGIA INTENSA NELL\'AREA ATTUALE',
  },
  hail: {
    label: 'GRANDINE',
    glyph: '🌩️',
    color: '#8f7dff',
    onRoute: 'GRANDINE SUL PERCORSO',
    inArea: 'GRANDINE NELL\'AREA ATTUALE',
  },
  downburst: {
    label: 'RAFFICHE',
    glyph: '💨',
    color: '#59c9c0',
    onRoute: 'RAFFICHE VIOLENTE SUL PERCORSO',
    inArea: 'RAFFICHE VIOLENTE NELL\'AREA ATTUALE',
    note: 'Possibile downburst',
  },
};

/** Dicitura che accompagna sempre i dati meteo: sono simulati, va detto. */
export const SIMULATION_NOTICE = 'SIMULAZIONE ROAD WEATHER';

/**
 * Distanza stradale, arrotondata perche' il testo non cambi a ogni metro.
 * Sotto il chilometro si arrotonda a 50 m, sopra al decimo di chilometro.
 */
export function formatRoadDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '--';
  if (meters < 1000) return `${Math.max(50, Math.round(meters / 50) * 50)} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Tempo previsto, arrotondato al minuto per lo stesso motivo. */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--';
  if (seconds < 45) return 'meno di 1 min';
  return `circa ${Math.round(seconds / 60)} min`;
}
