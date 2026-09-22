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
  /**
   * In DEMO MODE le segnalazioni provengono da veicoli simulati, e va detto:
   * "segnalazioni" farebbe pensare a persone reali dietro a una rete che non
   * esiste ancora.
   */
  demo?: boolean;
  onDismiss: () => void;
}

export function AlertBanner({ alert, demo = false, onDismiss }: Props) {
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
          {demo
            ? `${alert.cluster.reporters} ${
                alert.cluster.reporters === 1 ? 'VEICOLO' : 'VEICOLI'
              } ROAD SENSE · SIMULATO`
            : `${alert.cluster.reporters} ${
                alert.cluster.reporters === 1 ? 'SEGNALAZIONE' : 'SEGNALAZIONI'
              }`}
          {' · '}
          AFFIDABILITA' {Math.round(alert.cluster.confidence * 100)}%
        </div>
      </div>
    </div>
  );
}
