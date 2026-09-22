/**
 * ROAD SENSE - scheda di segnalazione manuale.
 *
 * Due tocchi in tutto: SEGNALA, poi la categoria. Nessun campo di testo,
 * nessuna conferma, nessuna descrizione obbligatoria: mentre si guida
 * l'attenzione deve tornare alla strada immediatamente.
 */

import type { EventType } from '../core/types';
import { EVENT_META, MANUAL_TYPES } from './eventMeta';

interface Props {
  open: boolean;
  onSelect: (type: EventType) => void;
  onClose: () => void;
}

export function ReportSheet({ open, onSelect, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Segnala un pericolo"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <h2>COSA HAI TROVATO?</h2>
        <div className="sheet-grid">
          {MANUAL_TYPES.map((type) => {
            const meta = EVENT_META[type];
            return (
              <button
                key={type}
                className="type-btn"
                style={{ color: meta.color }}
                onClick={() => onSelect(type)}
              >
                <span className="g" aria-hidden="true">
                  {meta.glyph}
                </span>
                <span style={{ color: 'var(--text)' }}>{meta.label}</span>
              </button>
            );
          })}
        </div>
        <button className="sheet-close" onClick={onClose}>
          ANNULLA
        </button>
      </div>
    </div>
  );
}
