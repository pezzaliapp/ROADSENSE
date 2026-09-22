/**
 * ROAD SENSE - banner di allerta.
 *
 * Una riga, carattere grande, nessuna interazione richiesta: l'alert si
 * chiude da solo. Toccarlo lo chiude prima, ma non e' necessario.
 */

import { formatDistance } from '../core/geo';
import type { ActiveAlert } from '../core/AlertEngine';
import { EVENT_META } from './eventMeta';
import { confidenceLevel } from '../core/ConfidenceEngine';

interface Props {
  alert: ActiveAlert | null;
  onDismiss: () => void;
}

export function AlertBanner({ alert, onDismiss }: Props) {
  if (!alert) return null;
  const meta = EVENT_META[alert.cluster.type];
  const level = confidenceLevel(alert.cluster.confidence);
  // "Possibile" quando la zona non e' ancora confermata da piu' rilevamenti:
  // meglio un avviso onesto che un falso allarme presentato come certezza.
  const prefix = level === 'possible' ? 'Possibile ' : '';
  const severe = alert.cluster.severity === 3;

  return (
    <div
      className={`alert${severe ? ' severe' : ''}`}
      role="alert"
      onClick={onDismiss}
      style={{ cursor: 'pointer' }}
    >
      <span className="a-glyph" aria-hidden="true" style={{ color: meta.color }}>
        ⚠
      </span>
      <div>
        <div className="a-text">
          {prefix}
          {prefix ? meta.label.toLowerCase() : meta.label} tra {formatDistance(alert.distanceM)}
        </div>
        <div className="a-sub">
          AFFIDABILITA' {Math.round(alert.cluster.confidence * 100)}% ·{' '}
          {alert.cluster.reporters === 1 ? '1 SEGNALAZIONE' : `${alert.cluster.reporters} SEGNALAZIONI`}
        </div>
      </div>
    </div>
  );
}
