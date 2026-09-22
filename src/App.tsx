/**
 * ROAD SENSE - componente applicativo.
 *
 * Tiene insieme: SensorEngine -> DetectionEngine -> EventStore ->
 * ConfidenceEngine -> AlertEngine -> mappa.
 *
 * Gli engine vivono in `useRef`: non sono stato di rendering e non devono
 * provocare re-render. React ridisegna solo cio' che l'utente vede davvero
 * (posizione, cluster, alert): e' una scelta esplicita per la batteria.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ALERT, API, APP, PRIVACY, SENSORS } from './config/config';
import { AlertEngine, type ActiveAlert } from './core/AlertEngine';
import { buildClusters } from './core/ConfidenceEngine';
import { DetectionEngine } from './core/DetectionEngine';
import { EventStore } from './core/EventStore';
import { SensorEngine, type EngineSample } from './core/SensorEngine';
import { getAnonId, newEventId } from './core/anonId';
import { buildDemoEvents } from './core/demoSeed';
import { distanceM, roundCoord } from './core/geo';
import { PhoneSensorProvider } from './core/sensors/PhoneSensorProvider';
import { DemoSensorProvider } from './core/sensors/DemoSensorProvider';
import type { EventCluster, EventType, GeoSample, RoadEvent, SystemStatus } from './core/types';
import { backendEnabled, fetchNearby, postEvents } from './net/api';

import { AlertBanner } from './ui/AlertBanner';
import { MapView } from './ui/MapView';
import { ReportSheet } from './ui/ReportSheet';
import { StatusBar } from './ui/StatusBar';
import { usePwaUpdate } from './ui/usePwaUpdate';
import { useWakeLock } from './ui/useWakeLock';

const DEMO_CENTER = { lat: 45.4642, lon: 9.19 };
const DEMO_RADIUS_M = 900;

function isDemoRequested(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('demo') === '1';
}

export default function App() {
  const [demo, setDemo] = useState(isDemoRequested);
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [speedMps, setSpeedMps] = useState<number | null>(null);
  const [clusters, setClusters] = useState<EventCluster[]>([]);
  const [alert, setAlert] = useState<ActiveAlert | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [status, setStatus] = useState<SystemStatus>({
    gps: 'off',
    sensors: 'off',
    network: navigator.onLine ? (backendEnabled() ? 'online' : 'local') : 'offline',
  });

  const { updateReady, applyUpdate } = usePwaUpdate();
  useWakeLock(running);

  // -- engine (non provocano re-render) ------------------------------------
  const storeRef = useRef<EventStore | null>(null);
  const sensorRef = useRef<SensorEngine | null>(null);
  const detectRef = useRef<DetectionEngine>(new DetectionEngine());
  const alertRef = useRef<AlertEngine>(new AlertEngine());
  const lastSyncRef = useRef<{ at: number; lat: number; lon: number } | null>(null);
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const refreshClusters = useCallback(() => {
    const store = storeRef.current;
    if (!store) return;
    const next = buildClusters(store.all());
    setClusters(next);
    alertRef.current.prune(new Set(next.map((c) => c.id)));
  }, []);

  // -- inizializzazione dello store (cambia con la modalita' demo) ----------
  useEffect(() => {
    const store = new EventStore(demo);
    storeRef.current = store;

    if (demo && store.all().length === 0) {
      store.add(buildDemoEvents(DEMO_CENTER, DEMO_RADIUS_M));
    }

    const unsubscribe = store.subscribe(refreshClusters);
    refreshClusters();
    return () => {
      unsubscribe();
    };
  }, [demo, refreshClusters]);

  // -- provider: telefono o demo -------------------------------------------
  useEffect(() => {
    const provider = demo
      ? new DemoSensorProvider({ center: DEMO_CENTER, radiusM: DEMO_RADIUS_M })
      : new PhoneSensorProvider();
    const engine = new SensorEngine(provider);
    sensorRef.current = engine;
    void engine.probe();
    return () => {
      engine.stop();
      sensorRef.current = null;
    };
  }, [demo]);

  // -- purge periodico: applica i TTL e fa decadere la confidenza -----------
  useEffect(() => {
    const id = setInterval(() => {
      storeRef.current?.purge();
      refreshClusters();
    }, 60_000);
    return () => clearInterval(id);
  }, [refreshClusters]);

  // -- stato rete -----------------------------------------------------------
  useEffect(() => {
    const update = () =>
      setStatus((s) => ({
        ...s,
        network: !navigator.onLine ? 'offline' : backendEnabled() ? 'online' : 'local',
      }));
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // -- creazione di un evento ----------------------------------------------
  const recordEvent = useCallback(
    (event: RoadEvent) => {
      storeRef.current?.add([event]);
      if (!event.demo && backendEnabled() && navigator.onLine) {
        // Invio "fire and forget": un fallimento non deve disturbare chi guida.
        void postEvents([event]);
      }
    },
    [],
  );

  // -- sincronizzazione con il backend (se configurato) ---------------------
  const maybeSync = useCallback((lat: number, lon: number) => {
    if (!backendEnabled() || !navigator.onLine) return;
    const now = Date.now();
    const last = lastSyncRef.current;
    const far = last ? distanceM({ lat, lon }, { lat: last.lat, lon: last.lon }) > API.syncDistanceM : true;
    const stale = last ? now - last.at > API.syncIntervalMs : true;
    if (!far && !stale) return;

    lastSyncRef.current = { at: now, lat, lon };
    void fetchNearby(lat, lon, API.fetchRadiusM).then((events) => {
      if (events.length > 0) storeRef.current?.add(events);
    });
  }, []);

  // -- gestione campioni ----------------------------------------------------
  const handleGeo = useCallback(
    (geo: GeoSample) => {
      setPosition({ lat: geo.lat, lon: geo.lon });
      setHeading(geo.heading);
      setSpeedMps(geo.speedMps);
      maybeSync(geo.lat, geo.lon);

      // Valutazione alert a ogni aggiornamento GPS (~1 Hz): sufficiente e
      // molto piu' economico di un ciclo di rendering continuo.
      const current = buildClusters(storeRef.current?.all() ?? []);
      const next = alertRef.current.evaluate(current, {
        lat: geo.lat,
        lon: geo.lon,
        heading: geo.heading,
        speedMps: geo.speedMps,
      });
      if (next) {
        setAlert(next);
        if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
        alertTimerRef.current = setTimeout(() => setAlert(null), ALERT.displayMs);
      }
    },
    [maybeSync],
  );

  const handleSample = useCallback(
    (sample: EngineSample) => {
      const detection = detectRef.current.push(sample);
      if (!detection) return;

      const event: RoadEvent = {
        id: newEventId(),
        lat: roundCoord(detection.lat, PRIVACY.coordDecimals),
        lon: roundCoord(detection.lon, PRIVACY.coordDecimals),
        ts: detection.ts,
        type: detection.type,
        severity: detection.severity,
        source: 'auto',
        confidence: detection.confidence,
        heading: detection.heading,
        reporterId: getAnonId(),
        sensorData: {
          peakVerticalAccel: detection.peakVerticalAccel,
          impulseMs: detection.impulseMs,
          speedMps: detection.speedMps,
          baselineRms: detection.baselineRms,
        },
        ...(demo ? { demo: true } : {}),
      };
      recordEvent(event);
    },
    [demo, recordEvent],
  );

  // -- START / STOP ---------------------------------------------------------
  const start = useCallback(async () => {
    const engine = sensorRef.current;
    if (!engine || engine.isRunning()) return;
    detectRef.current.reset();
    alertRef.current.reset();

    const caps = await engine.start({
      onSample: handleSample,
      onGeo: handleGeo,
      onStatus: (gps, sensors) => setStatus((s) => ({ ...s, gps, sensors })),
      onError: (err) => {
        if (err.kind === 'geolocation' || err.kind === 'permission') {
          setStatus((s) => ({ ...s, gps: err.kind === 'geolocation' ? 'denied' : s.gps }));
        }
        showToast(err.message);
      },
    });

    setFollow(true);
    setRunning(true);

    if (!caps.accelerometer) {
      showToast('Sensori di movimento non disponibili: resta attiva la segnalazione manuale.');
    }
  }, [handleGeo, handleSample, showToast]);

  const stop = useCallback(() => {
    sensorRef.current?.stop();
    detectRef.current.reset();
    setRunning(false);
    setStatus((s) => ({ ...s, gps: 'off', sensors: 'off' }));
    setSpeedMps(null);
    setAlert(null);
  }, []);

  // -- segnalazione manuale -------------------------------------------------
  const report = useCallback(
    (type: EventType) => {
      setSheetOpen(false);
      const geo = sensorRef.current?.getLastGeo();

      if (!geo) {
        // Senza posizione una segnalazione non ha alcun valore: meglio dirlo.
        showToast('Posizione non disponibile: avvia il monitoraggio per segnalare.');
        return;
      }
      if (geo.accuracyM !== null && geo.accuracyM > SENSORS.maxAccuracyM) {
        showToast('Posizione troppo imprecisa per segnalare.');
        return;
      }

      const event: RoadEvent = {
        id: newEventId(),
        lat: roundCoord(geo.lat, PRIVACY.coordDecimals),
        lon: roundCoord(geo.lon, PRIVACY.coordDecimals),
        ts: Date.now(),
        type,
        severity: 2,
        source: 'manual',
        // Una persona ha visto il pericolo: confidenza singola alta, ma la
        // fiducia della zona resta compito del ConfidenceEngine.
        confidence: 0.8,
        heading: geo.heading,
        reporterId: getAnonId(),
        ...(demo ? { demo: true } : {}),
      };
      recordEvent(event);
      showToast('Segnalazione registrata.');
    },
    [demo, recordEvent, showToast],
  );

  // -- pulizia timer --------------------------------------------------------
  useEffect(
    () => () => {
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const toggleDemo = useCallback(() => {
    stop();
    setPosition(null);
    setHeading(null);
    setAlert(null);
    setDemo((d) => !d);
  }, [stop]);

  const speedLabel = useMemo(
    () => (speedMps === null ? '--' : `${Math.round(speedMps * 3.6)} km/h`),
    [speedMps],
  );

  return (
    <div className="app">
      <StatusBar status={status} demo={demo} />

      {updateReady && (
        <div className="update-bar">
          <span>Aggiornamento disponibile</span>
          <button onClick={applyUpdate}>AGGIORNA</button>
        </div>
      )}

      <div className="map-wrap">
        <MapView
          // Il cambio di modalita' rimonta la mappa, cosi' riparte dalla
          // vista giusta invece di restare dove si trovava.
          key={demo ? 'demo' : 'live'}
          clusters={clusters}
          position={position}
          heading={heading}
          follow={follow && running}
          initialView={demo ? { ...DEMO_CENTER, zoom: 13 } : null}
          onMapMovedByUser={() => setFollow(false)}
        />
        <AlertBanner alert={alert} onDismiss={() => setAlert(null)} />
        {toast && <div className="toast">{toast}</div>}
      </div>

      <div className="statusline">
        <span>
          <span className={`dot${running ? ' live' : ''}`}>{running ? '●' : '○'}</span>{' '}
          {running ? 'MONITORAGGIO ATTIVO' : 'MONITORAGGIO FERMO'}
        </span>
        <span>
          {speedLabel} · {clusters.length} EVENTI
        </span>
        <button className="chip" onClick={toggleDemo} aria-pressed={demo}>
          {demo ? 'ESCI DEMO' : 'DEMO'}
        </button>
      </div>

      <div className="controls">
        <button
          className={`btn ${running ? 'stop' : 'start'}`}
          onClick={() => (running ? stop() : void start())}
        >
          {running ? 'STOP' : 'START'}
        </button>
        <button className="btn report" onClick={() => setSheetOpen(true)}>
          △ SEGNALA
        </button>
      </div>

      <p className="disclaimer">
        {APP.name} v{APP.version} · non sostituisce segnaletica stradale, autorita', servizi di
        emergenza o i sistemi ADAS del veicolo. Non interagire con il telefono durante la guida.
      </p>

      <ReportSheet open={sheetOpen} onSelect={report} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
