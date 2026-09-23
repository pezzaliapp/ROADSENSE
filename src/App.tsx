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

import { ALERT, API, APP, MAP, MERGE_RADIUS_M, PRIVACY, SENSORS, VOICE, WEATHER } from './config/config';
import { AlertEngine, type ActiveAlert } from './core/AlertEngine';
import { buildClusters } from './core/ConfidenceEngine';
import { DetectionEngine } from './core/DetectionEngine';
import { EventStore } from './core/EventStore';
import { SensorEngine, type EngineSample } from './core/SensorEngine';
import { getAnonId, newEventId } from './core/anonId';
import { buildDemoEvents } from './core/demoSeed';
import { distanceM, roundCoord } from './core/geo';
import { WEATHER_META } from './ui/weatherMeta';
import { CAR_COLOR, CarGlyph } from './ui/vehicleIcon';
import { PhoneSensorProvider } from './core/sensors/PhoneSensorProvider';
import { DemoSensorProvider } from './core/sensors/DemoSensorProvider';
import { DEMO_ROUTE } from './demo/demoRoute';
import { DEMO_ROUTE_CENTER } from './demo/demoRoute';
import { DemoTrafficProvider } from './demo/DemoTrafficProvider';
import {
  BrowserVoiceProvider,
  onDeviceStateNow,
  probeOnDevice,
  selectedVoiceApi,
} from './voice/BrowserVoiceProvider';
import { DemoVoiceProvider } from './voice/DemoVoiceProvider';
import type { VoiceDiagnostics, VoiceProvider, VoiceStatus } from './voice/VoiceProvider';
import {
  attemptOf,
  browserMicEnvironment,
  interpretPermission,
  micMessage,
  readMicPermissionRaw,
  requestMicrophone,
} from './voice/micPermission';
import { parseVoiceReport } from './voice/parser';
import { buildVoiceEvent } from './voice/voiceEvent';
import { HAZARD_META } from './hazard/taxonomy';
import { admitsAlert, assessCluster, type HazardAssessment } from './hazard/assessment';
import { AlertSpeechEngine } from './speech/AlertSpeechEngine';
import { BrowserSpeechProvider } from './speech/BrowserSpeechProvider';
import { SilentSpeechProvider } from './speech/SpeechProvider';
import { roadAlertPhrase, weatherAlertPhrase } from './speech/phrases';
import { DEMO_VOICE_SCRIPT } from './demo/demoVoiceScript';
import { routeAheadFrom } from './demo/routeAhead';
import type { DemoVehicleState } from './demo/DemoVehicle';
import type { EventCluster, EventType, GeoSample, RoadEvent, SystemStatus } from './core/types';
import { backendEnabled, fetchNearby, postEvents } from './net/api';

import { DemoWeatherProvider } from './weather/DemoWeatherProvider';
import { WeatherAlertEngine, type WeatherAlert } from './weather/weatherAlerts';
import type { WeatherCell } from './weather/WeatherProvider';

import { AlertBanner } from './ui/AlertBanner';
import type { PeerVehicle } from './ui/MapView';
import { WeatherBanner } from './ui/WeatherBanner';
import { weatherCellsToOverlays } from './ui/weatherOverlay';
import { MapView } from './ui/MapView';
import { ReportSheet } from './ui/ReportSheet';
import { StatusBar } from './ui/StatusBar';
import { usePwaUpdate } from './ui/usePwaUpdate';
import { useReducedMotion } from './ui/useReducedMotion';
import { useWakeLock } from './ui/useWakeLock';
import { VoiceDebugPanel } from './ui/VoiceDebugPanel';

function isDemoRequested(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('demo') === '1';
}

/**
 * DEBUG VOCE: solo su richiesta esplicita nell'indirizzo, mai per errore.
 * Senza questo parametro il pannello non viene nemmeno costruito.
 */
function isVoiceDebugRequested(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('debugVoice') === '1';
}

