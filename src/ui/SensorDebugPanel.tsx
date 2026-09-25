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
import type { CorridorDebug } from './corridorDebug';

interface Props {
  telemetry: DetectionTelemetry | null;
  /** Eventi stradali prodotti da START: e' il numero che era esploso. */
  eventCount: number;
  /**
   * Stato del corridoio davanti al veicolo.
   *
   * Serve a verificare su un telefono reale se la geometria stradale dei tile
   * arriva davvero: `querySourceFeatures` non esiste in Node e nessun test
   * automatico puo' dimostrarlo.
   */
  corridor?: CorridorDebug | null;
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

export function SensorDebugPanel({ telemetry, eventCount, corridor }: Props) {
  const t = telemetry;
  const kmh = t === null || t.speedMps === null ? null : t.speedMps * 3.6;

  return (
    <section className="sensor-debug" role="status" aria-label="Debug sensori">
      {corridor && (
        <>
          <div className="vd-title">CORRIDOIO</div>
          {/* La riga che decide: solo `road-geometry` puo' sostenere
              un'affermazione di pertinenza stradale. */}
          <Row
            label="SORGENTE"
            value={corridor.source}
            tone={corridor.source === 'road-geometry' ? 'ok' : corridor.source === 'heading' ? 'warn' : 'bad'}
          />
          <Row
            label="STATO"
            value={corridor.status}
            tone={corridor.status === 'reliable' ? 'ok' : corridor.status === 'uncertain' ? 'warn' : 'bad'}
          />
          <Row
            label="EVIDENZA STRADA"
            value={corridor.roadEvidence ? 'SI' : 'no'}
            tone={corridor.roadEvidence ? 'ok' : 'warn'}
          />
          <Row label="CONFIDENZA" value={corridor.confidence.toFixed(2)} />
          <Row
            label="STRADE DA MAPPA"
            value={String(corridor.roadFeatures)}
            tone={corridor.roadFeatures > 0 ? 'ok' : 'bad'}
          />
          <Row label="PUNTI" value={String(corridor.points)} />
          <Row label="LUNGHEZZA" value={`${corridor.lengthM} m`} />
          <Row
            label="MOTIVO"
            value={corridor.reason ?? '--'}
            tone={corridor.reason ? 'warn' : ''}
          />
          {t && <div className="vd-title vd-sub">SENSORI</div>}
        </>
      )}

      {t === null ? (
        <div className="vd-note">Nessun campione dai sensori.</div>
      ) : (
        <>
      {!corridor && <div className="vd-title">DEBUG SENSORI</div>}

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
        </>
      )}

      <div className="vd-note">Solo su questo dispositivo. Nessun dato inviato.</div>
    </section>
  );
}
