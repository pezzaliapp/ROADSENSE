/**
 * ROAD SENSE - banner degli avvisi meteo simulati.
 *
 * Volutamente diverso dal banner stradale: fondo freddo invece che ambra, e
 * la dicitura di simulazione sempre presente. Chi guarda non deve mai poter
 * confondere un rilevamento reale con una previsione simulata.
 *
 * DUE STATI, NON UNO
 * - incontro PREVISTO piu' avanti: si mostrano insieme distanza stradale e
 *   tempo, perche' l'una senza l'altro dice poco ("2 km" a che velocita'?);
 * - veicolo GIA' DENTRO l'area: non si mostra alcuna distanza, perche' non
 *   ce n'e' una. E' uno stato diverso e va detto con parole diverse.
 *
 * Quando l'avviso nasce dall'incrocio di due sorgenti indipendenti - la
 * previsione meteo e le segnalazioni ROAD SENSE nella stessa area - il banner
 * lo dichiara esplicitamente: e' il punto dell'intera idea.
 */

import type { WeatherAlert } from '../weather/weatherAlerts';
import { formatEta, formatRoadDistance, SIMULATION_NOTICE, WEATHER_META } from './weatherMeta';

interface Props {
  alert: WeatherAlert | null;
  onDismiss: () => void;
}

export function WeatherBanner({ alert, onDismiss }: Props) {
  if (!alert) return null;
  const meta = WEATHER_META[alert.cell.kind];
  const { inside, roadDistanceM } = alert.forecast;
  // Si mostra il tempo stabilizzato, non quello grezzo.
  const etaSec = alert.displayEtaSec;

  // Distanza e tempo insieme, oppure niente: mostrarne solo uno sarebbe
  // un'informazione a meta'.
  const whenLine =
    !inside && roadDistanceM !== null && etaSec !== null
      ? `${formatRoadDistance(roadDistanceM)} · ${formatEta(etaSec)}`
      : null;

  return (
    <div
      className={`alert weather${alert.correlated ? ' correlated' : ''}`}
      role="alert"
      onClick={onDismiss}
      style={{ cursor: 'pointer' }}
    >
      {alert.correlated && (
        <span className="a-glyph" aria-hidden="true">
          ⚠️
        </span>
      )}
      <div>
        {alert.correlated ? (
          <>
            {/* Due sorgenti indipendenti che indicano lo stesso pericolo. */}
            <div className="a-text">
              ATTENZIONE{inside ? " · NELL'AREA ATTUALE" : whenLine ? ` · ${whenLine}` : ''}
            </div>
            <div className="a-corr">
              <span>Pioggia intensa in corso</span>
              <span className="a-plus">+</span>
              <span>acqua segnalata sulla carreggiata</span>
            </div>
          </>
        ) : (
          <>
            <div className="a-text">
              {meta.glyph} {inside ? meta.inArea : meta.onRoute}
            </div>
            {meta.note && <div className="a-note">{meta.note}</div>}
            {whenLine && <div className="a-sub">{whenLine}</div>}
          </>
        )}
        <div className="a-sim">{SIMULATION_NOTICE}</div>
      </div>
    </div>
  );
}
