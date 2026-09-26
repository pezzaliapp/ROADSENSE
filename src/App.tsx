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

import {
  ALERT,
  API,
  APP,
  CORRIDOR,
  MAP,
  MERGE_RADIUS_M,
  PRIVACY,
  SENSORS,
  VOICE,
  WEATHER,
} from './config/config';
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
  VoskVoiceProvider,
  type VoiceModelPhase,
} from './voice/local/VoskVoiceProvider';
import { DemoVoiceProvider } from './voice/DemoVoiceProvider';
import type { VoiceDiagnostics, VoiceProvider, VoiceStatus } from './voice/VoiceProvider';
import type { DetectionTelemetry } from './core/DetectionEngine';
import {
  browserMicEnvironment,
  interpretPermission,
  readMicPermissionRaw,
} from './voice/micPermission';
import { parseVoiceReport } from './voice/parser';
import { hazardFamily, HAZARD_META } from './hazard/taxonomy';
import { admitsAlert, assessCluster, type HazardAssessment } from './hazard/assessment';
import { AlertSpeechEngine } from './speech/AlertSpeechEngine';
import { BrowserSpeechProvider } from './speech/BrowserSpeechProvider';
import { SilentSpeechProvider } from './speech/SpeechProvider';
import { roadAlertPhrase, weatherAlertPhrase } from './speech/phrases';
import { DEMO_VOICE_SCRIPT } from './demo/demoVoiceScript';
import { routeAheadFrom } from './demo/routeAhead';
import {
  allowsRoadRelevance,
  buildForwardCorridor,
  corridorRoute,
  type ForwardCorridor,
} from './core/forwardCorridor';
import type { RoadQuery } from './ui/mapRoads';
import type { DemoVehicleState } from './demo/DemoVehicle';
import type {
  EventCluster,
  EventSource,
  EventType,
  GeoSample,
  RoadEvent,
  SystemStatus,
} from './core/types';
import { backendEnabled, fetchNearby, postEvents } from './net/api';

import { DemoWeatherProvider } from './weather/DemoWeatherProvider';
import { NowcastWeatherProvider } from './weather/NowcastWeatherProvider';
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
import { SensorDebugPanel } from './ui/SensorDebugPanel';
import { corridorDebug, type CorridorDebug } from './ui/corridorDebug';

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

/**
 * DEBUG SENSORI: mostra i valori misurati dal rilevamento.
 * Serve a calibrare le soglie anti-falso-positivo con un test reale invece
 * che a intuito. Come il debug voce, nulla esce dal dispositivo.
 */
