/**
 * ROAD SENSE - DEBUG SENSORI.
 *
 * Esiste per una ragione precisa: il primo test su strada ha prodotto 257
 * eventi, e senza vedere i numeri non si puo' distinguere una soglia sbagliata
 * da un criterio mancante. Le soglie anti-falso-positivo sono provvisorie e
 * vanno calibrate su misure reali, non a intuito: questo pannello serve a
 * raccoglierle.
 *
 * REGOLE, le stesse del debug voce
 * - si apre SOLO con ?sensorDebug=1;
 * - non invia niente da nessuna parte: legge stato gia' in memoria;
 * - nell'interfaccia normale non esiste.
 */

import type { DetectionTelemetry } from '../core/DetectionEngine';

interface Props {
  telemetry: DetectionTelemetry;
  /** Eventi stradali prodotti da START: e' il numero che era esploso. */
  eventCount: number;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="vd-row">
      <span className="vd-label">{label}</span>
      <span className={`vd-value${tone ? ` ${tone}` : ''}`}>{value}</span>
    </div>
  );
}

/** Numero leggibile a colpo d'occhio, o "--" quando il dato non c'e'. */
function num(value: number | null, digits = 2, unit = ''): string {
  if (value === null || !Number.isFinite(value)) return '--';
  return `${value.toFixed(digits)}${unit}`;
}

export function SensorDebugPanel({ telemetry, eventCount }: Props) {
  const t = telemetry;
  const kmh = t.speedMps === null ? null : t.speedMps * 3.6;

  return (
    <section className="sensor-debug" role="status" aria-label="Debug sensori">
      <div className="vd-title">DEBUG SENSORI</div>

      <Row label="VELOCITA" value={num(kmh, 0, ' km/h')} />
      <Row label="ACC. VERTICALE" value={num(t.verticalAccel, 2, ' m/s²')} />
      <Row label="ACC. TOTALE" value={num(t.totalAccel, 2, ' m/s²')} />
      <Row label="PICCO" value={num(t.peak, 2, ' m/s²')} />
      <Row label="RUMORE FONDO" value={num(t.baselineRms, 2, ' m/s²')} />
      <Row label="PICCO/RUMORE" value={num(t.peakOverNoise, 1, '×')} />
      <Row label="GIROSCOPIO" value={`${t.gyroMaxDps} °/s`} />
      <Row label="QUOTA VERTICALE" value={num(t.verticalShare, 2)} />

      {/* Lo stato che decide se ha senso attribuire qualcosa alla strada. */}
      <Row
        label="SENSORI"
        value={t.stable ? 'stabili' : 'NON STABILI'}
        tone={t.stable ? 'ok' : 'bad'}
      />
      <Row label="MOTIVO SCARTO" value={t.reason ?? '--'} tone={t.reason ? 'warn' : ''} />

      {/* Tre cose diverse, mostrate come tali. */}
      <div className="vd-title vd-sub">CATENA</div>
      <Row
        label="IMPULSO"
        value={t.impulseActive ? 'in corso' : t.impulseDetected ? 'misurato' : 'no'}
        tone={t.impulseDetected ? 'ok' : ''}
      />
      <Row
        label="EVENTO"
        value={t.eventEmitted ? 'SI' : 'no'}
        tone={t.eventEmitted ? 'ok' : ''}
      />
      <Row label="EVENTI TOTALI" value={String(eventCount)} tone={eventCount > 30 ? 'bad' : ''} />

      <div className="vd-note">Solo su questo dispositivo. Nessun dato inviato.</div>
    </section>
  );
}