export default function App() {
  const [demo, setDemo] = useState(isDemoRequested);
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [speedMps, setSpeedMps] = useState<number | null>(null);
  const [clusters, setClusters] = useState<EventCluster[]>([]);
  const [alert, setAlert] = useState<ActiveAlert | null>(null);
  const [weatherAlert, setWeatherAlert] = useState<WeatherAlert | null>(null);
  const [weatherCells, setWeatherCells] = useState<readonly WeatherCell[]>([]);
  const [peers, setPeers] = useState<readonly DemoVehicleState[]>([]);
  /** Avanzamento ciclico delle animazioni delle celle, 0..1. */
  const [weatherPhase, setWeatherPhase] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [status, setStatus] = useState<SystemStatus>({
    gps: 'off',
    sensors: 'off',
    network: navigator.onLine ? (backendEnabled() ? 'online' : 'local') : 'offline',
    voice: 'off',
  });
  /** Conferma visiva non interattiva di una segnalazione vocale accolta. */
  const [voiceReceipt, setVoiceReceipt] = useState<string | null>(null);
  /** Valutazione della zona dell'avviso mostrato: conferma, priorita', dettaglio. */
  const [alertAssessment, setAlertAssessment] = useState<HazardAssessment | null>(null);
  /**
   * La voce e' spenta finche' non viene attivata: il riconoscimento dei
   * browser e' per impostazione predefinita un servizio remoto, e accenderlo
   * senza chiederlo tradirebbe la promessa di privacy.
   */
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  /**
   * Consenso all'elaborazione REMOTA dell'audio.
   *
   *   none     non richiesto, o non ancora dato
   *   pending  chiesto, in attesa della seconda conferma
   *   granted  dato esplicitamente
   *
   * Vive in memoria e non viene ricordato fra una sessione e l'altra: un
   * consenso a inviare audio a un servizio esterno va ridato consapevolmente,
   * non ereditato da una decisione presa settimane prima.
   */
  const [voiceConsent, setVoiceConsent] = useState<'none' | 'pending' | 'granted'>('none');

  /**
   * Diagnosi della catena vocale. Esiste solo con ?debugVoice=1 e non lascia
   * mai il dispositivo. Nell'interfaccia normale non viene mostrata.
   */
  const [voiceDebug] = useState(isVoiceDebugRequested);
  const [diagnostics, setDiagnostics] = useState<VoiceDiagnostics>(() => ({
    api: 'assente',
    mic: 'sconosciuto',
    phase: 'idle',
    local: 'non disponibile',
    remote: false,
    lastError: null,
    lastPhrase: null,
    permissionsApi: 'non disponibile',
    permissionsValue: '--',
    getUserMedia: 'non tentato',
    getUserMediaDetail: null,
  }));
  const pushDiagnostics = useCallback(
    (patch: Partial<VoiceDiagnostics>) => {
      // Fuori dal debug non si raccoglie nulla: nemmeno in memoria.
      if (!voiceDebug) return;
      setDiagnostics((d) => ({ ...d, ...patch }));
    },
    [voiceDebug],
  );

  /**
   * Cio' che il browser dichiara sul microfono, letto senza chiedere nulla.
   *
   * Serve PRIMA del tocco, non dopo: e' l'unico modo di distinguere "ha appena
   * rifiutato" da "era gia' bloccato". Vive anche in un ref perche' al momento
   * del tocco va letto senza aspettare un re-render.
   */
  /**
   * Il microfono si e' gia' aperto in questa sessione.
   *
   * E' l'unica cosa che viene ricordata, ed e' un FATTO verificato, non uno
   * stato dichiarato. Serve solo a evitare una richiesta inutile: nessun
   * valore negativo viene memorizzato, perche' un fallimento non deve mai
   * impedire il tentativo successivo.
   */
  const micUsableRef = useRef(false);
  /**
   * Il microfono risulta bloccato dalle impostazioni del sito: e' l'unico
   * caso in cui ha senso rimandarci, e va detto in modo che resti leggibile.
   */
  const [micBlocked, setMicBlocked] = useState(false);

  const reducedMotion = useReducedMotion();
  const { updateReady, applyUpdate } = usePwaUpdate();
  const wakeLock = useWakeLock(running);

  // -- engine (non provocano re-render) ------------------------------------
  const storeRef = useRef<EventStore | null>(null);
  const sensorRef = useRef<SensorEngine | null>(null);
  const detectRef = useRef<DetectionEngine>(new DetectionEngine());
  const alertRef = useRef<AlertEngine>(new AlertEngine());
  const weatherEngineRef = useRef<WeatherAlertEngine>(new WeatherAlertEngine());
  const voiceRef = useRef<VoiceProvider | null>(null);
  const voiceReceiptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechRef = useRef<AlertSpeechEngine>(
    new AlertSpeechEngine(
      new BrowserSpeechProvider().isSupported()
        ? new BrowserSpeechProvider()
        : new SilentSpeechProvider(),
    ),
  );
  const roadAlertRef = useRef<ActiveAlert | null>(null);
  const weatherAlertRef = useRef<WeatherAlert | null>(null);
  /** Le celle in un ref: cosi' `handleGeo` resta stabile fra i render. */
  const weatherCellsRef = useRef<readonly WeatherCell[]>([]);
  /** Ultima distanza nota lungo il tracciato demo: restringe la ricerca. */
  const routeHintRef = useRef<number | undefined>(undefined);
  /** Sorgente meteo della demo: possiede l'unico orologio dello scenario. */
  const weatherProviderRef = useRef<DemoWeatherProvider | null>(null);
  /** true solo in DEMO MODE: fuori non esiste alcun percorso noto. */
  const demoRef = useRef(false);
  /**
   * Velocita' livellata, usata SOLO per il tempo previsto degli avvisi meteo.
   * Gli avvisi stradali continuano a usare la velocita' istantanea: la' serve
   * la distanza di frenata di adesso, non il ritmo medio.
   */
  const weatherSpeedRef = useRef<number | null>(null);
  const weatherTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    // Se un avviso e' gia' sullo schermo e la sua zona nel frattempo e'
    // cambiata - per esempio un altro veicolo ha confermato la buca - il
    // banner si aggiorna invece di restare fermo su un dato vecchio.
    // Il cluster viene ritrovato per vicinanza: aggiungendo un rilevamento il
    // baricentro si sposta di qualche metro, e con esso il suo identificativo.
    const shown = roadAlertRef.current;
    if (shown) {
      const updated = next.find(
        (c) =>
          c.type === shown.cluster.type &&
          distanceM(c, shown.cluster) <= MERGE_RADIUS_M[c.type],
      );
      if (updated && updated.reporters !== shown.cluster.reporters) {
        const refreshed = { ...shown, cluster: updated };
        roadAlertRef.current = refreshed;
        setAlert(refreshed);
      }
    }
  }, []);

  // -- inizializzazione dello store (cambia con la modalita' demo) ----------
  useEffect(() => {
    const store = new EventStore(demo);
    storeRef.current = store;

    if (demo && store.all().length === 0) {
      store.add(buildDemoEvents());
    }

    const unsubscribe = store.subscribe(refreshClusters);
    refreshClusters();
    return () => {
      unsubscribe();
    };
  }, [demo, refreshClusters]);

  // -- provider: telefono o demo -------------------------------------------
  useEffect(() => {
    const provider = demo ? new DemoSensorProvider() : new PhoneSensorProvider();
    const engine = new SensorEngine(provider);
    sensorRef.current = engine;
    void engine.probe();
    return () => {
      engine.stop();
      sensorRef.current = null;
    };
  }, [demo]);

  // -- sorgente meteo: ESCLUSIVAMENTE in DEMO MODE -------------------------
  // Fuori dalla demo non viene nemmeno costruita: nella v0.1.0 ROAD SENSE non
  // ha alcuna sorgente meteo reale, e NOWCAST non e' collegato.
  useEffect(() => {
    demoRef.current = demo;
    if (!demo) {
      weatherCellsRef.current = [];
      setWeatherCells([]);
      setWeatherAlert(null);
      weatherAlertRef.current = null;
      return;
    }
    const provider = new DemoWeatherProvider();
    weatherProviderRef.current = provider;
    const cells = provider.isAvailable() ? provider.cells() : [];
    routeHintRef.current = undefined;
    weatherCellsRef.current = cells;
    setWeatherCells(cells);
    weatherEngineRef.current.reset();
    return () => {
      weatherProviderRef.current = null;
      weatherCellsRef.current = [];
      setWeatherCells([]);
    };
  }, [demo]);

  // -- l'unico orologio della demo -----------------------------------------
  // Avanza le celle e la fase delle animazioni. Lo stesso array di celle
  // alimenta il disegno sulla mappa E la previsione dell'incontro: non
  // esistono due posizioni, una grafica e una del modello.
  useEffect(() => {
    const provider = weatherProviderRef.current;
    if (!demo || !running || !provider) return;

    provider.start(Date.now());
    const id = setInterval(() => {
      const now = Date.now();
      const cells = provider.cells(now);
      weatherCellsRef.current = cells;
      setWeatherCells(cells);
      setWeatherPhase(((provider.elapsedSec(now) * 1000) / WEATHER.animationCycleMs) % 1);
    }, WEATHER.demoTickMs);

    return () => {
      clearInterval(id);
      provider.stop();
      const frozen = provider.cells();
      weatherCellsRef.current = frozen;
      setWeatherCells(frozen);
      setWeatherPhase(0);
    };
  }, [demo, running]);

  // -- veicoli ROAD SENSE SIMULATI: esclusivamente in DEMO MODE ------------
  // Fuori dalla demo il provider non viene nemmeno costruito. Non esiste
  // alcuna rete: i veicoli avanzano in memoria e i loro eventi finiscono nello
  // stesso archivio locale, dove il ConfidenceEngine li aggrega come farebbe
  // con qualsiasi altro segnalatore.
  useEffect(() => {
    if (!demo || !running) {
      setPeers([]);
      return;
    }
    const traffic = new DemoTrafficProvider();
    traffic.start({
      onVehicles: (vehicles) => setPeers(vehicles),
      onEvent: (event) => storeRef.current?.add([event]),
    });
    return () => {
      traffic.stop();
      setPeers([]);
    };
  }, [demo, running]);

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
      // La politica di ammissione vive qui, non dentro AlertEngine: tiene
      // insieme conferma, priorita' e soglia storica senza che il motore degli
      // avvisi debba conoscere la tassonomia dei pericoli.
      const knownEvents = storeRef.current?.all() ?? [];
      const next = alertRef.current.evaluate(
        current,
        { lat: geo.lat, lon: geo.lon, heading: geo.heading, speedMps: geo.speedMps },
        geo.ts,
        (cluster) => admitsAlert(cluster, assessCluster(cluster, knownEvents), ALERT.minConfidence),
      );
      if (next) {
        roadAlertRef.current = next;
        setAlert(next);
        // La voce e' un'USCITA dell'alert, non un motore parallelo: parla di
        // cio' che l'AlertEngine ha gia' deciso.
        const assessment = assessCluster(next.cluster, knownEvents);
        setAlertAssessment(assessment);
        speechRef.current.announce(
          next.cluster.id,
          roadAlertPhrase(next.cluster, next.distanceM, assessment),
          geo.ts,
        );
        if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
        alertTimerRef.current = setTimeout(() => {
          roadAlertRef.current = null;
          setAlert(null);
          setAlertAssessment(null);
        }, ALERT.displayMs);
      }

      // Avvisi meteo: solo in demo, e solo se non ne e' gia' visibile uno.
      // Mostrarne piu' di uno alla volta renderebbe la demo un bollettino.
      const cells = weatherCellsRef.current;
      if (cells.length === 0) return;

      // Il percorso davanti al veicolo esiste SOLO in demo: e' la conoscenza
      // che rende possibile prevedere l'incontro invece di aspettarlo.
      const ahead = demoRef.current
        ? routeAheadFrom({ lat: geo.lat, lon: geo.lon }, routeHintRef.current)
        : null;
      if (ahead) routeHintRef.current = ahead.atM;

      // Livellamento esponenziale della velocita': il tempo previsto deve
      // seguire il ritmo di marcia, non l'accelerata del momento.
      if (geo.speedMps !== null) {
        const alpha = 1 - Math.exp(-1 / WEATHER.speedSmoothingSec);
        weatherSpeedRef.current =
          weatherSpeedRef.current === null
            ? geo.speedMps
            : weatherSpeedRef.current + (geo.speedMps - weatherSpeedRef.current) * alpha;
      }

      const driverState = {
        lat: geo.lat,
        lon: geo.lon,
        heading: geo.heading,
        speedMps: weatherSpeedRef.current,
      };

      const shownWeather = weatherAlertRef.current;
      if (shownWeather) {
        // Avviso gia' sullo schermo: si ricalcola, cosi' distanza e tempo
        // scendono mentre ci si avvicina. Se l'incontro non e' piu' previsto
        // - altra strada, cella che si allontana - l'avviso decade subito.
        const updated = weatherEngineRef.current.refresh(
          shownWeather,
          cells,
          driverState,
          ahead?.route ?? null,
          current,
        );
        weatherAlertRef.current = updated;
        setWeatherAlert(updated);
        if (!updated && weatherTimerRef.current) clearTimeout(weatherTimerRef.current);
        return;
      }

      // Un solo banner alla volta: non si emette un avviso meteo finche' ne
      // e' visibile un altro, meteo o stradale. Altrimenti resterebbe coperto
      // e la demo perderebbe un passaggio della narrazione.
      if (roadAlertRef.current !== null) return;

      const weather = weatherEngineRef.current.evaluate(
        cells,
        driverState,
        ahead?.route ?? null,
        current,
        geo.ts,
      );
      if (weather) {
        weatherAlertRef.current = weather;
        setWeatherAlert(weather);
        speechRef.current.announce(
          `weather:${weather.cell.id}`,
          weatherAlertPhrase(weather),
          geo.ts,
        );
        if (weatherTimerRef.current) clearTimeout(weatherTimerRef.current);
        weatherTimerRef.current = setTimeout(() => {
          weatherAlertRef.current = null;
          setWeatherAlert(null);
        }, WEATHER.displayMs);
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

  /**
   * Una frase e' stata riconosciuta.
   *
   * Il parser decide cosa dice; qui si costruisce l'evento e si mostra una
   * conferma VISIVA che sparisce da sola. Nessun pulsante da premere: durante
   * la guida non si tocca nulla.
   */
  const handleTranscript = useCallback(
    (transcript: string) => {
      const parsed = parseVoiceReport(transcript);
      if (!parsed.ok) return;

      const geo = sensorRef.current?.getLastGeo() ?? null;
      const event = buildVoiceEvent(parsed.report, geo, {
        reporterId: getAnonId(),
        ...(demoRef.current ? { demo: true } : {}),
      });
      if (!event) {
        showToast('Segnalazione vocale ignorata: posizione non disponibile.');
        return;
      }

      recordEvent(event);

      const meta = HAZARD_META[parsed.report.hazard];
      setVoiceReceipt(meta.label);
      if (voiceReceiptTimerRef.current) clearTimeout(voiceReceiptTimerRef.current);
      voiceReceiptTimerRef.current = setTimeout(
        () => setVoiceReceipt(null),
        VOICE.confirmationMs,
      );
    },
    [recordEvent, showToast],
  );

  // -- riconoscimento vocale: solo durante il monitoraggio, solo se attivato
  useEffect(() => {
    if (!running || !voiceEnabled) return;

    const provider: VoiceProvider = demo
      ? new DemoVoiceProvider(DEMO_VOICE_SCRIPT)
      // L'elaborazione remota parte SOLO con consenso esplicito.
      : new BrowserVoiceProvider(voiceConsent === 'granted');
    voiceRef.current = provider;

    const caps = provider.capabilities();
    if (!caps.supported) {
      setStatus((s) => ({ ...s, voice: 'unsupported' }));
      return;
    }

    provider.start({
      onTranscript: handleTranscript,
      onStatus: (voice: VoiceStatus) => setStatus((s) => ({ ...s, voice })),
      // Raccolta solo quando il pannello e' aperto: a regime non esiste.
      ...(voiceDebug ? { onDiagnostics: pushDiagnostics } : {}),
    });

    return () => {
      provider.stop();
      voiceRef.current = null;
    };
  }, [running, voiceEnabled, demo, voiceConsent, handleTranscript, voiceDebug, pushDiagnostics]);

  /**
   * Fotografia iniziale della catena, con ?debugVoice=1.
   * Serve a vedere COSA offre il browser prima ancora di premere START: e' il
   * primo dato utile quando la voce non parte su un telefono specifico.
   */
  useEffect(() => {
    if (!voiceDebug) return;
    pushDiagnostics({ api: selectedVoiceApi(), local: onDeviceStateNow() });
  }, [voiceDebug, pushDiagnostics, voiceEnabled, running]);

  /**
   * Lettura passiva del permesso del microfono, sempre attiva.
   *
   * Non e' diagnostica: e' cio' che permette di distinguere un rifiuto appena
   * dato da un blocco preesistente. Non apre il microfono, non mostra nessuna
   * finestra, non registra niente.
   */
  useEffect(() => {
    let cancelled = false;
    void readMicPermissionRaw(browserMicEnvironment()).then((raw) => {
      if (cancelled) return;
      // Solo informazione: questo valore non decide niente e non impedisce
      // nessun tentativo. La diagnosi mostra il dato LETTERALE, la riga
      // MICROFONO la sua lettura.
      pushDiagnostics({
        mic: micUsableRef.current ? 'permesso' : interpretPermission(raw),
        permissionsApi: raw === 'non disponibile' ? 'non disponibile' : 'disponibile',
        permissionsValue: raw === 'non disponibile' ? '--' : raw,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [pushDiagnostics, voiceEnabled, running]);

  /**
   * Stato della voce a monitoraggio fermo.
   * Distingue "il browser non puo'" da "non attivata" da "attivata, partira'
   * con START": sono tre cose diverse e vanno dette.
   */
  useEffect(() => {
    if (running) return;
    const supported = demo || new BrowserVoiceProvider().capabilities().supported;
    if (!supported) {
      setStatus((s) => ({ ...s, voice: 'unsupported' }));
      return;
    }
    if (voiceConsent === 'pending') {
      setStatus((s) => ({ ...s, voice: 'consent' }));
      return;
    }
    setStatus((s) => ({ ...s, voice: voiceEnabled ? 'ready' : 'off' }));
  }, [voiceEnabled, running, demo, voiceConsent]);

  /**
   * Accende e spegne la voce.
   *
   * Se il browser non elabora l'audio sul dispositivo servono DUE tocchi: il
   * primo spiega cosa accadrebbe, il secondo lo autorizza. Finche' il consenso
   * non arriva il microfono NON viene acceso - il provider si rifiuta proprio
   * di partire - e l'indicatore mostra "VOCE ?" invece di dichiarare
   * un'attivazione che non c'e' stata.
   */
  const toggleVoice = useCallback(async () => {
    if (voiceEnabled) {
      setVoiceEnabled(false);
      return;
    }

    // In demo la voce e' recitata: nessun microfono, nessun audio, nulla da
    // autorizzare.
    if (demo) {
      setVoiceEnabled(true);
      return;
    }

    // Verifica del supporto: sincrona, non cede il controllo al browser.
    if (!new BrowserVoiceProvider().capabilities().supported) return;

    // PRIMA COSA, e senza nessun await prima: la finestra nativa del
    // microfono. Deve aprirsi dentro l'attivazione di QUESTO tocco. Qualunque
    // attesa messa sopra questa riga - anche una sola - fa decadere il gesto
    // e Android rifiuta senza mostrare niente: e' esattamente cio' che
    // accadeva sul Fold, dove la verifica del motore locale veniva prima.
    // La Permissions API non e' un cancello: qui si verifica aprendo davvero
    // il microfono. L'unica scorciatoia e' positiva - gia' verificato in
    // questa sessione - e in diagnosi (?debugVoice=1) viene ignorata anche
    // quella, per poter osservare i due canali separatamente.
    const mic = await requestMicrophone(browserMicEnvironment(), {
      verified: micUsableRef.current,
      force: voiceDebug,
    });
    pushDiagnostics({
      mic: mic.permission,
      getUserMedia: attemptOf(mic),
      getUserMediaDetail: mic.errorName,
      ...(mic.permissionRaw && mic.permissionRaw !== 'non disponibile'
        ? { permissionsValue: mic.permissionRaw }
        : {}),
    });

    if (mic.usable) {
      // Verificato: il microfono si apre. Qualunque stato negativo precedente
      // era una fotografia vecchia e viene cancellato.
      micUsableRef.current = true;
      setMicBlocked(false);
    } else if (mic.outcome !== 'sconosciuto') {
      // Nessun fallimento viene memorizzato: il prossimo tocco riprova.
      // 'bloccato' e' l'UNICO caso in cui si parla di impostazioni del sito.
      setMicBlocked(mic.outcome === 'bloccato');
      if (mic.outcome === 'bloccato') setStatus((st) => ({ ...st, voice: 'denied' }));
      const message = micMessage(mic.outcome);
      if (message) showToast(message);
      return;
    }

    // Solo ora, con il microfono concesso, ha senso chiedersi DOVE verra'
    // elaborato l'audio. La verifica e' reale: la sola presenza dell'opzione
    // `processLocally` non dice nulla sul fatto che il modello italiano sia
    // installato sul telefono.
    const onDevice = await probeOnDevice();
    pushDiagnostics({ api: selectedVoiceApi(), local: onDeviceStateNow() });

    if (onDevice) {
      // Elaborazione sul dispositivo: non c'e' nulla da autorizzare oltre al
      // microfono, l'audio non esce di qui.
      setVoiceEnabled(true);
      return;
    }

    // Da qui in poi si parla di una cosa DIVERSA dal microfono: mandare
    // l'audio a un servizio esterno del browser. E' un secondo consenso, e
    // resta separato.
    if (voiceConsent === 'granted') {
      setVoiceEnabled(true);
      showToast(
        "Voce attiva. L'audio e' elaborato da un servizio esterno del browser, non da ROAD SENSE.",
      );
      return;
    }

    if (voiceConsent === 'none') {
      setVoiceConsent('pending');
      showToast(
        "Questo browser non elabora la voce sul dispositivo: l'audio verrebbe inviato a un servizio esterno. Tocca di nuovo VOCE per accettare.",
      );
      return;
    }

    // Secondo tocco: consenso all'elaborazione remota dato.
    setVoiceConsent('granted');
    setVoiceEnabled(true);
    showToast(
      "Voce attiva. L'audio e' elaborato da un servizio esterno del browser, non da ROAD SENSE.",
    );
  }, [voiceEnabled, demo, voiceConsent, showToast, pushDiagnostics, voiceDebug]);

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
      // Lo stato degli indicatori arriva da `onStatus`, che e' l'unica
      // fonte: qui si mostra solo il messaggio a chi guarda.
      onError: (err) => showToast(err.message),
    });

    setFollow(true);
    setRunning(true);

    // Unico punto in cui si comunica l'esito dei permessi di movimento.
    // Il provider non segnala nulla da solo: quando li richiede, i suoi
    // handler non sono ancora stati assegnati.
    if (!caps.accelerometer) {
      showToast(
        caps.needsMotionPermission
          ? 'Accesso ai sensori di movimento negato: resta attiva la segnalazione manuale.'
          : 'Sensori di movimento non disponibili: resta attiva la segnalazione manuale.',
      );
    }
  }, [handleGeo, handleSample, showToast]);

  const stop = useCallback(() => {
    sensorRef.current?.stop();
    detectRef.current.reset();
    setRunning(false);
    setStatus((s) => ({ ...s, gps: 'off', sensors: 'off' }));
    setSpeedMps(null);
    weatherSpeedRef.current = null;
    // La voce viene fermata dal proprio effetto quando `running` torna
    // falso: qui basta interrompere la sintesi e togliere la conferma.
    speechRef.current.stop();
    setVoiceReceipt(null);
    setAlert(null);
    roadAlertRef.current = null;
    setWeatherAlert(null);
    weatherAlertRef.current = null;
    weatherEngineRef.current.reset();
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
      if (weatherTimerRef.current) clearTimeout(weatherTimerRef.current);
      if (voiceReceiptTimerRef.current) clearTimeout(voiceReceiptTimerRef.current);
      if (voiceReceiptTimerRef.current) clearTimeout(voiceReceiptTimerRef.current);
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

  const weatherOverlays = useMemo(
    // La DERIVA resta anche con "meno movimento": e' il dato, non un effetto.
    // Si ferma invece tutto cio' che e' decorativo - pulsazione, granuli,
    // raffiche - bloccando la fase su un valore costante.
    () => weatherCellsToOverlays(weatherCells, reducedMotion ? 0.5 : weatherPhase),
    [weatherCells, weatherPhase, reducedMotion],
  );

  /**
   * Veicoli simulati pronti per la mappa. Chi si trova dentro un'area meteo
   * riceve un alone del colore di quell'area: si capisce a colpo d'occhio che
   * il fenomeno interessa piu' veicoli, senza moltiplicare i banner.
   */
  const peerVehicles = useMemo<PeerVehicle[]>(
    () =>
      peers.map((v) => {
        const inside = weatherCells.find(
          (c) => distanceM(v, { lat: c.lat, lon: c.lon }) <= c.radiusM,
        );
        return {
          id: v.id,
          lat: v.lat,
          lon: v.lon,
          heading: v.heading,
          flash: v.flash,
          halo: inside ? WEATHER_META[inside.kind].color : null,
        };
      }),
    [peers, weatherCells],
  );

  const speedLabel = useMemo(
    () => (speedMps === null ? '--' : `${Math.round(speedMps * 3.6)} km/h`),
    [speedMps],
  );

  return (
    <div className="app">
      <StatusBar
        status={status}
        wakeLock={wakeLock}
        running={running}
        demo={demo}
        // Attivabile solo da fermi: durante la guida non si tocca nulla.
        {...(running ? {} : { onToggleVoice: toggleVoice })}
      />

      {updateReady && (
        <div className="update-bar">
          <span>Aggiornamento disponibile</span>
          <button onClick={applyUpdate}>AGGIORNA</button>
        </div>
      )}

      {/* Microfono bloccato dal browser: e' l'unico caso in cui le
          impostazioni del sito sono davvero l'unica via. Un rifiuto appena
          dato NON arriva qui: si risolve toccando di nuovo VOCE. */}
      {micBlocked && !demo && (
        <div className="mic-bar" role="alert">
          <strong>MICROFONO BLOCCATO.</strong> Riattivalo nelle impostazioni del sito, poi tocca di
          nuovo VOCE.
        </div>
      )}

      {/* Il secondo tocco non puo' dipendere da un messaggio che sparisce:
          finche' il consenso manca, la richiesta resta scritta sullo schermo. */}
      {voiceConsent === 'pending' && !demo && (
        <div className="consent-bar" role="alert">
          <strong>SERVE UN SECONDO TOCCO.</strong> Questo browser non elabora la voce sul
          dispositivo: l'audio verrebbe inviato a un servizio esterno del browser. Tocca di nuovo
          VOCE per accettare.
        </div>
      )}

      {/* Diagnosi: esiste solo con ?debugVoice=1. */}
      {voiceDebug && <VoiceDebugPanel diagnostics={diagnostics} />}

      <div className="map-wrap">
        <MapView
          // Il cambio di modalita' rimonta la mappa, cosi' riparte dalla
          // vista giusta invece di restare dove si trovava.
          key={demo ? 'demo' : 'live'}
          clusters={clusters}
          position={position}
          heading={heading}
          follow={follow && running}
          initialView={demo ? { ...DEMO_ROUTE_CENTER, zoom: 14.5 } : null}
          followZoom={demo ? MAP.followZoomDemo : MAP.followZoom}
          // Tracciato della demo: linea sottile, visibile SOLO in ?demo=1.
          // Per rimuoverla basta non passare questa prop.
          routeOverlay={demo ? DEMO_ROUTE : null}
          // Celle meteo simulate: esistono solo in demo.
          areaOverlays={demo ? weatherOverlays : null}
          // Veicoli ROAD SENSE simulati: esistono solo in demo.
          peerVehicles={demo ? peerVehicles : null}
          onMapMovedByUser={() => setFollow(false)}
        />
        <AlertBanner
          alert={alert}
          assessment={alertAssessment}
          source={demo ? 'demo' : backendEnabled() ? 'network' : 'local'}
          onDismiss={() => {
            roadAlertRef.current = null;
            setAlert(null);
            setAlertAssessment(null);
          }}
        />
        {/* Un solo banner alla volta: l'avviso stradale ha la precedenza,
            perche' riguarda cio' che c'e' gia' sull'asfalto. */}
        {alert === null && (
          <WeatherBanner
            alert={weatherAlert}
            onDismiss={() => {
              weatherAlertRef.current = null;
              setWeatherAlert(null);
            }}
          />
        )}
        {demo && (running || weatherCells.length > 0) && (
          <div className="demo-legend">
            {/* La riga dei veicoli compare solo quando i veicoli ci sono
                davvero: una legenda che spiega cose non visibili confonde. */}
            {running && (
              <div className="row">
                {/* Gli stessi simboli disegnati sulla mappa, non due pallini
                    generici: la legenda deve spiegare cio' che si vede. */}
                <span className="k me" /> TU
                <span className="k peer">
                  <CarGlyph color={CAR_COLOR.peer} />
                </span>{' '}
                VEICOLO ROAD SENSE · SIMULATO
              </div>
            )}
            {weatherCells.length > 0 && <div className="row sim">ROAD WEATHER · SIMULAZIONE</div>}
          </div>
        )}
        {toast && <div className="toast">{toast}</div>}
        {/* Conferma non interattiva: appare, informa, sparisce. Nessun
            pulsante da premere mentre si guida. */}
        {voiceReceipt && (
          <div className="voice-receipt" role="status">
            <span className="vr-title">SEGNALAZIONE RICEVUTA</span>
            <span className="vr-what">{voiceReceipt}</span>
          </div>
        )}
      </div>

      {/* Una riga sola, e solo quando serve: prima di partire, in modalita'
          reale. Sparisce appena il monitoraggio e' attivo, perche' guidando
          non si legge. Nessun wizard, nessuna schermata introduttiva. */}
      {!demo && !running && (
        <p className="intro">
          ROAD SENSE usa posizione e sensori del telefono per rilevare irregolarita' della
          strada. In questa beta i dati restano sul dispositivo.
          {/* Limite reale, non aggirabile da una PWA: va detto qui, non solo
              nella documentazione, perche' cambia come si usa l'app. */}
          <span className="intro-strong">
            {' '}Durante il test lascia ROAD SENSE aperto e lo schermo acceso. La modalità in
            background non è ancora disponibile.
          </span>
        </p>
      )}

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
