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

/**
 * Da dove arrivano i rilevamenti che compongono la zona.
 *
 *   demo     veicoli simulati, dentro uno scenario dichiarato tale
 *   local    solo questo dispositivo: non esiste ancora alcuna rete
 *   network  piu' dispositivi, attraverso il backend collaborativo
 */
export type AlertSource = 'demo' | 'local' | 'network';

interface Props {
  alert: ActiveAlert | null;
  source: AlertSource;
  onDismiss: () => void;
}

/**
 * Descrizione onesta di chi ha rilevato.
 *
 * Finche' il backend non esiste, "segnalazioni" farebbe credere che dietro ci
 * siano altre persone: in beta i rilevamenti sono tutti del dispositivo su
 * cui si sta guidando, e va detto senza ambiguita'.
 */
function reportersLabel(count: number, source: AlertSource): string {
  if (source === 'demo') {
    return `${count} ${count === 1 ? 'VEICOLO' : 'VEICOLI'} ROAD SENSE · SIMULATO`;
  }
  if (source === 'local') {
    return `${count} ${count === 1 ? 'RILEVAMENTO' : 'RILEVAMENTI'} · QUESTO DISPOSITIVO`;
  }
  return `${count} ${count === 1 ? 'SEGNALAZIONE' : 'SEGNALAZIONI'}`;
}

export function AlertBanner({ alert, source, onDismiss }: Props) {
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
          {reportersLabel(alert.cluster.reporters, source)} · AFFIDABILITA'{' '}
          {Math.round(alert.cluster.confidence * 100)}%
        </div>
      </div>
    </div>
  );
}
