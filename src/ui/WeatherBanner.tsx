/**
 * ROAD SENSE - banner degli avvisi meteo simulati.
 *
 * Volutamente diverso dal banner stradale: fondo freddo invece che ambra, e
 * la dicitura di simulazione sempre presente. Chi guarda non deve mai poter
 * confondere un rilevamento reale con una previsione simulata.
 *
 * Quando l'avviso nasce dall'incrocio di due sorgenti indipendenti - la
 * previsione meteo e le segnalazioni ROAD SENSE nella stessa area - il banner
 * lo dichiara esplicitamente: e' il punto dell'intera idea.
 */

import { formatDistance } from '../core/geo';
import type { WeatherAlert } from '../weather/weatherAlerts';
import { SIMULATION_NOTICE, WEATHER_META } from './weatherMeta';

interface Props {
  alert: WeatherAlert | null;
  onDismiss: () => void;
}

export function WeatherBanner({ alert, onDismiss }: Props) {
  if (!alert) return null;
  const meta = WEATHER_META[alert.cell.kind];
  const inside = alert.distanceM === 0;

  return (
    <div
      className={`alert weather${alert.correlated ? ' correlated' : ''}`}
      role="alert"
      onClick={onDismiss}
      style={{ cursor: 'pointer' }}
    >
      {/* Il simbolo del fenomeno e' gia' nel titolo, come richiesto dal
          formato dell'avviso: qui si mostra solo il triangolo di attenzione
          degli avvisi correlati, per non ripetere due volte la stessa icona. */}
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
              ATTENZIONE{inside ? '' : ` · ${formatDistance(alert.distanceM)}`}
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
              {meta.glyph} {meta.alertTitle}
            </div>
            <div className="a-sub">
              {inside ? 'AREA IN CORSO' : `AREA PREVISTA TRA ${alert.cell.etaMin} MINUTI`}
              {!inside && ` · ${formatDistance(alert.distanceM)}`}
            </div>
          </>
        )}
        <div className="a-sim">{SIMULATION_NOTICE}</div>
      </div>
    </div>
  );
}