function isSensorDebugRequested(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('sensorDebug') === '1';
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
  // Lo stato della voce vive in `status.voice`: "ascolto in corso" non e' un
  // interruttore che l'utente lascia acceso, e' la durata di una sessione.
  /**
   * Primo scaricamento del modello vocale.
   *
   * Non e' diagnostica: sono 47 MB, e chi tocca VOCE ha diritto di sapere che
   * sta succedendo qualcosa invece di vedere un pulsante che non risponde.
   * Scaricati una volta, restano nella cache del browser.
   */
  const [voiceModel, setVoiceModel] = useState<{
    phase: VoiceModelPhase;
    percent: number;
    reason: string | null;
  }>({ phase: 'assente', percent: 0, reason: null });

  /**
   * Diagnosi della catena vocale. Esiste solo con ?debugVoice=1 e non lascia
   * mai il dispositivo. Nell'interfaccia normale non viene mostrata.
   */
  const [voiceDebug] = useState(isVoiceDebugRequested);
  const [sensorDebug] = useState(isSensorDebugRequested);
  /**
   * Lo stesso valore, leggibile dentro le callback dei sensori senza
   * rientrare nelle dipendenze degli effetti.
   */
  const sensorDebugRef = useRef(sensorDebug);
  sensorDebugRef.current = sensorDebug;
  /**
   * Fotografia dei sensori, aggiornata a bassa frequenza.
   * I campioni arrivano a 50 Hz: ridisegnare a quel ritmo sarebbe uno spreco
   * e renderebbe i numeri illeggibili.
   */
  const [telemetry, setTelemetry] = useState<DetectionTelemetry | null>(null);
  /**
   * Stato del corridoio, solo con ?sensorDebug=1.
   *
   * Non e' un log: e' l'ultimo valore, sovrascritto a ogni posizione. Nessuna
   * coordinata, nessuna cronologia, niente che sopravviva alla pagina.
   */
  const [corridorInfo, setCorridorInfo] = useState<CorridorDebug | null>(null);
  const telemetryAtRef = useRef(0);
  const autoEventsRef = useRef(0);
  const [autoEvents, setAutoEvents] = useState(0);
  const [diagnostics, setDiagnostics] = useState<VoiceDiagnostics>(() => ({
    api: 'assente',
    mic: 'sconosciuto',
    phase: 'idle',
    local: 'non disponibile',
    remote: false,
    lastError: null,
    lastPhrase: null,
    events: '',
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
   * Il riconoscitore ha dichiarato `not-allowed`: il microfono non e'
   * disponibile per ROAD SENSE. Lo dice SpeechRecognition, che e' l'unico che
   * lo sa davvero - non la Permissions API, che al primo test su Android
   * dichiarava un blocco inesistente.
   */
  const [micBlocked, setMicBlocked] = useState(false);

  /**
   * Stato della voce, con l'avviso persistente collegato.
   * Un messaggio che sparisce non basta: finche' il microfono e' negato la
   * riga resta sullo schermo, e sparisce da sola appena l'ascolto parte.
   */
  const handleVoiceStatus = useCallback((voice: VoiceStatus) => {
    setStatus((st) => ({ ...st, voice }));
    if (voice === 'denied') setMicBlocked(true);
    if (voice === 'listening') setMicBlocked(false);
  }, []);

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
  /**
   * Mentre ROAD SENSE parla, il riconoscitore viene RILASCIATO.
   *
   * Due motivi, entrambi osservati nel primo test in auto: la voce sintetica
   * rientrerebbe dal microfono e "Attenzione, buca segnalata" diventerebbe
   * una segnalazione di buca - l'app parlerebbe a se stessa; e su iOS sintesi
   * e riconoscimento si contendono la stessa sessione audio.
   */
  const handleSpeakingChange = useCallback((speaking: boolean) => {
    const voice = voiceRef.current;
    if (speaking) voice?.pause?.();
    else voice?.resume?.();
  }, []);
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
  /**
   * Interrogazione della geometria stradale gia' caricata dalla mappa.
   * `null` finche' la mappa non e' pronta: in quel caso il corridoio ripiega
   * sull'heading e lo dichiara.
   */
  const roadQueryRef = useRef<RoadQuery | null>(null);
  /** Ultimo corridoio costruito. Conservato per la diagnosi e per la mappa. */
  const corridorRef = useRef<ForwardCorridor | null>(null);
  /**
   * Il percorso attuale puo' sostenere un'affermazione di pertinenza
   * stradale.
   *
   * Vero in demo, dove il tracciato e' noto ed e' una strada vera. Fuori
   * dalla demo dipende dal corridoio: la geometria cartografica si', una
   * proiezione sull'heading no.
   */
  const roadEvidenceRef = useRef(false);
  /** Sorgente meteo della demo: possiede l'unico orologio dello scenario. */
  const weatherProviderRef = useRef<DemoWeatherProvider | null>(null);
  /**
   * Sorgente meteo REALE. Vive separata da quella della demo perche' i due
   * cicli sono diversi: la demo ha un orologio proprio, NOWCAST si interroga
   * ogni tanto e degrada da solo quando non risponde.
   */
  const nowcastRef = useRef<NowcastWeatherProvider | null>(null);
  const nowcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // ha una sorgente propria: in demo le celle sono inventate, fuori dalla
  // demo arrivano da NOWCAST (effetto separato, piu' sotto).
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

  /**
   * Meteo reale da NOWCAST.
   *
   * Si interroga SOLO mentre il monitoraggio e' attivo: a veicolo fermo non
   * serve, e ogni richiesta raggiunge un server che non ha cache davanti.
   * Mai in demo, mai offline, mai a pagina nascosta.
   *
   * Nessun fallimento di NOWCAST puo' propagarsi: l'esito peggiore possibile
   * e' nessuna cella meteo, cioe' ROAD SENSE come se il meteo non esistesse.
   */
  useEffect(() => {
    if (demo || !running) return;

    const provider = nowcastRef.current ?? new NowcastWeatherProvider();
    nowcastRef.current = provider;
    // Catturato qui: al momento della pulizia il ref potrebbe gia' puntare
    // altrove, e si azzererebbe il motore sbagliato.
    const weatherEngine = weatherEngineRef.current;
    let stopped = false;

    const applica = () => {
      if (stopped) return;
      const cells = provider.isAvailable() ? provider.cells() : [];
      weatherCellsRef.current = cells;
      setWeatherCells(cells);
    };

    const giro = () => {
      if (stopped) return;
      // A pagina nascosta non si consuma rete: il monitoraggio non e'
      // utilizzabile comunque a schermo spento.
      const visibile = typeof document === 'undefined' || document.visibilityState !== 'hidden';
      const online = typeof navigator === 'undefined' || navigator.onLine !== false;
      const attesa = visibile && online ? provider.refresh().then(applica) : Promise.resolve();
      void attesa.finally(() => {
        if (stopped) return;
        nowcastTimerRef.current = setTimeout(giro, provider.nextDelayMs());
      });
    };

    giro();

    return () => {
      stopped = true;
      if (nowcastTimerRef.current) clearTimeout(nowcastTimerRef.current);
      nowcastTimerRef.current = null;
      provider.reset();
      weatherCellsRef.current = [];
      setWeatherCells([]);
      weatherEngine.reset();
    };
  }, [demo, running]);

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

      // Il percorso davanti al veicolo.
      //
      // In demo resta il tracciato noto, che e' esatto e non va peggiorato.
      // Fuori dalla demo, dove fino alla Fase 1 non c'era nulla, si costruisce
      // un corridoio locale: dalla geometria stradale se la mappa ne ha, da
      // posizione e direzione altrimenti. Il corridoio dichiara sempre quale
      // delle due sia, e una proiezione NON vale come prova che un evento si
      // trovi sulla stessa strada.
      let ahead: { route: { pointAt: (m: number) => { lat: number; lon: number } | null } } | null =
        null;
      if (demoRef.current) {
        const demoAhead = routeAheadFrom({ lat: geo.lat, lon: geo.lon }, routeHintRef.current);
        routeHintRef.current = demoAhead.atM;
        ahead = { route: demoAhead.route };
        corridorRef.current = null;
        // Il tracciato della demo e' una strada nota: puo' sostenere la
        // pertinenza esattamente come la geometria cartografica.
        roadEvidenceRef.current = true;
      } else {
        const roads =
          roadQueryRef.current?.({ lat: geo.lat, lon: geo.lon }, CORRIDOR.roadMaxLengthM) ?? [];
        const corridor = buildForwardCorridor({
          position: { lat: geo.lat, lon: geo.lon },
          heading: geo.heading,
          speedMps: geo.speedMps,
          roads,
        });
        corridorRef.current = corridor;
        roadEvidenceRef.current = allowsRoadRelevance(corridor);
        const route = corridorRoute(corridor);
        ahead = route ? { route } : null;

        // Osservazione, dopo la decisione: non puo' influenzarla. Fuori dal
        // debug non viene nemmeno calcolata.
        if (sensorDebugRef.current) {
          setCorridorInfo(
            corridorDebug(corridor, {
              heading: geo.heading,
              speedMps: geo.speedMps,
              roadFeatures: roads.length,
            }),
          );
        }
      }

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

        // "sul percorso" afferma che il fenomeno incrocia la strada percorsa.
        // Con un corridoio costruito sul solo heading quell'affermazione non
        // e' dimostrata, e non va pronunciata: il fenomeno resta sulla mappa
        // e nel banner, che mostrano una previsione senza dichiararla certa.
        //
        // "nell'area attuale" e' un'altra cosa: dice dove ci si trova adesso,
        // non dove si andra', e non dipende dal percorso.
        const puoDireSulPercorso = weather.forecast.inside || roadEvidenceRef.current;
        if (puoDireSulPercorso) {
          speechRef.current.announce(
            `weather:${weather.cell.id}`,
            weatherAlertPhrase(weather),
            geo.ts,
          );
        }
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

      if (sensorDebug) {
        // Aggiornamento a ~4 Hz, tranne quando succede qualcosa: un impulso o
        // un evento devono restare visibili anche se durano un campione.
        const tele = detectRef.current.lastTelemetry();
        const now = Date.now();
        if (tele.eventEmitted || tele.impulseDetected || now - telemetryAtRef.current > 250) {
          telemetryAtRef.current = now;
          setTelemetry(tele);
        }
      }

      if (!detection) return;
      if (sensorDebug) {
        autoEventsRef.current += 1;
        setAutoEvents(autoEventsRef.current);
      }

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
    [demo, recordEvent, sensorDebug],
  );



  // Il riconoscimento non vive piu' in un effetto: e' una sessione che nasce
  // da un tocco e muore da sola. Vedi `startVoice`, piu' sotto.


  /**
   * Fotografia iniziale della catena, con ?debugVoice=1.
   * Serve a vedere COSA offre il browser prima ancora di premere START: e' il
   * primo dato utile quando la voce non parte su un telefono specifico.
   */
  useEffect(() => {
    if (!voiceDebug) return;
    // Nessuna API di riconoscimento del sistema da interrogare: il decoder e'
    // nostro e sta nel dispositivo, quindi l'elaborazione locale e' un fatto.
    pushDiagnostics({ api: 'assente', local: 'si', remote: false });
  }, [voiceDebug, pushDiagnostics, running]);

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
  }, [pushDiagnostics, running]);

  /**
   * Stato della voce fuori da una sessione.
   *
   * Distingue "il browser non puo'" da "in attesa di consenso" da "pronta":
   * tre cose diverse, e chi guida deve poterle distinguere senza indagare.
   * Durante una sessione lo stato lo detta il provider.
   */
  useEffect(() => {
    const supported = demo || new VoskVoiceProvider().capabilities().supported;
    if (!supported) {
      setStatus((s) => ({ ...s, voice: 'unsupported' }));
      return;
    }
    // Non si chiede piu' alcun consenso per l'invio dell'audio: non viene
    // inviato da nessuna parte. Il riconoscimento avviene nel dispositivo.
    setStatus((s) => (s.voice === 'listening' ? s : { ...s, voice: 'ready' }));
  }, [demo]);

  // `startVoice` e' definita dopo `handleTranscript`, che le serve.


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
  /**
   * Registra una segnalazione fatta da una persona.
   *
   * UNICO percorso per il pulsante SEGNALA e per la voce: non esistono due
   * logiche parallele. `source` dice soltanto come e' arrivata - una voce e
   * un tocco sono la stessa segnalazione, e devono produrre lo stesso evento.
   */
  const report = useCallback(
    (type: EventType, source: EventSource = 'manual') => {
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
        // Voce e pulsante sono la stessa segnalazione, fatta in due modi:
        // stessa posizione, stessa severita', stessa confidenza. Cambia solo
        // come e' stata raccolta, e quello va registrato com'e'.
        source,
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

  /**
   * Una frase e' stata riconosciuta.
   *
   * Il parser decide cosa dice; qui si costruisce l'evento e si mostra una
   * conferma VISIVA che sparisce da sola. Nessun pulsante da premere: durante
   * la guida non si tocca nulla.
   */
  const handleTranscript = useCallback(
    (transcript: string) => {
      // Nessuna parola di attivazione: il tocco su VOCE dice gia' che si sta
      // parlando all'applicazione. Pretendere anche "ROAD SENSE" sarebbe un
      // ostacolo senza scopo, e sul campo era la ragione per cui dire
      // "buca" non produceva nulla.
      const parsed = parseVoiceReport(transcript, { requireWakeWord: false });

      if (!parsed.ok) {
        // Un fallimento muto e' indistinguibile da un microfono che non
        // sente: si dice sempre cos'e' successo.
        if (parsed.reason === 'not-understood') {
          showToast(`Non ho capito "${transcript.trim()}". Tocca VOCE e riprova.`);
        } else if (parsed.reason === 'no-wake-word') {
          showToast('Non ho capito. Tocca VOCE e di\' il pericolo, per esempio "buca".');
        }
        return;
      }

      // STESSO percorso del pulsante SEGNALA: una sola funzione, una sola
      // logica. Cambia solo come la segnalazione e' arrivata.
      report(hazardFamily(parsed.report.hazard), 'voice');

      const meta = HAZARD_META[parsed.report.hazard];
      setVoiceReceipt(meta.label);
      if (voiceReceiptTimerRef.current) clearTimeout(voiceReceiptTimerRef.current);
      voiceReceiptTimerRef.current = setTimeout(
        () => setVoiceReceipt(null),
        VOICE.confirmationMs,
      );
    },
    [report, showToast],
  );

  /**
   * Apre UNA sessione di ascolto.
   *
   *   tocco su VOCE -> ascolto -> "buca" -> segnalazione -> microfono chiuso
   *
   * Per un'altra segnalazione serve un altro tocco. Nessun riavvio
   * automatico, nessun ascolto permanente: sono le due cose che rendevano il
   * microfono inutilizzabile: su iPhone silenziavano l'impianto dell'auto, su
   * Android facevano suonare il tono di attivazione ogni pochi secondi.
   *
   * Non dipende da velocita', movimento, sensori o monitoraggio attivo: si
   * puo' segnalare anche da fermi, esattamente come col pulsante SEGNALA.
   */
  const startVoice = useCallback(() => {
    // Ascolto gia' attivo - in sessione o in attesa di riarmarsi: un secondo
    // tocco non deve aprire una catena parallela.
    if (voiceRef.current?.isArmed?.() || voiceRef.current?.isListening?.()) return;

    // In demo la voce e' recitata: nessun microfono, nulla da autorizzare.
    if (demo) {
      const recita = new DemoVoiceProvider(DEMO_VOICE_SCRIPT);
      voiceRef.current = recita;
      recita.start({ onTranscript: handleTranscript, onStatus: handleVoiceStatus });
      return;
    }

    // Verifica del supporto: sincrona, non cede il controllo al browser.
    const provider = new VoskVoiceProvider();
    if (!provider.capabilities().supported) {
      setStatus((st) => ({ ...st, voice: 'unsupported' }));
      return;
    }

    // >>> NESSUN await sopra questa riga. <<<
    // `start()` arriva a `getUserMedia` senza cedere il controllo: su Android e'
    // quella chiamata a far comparire la richiesta del microfono, e un'attesa
    // interposta farebbe decadere l'attivazione del tocco. Il modello - 47 MB -
    // si carica DOPO, fuori dal gesto.
    voiceRef.current = provider;
    // La voce parlata deve poter sospendere l'ascolto mentre parla.
    speechRef.current.setHandlers({ onSpeakingChange: handleSpeakingChange });
    provider.start({
      onTranscript: handleTranscript,
      onStatus: handleVoiceStatus,
      onModelProgress: (phase, progress, reason) =>
        setVoiceModel({
          phase,
          percent: Math.round((progress?.ratio ?? 0) * 100),
          reason: reason ?? null,
        }),
      ...(voiceDebug ? { onDiagnostics: pushDiagnostics } : {}),
    });
  }, [
    demo,
    handleTranscript,
    handleVoiceStatus,
    handleSpeakingChange,
    pushDiagnostics,
    voiceDebug,
  ]);

  // Allo smontaggio nessuna sessione deve restare aperta.
  useEffect(
    () => () => {
      voiceRef.current?.stop();
      voiceRef.current = null;
    },
    [],
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
        // Toccabile SEMPRE: una segnalazione vocale e' un gesto come premere
        // SEGNALA, e deve funzionare anche in marcia e da fermi.
        onToggleVoice={startVoice}
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
          <strong>MICROFONO NON AUTORIZZATO.</strong> Tocca di nuovo VOCE per riprovare. Se non
          compare nessuna richiesta, abilita il microfono nelle impostazioni del sito.
        </div>
      )}

      {/* PRIMO AVVIO DELLA VOCE.
          Il modello vocale pesa 47 MB e si scarica una volta sola. Senza questo
          avviso il pulsante VOCE sembrerebbe non rispondere per un minuto.
          Tutto il resto - sensori, mappa, rilevamento, pulsante SEGNALA -
          funziona gia': la voce e' l'unica cosa che sta arrivando. */}
      {!demo && voiceModel.phase === 'scaricamento' && (
        <div className="consent-bar" role="status">
          <strong>PREPARAZIONE VOCE {voiceModel.percent}%.</strong> Riconoscimento vocale scaricato
          una volta sola e conservato nel telefono. Nel frattempo puoi usare ROAD SENSE
          normalmente.
        </div>
      )}
      {!demo && voiceModel.phase === 'preparazione' && (
        <div className="consent-bar" role="status">
          <strong>VOCE QUASI PRONTA.</strong> Ultimi secondi.
        </div>
      )}
      {/* Il MOTIVO, non solo l'esito.
          Un messaggio generico ha gia' nascosto una volta un errore esplicito,
          ed e' costato un test su strada e un'intera sessione di riproduzione.
          Non e' un pannello diagnostico: e' una riga, e compare solo quando
          qualcosa e' andato storto davvero. */}
      {!demo && voiceModel.phase === 'errore' && (
        <div className="mic-bar" role="alert">
          <strong>VOCE NON DISPONIBILE.</strong> Il resto di ROAD SENSE funziona: usa il pulsante
          SEGNALA.
          {voiceModel.reason && <> Motivo: {voiceModel.reason.slice(0, 160)}</>}
        </div>
      )}

      {/* Diagnosi: esistono solo con i rispettivi parametri nell'indirizzo. */}
      {voiceDebug && <VoiceDebugPanel diagnostics={diagnostics} />}
      {sensorDebug && (telemetry || corridorInfo) && (
        <SensorDebugPanel
          telemetry={telemetry}
          eventCount={autoEvents}
          corridor={corridorInfo}
        />
      )}

      <div className="map-wrap">
        <MapView
          // Il cambio di modalita' rimonta la mappa, cosi' riparte dalla
          // vista giusta invece di restare dove si trovava.
          key={demo ? 'demo' : 'live'}
          clusters={clusters}
          onRoadQuery={(query) => {
            roadQueryRef.current = query;
          }}
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
