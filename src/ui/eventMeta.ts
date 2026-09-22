/**
 * ROAD SENSE - etichette e simboli degli eventi.
 * Simboli testuali: niente librerie di icone, niente richieste di rete,
 * resa identica offline.
 */

import type { EventType } from '../core/types';

export interface EventMeta {
  label: string;
  /** Simbolo compatto usato sul marker. */
  glyph: string;
  /** Colore del marker. */
  color: string;
  /** true se proponibile nella segnalazione manuale. */
  manual: boolean;
}

export const EVENT_META: Record<EventType, EventMeta> = {
  pothole: { label: 'Buca', glyph: '◉', color: '#ff8a3d', manual: true },
  rough: { label: 'Fondo irregolare', glyph: '≈', color: '#c98b3a', manual: false },
  obstacle: { label: 'Ostacolo', glyph: '▲', color: '#ffd23d', manual: true },
  water: { label: 'Acqua', glyph: '≋', color: '#3da5ff', manual: true },
  slippery: { label: 'Fondo scivoloso', glyph: '⦵', color: '#7d9dff', manual: true },
  accident: { label: 'Incidente', glyph: '✕', color: '#ff4d4d', manual: true },
  roadworks: { label: 'Lavori', glyph: '⛏', color: '#ffb020', manual: true },
  other: { label: 'Altro pericolo', glyph: '!', color: '#b8c0cc', manual: true },
};

/** Ordine dei pulsanti nella scheda di segnalazione. */
export const MANUAL_TYPES: EventType[] = [
  'pothole',
  'obstacle',
  'water',
  'slippery',
  'accident',
  'roadworks',
  'other',
];
