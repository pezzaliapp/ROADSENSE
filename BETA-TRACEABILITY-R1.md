# ROAD SENSE — BETA TRACEABILITY R1

**Documento:** BETA-TRACEABILITY-R1
**Specifica di riferimento:** `ROAD-SENSE-BETA-MASTER-R1.md` (BASELINE CONGELATA)
**Baseline:** `e1e3239` (audit originale su `5f8ecbb8`)
**Ultimo aggiornamento:** Fase 1 — Forward Corridor (ROUTE-02), 25/09/2026
**Stato:** modifiche locali non committate; nessun push, nessun deploy.

> **Aggiornamento Fase 1.** Gli ID rivisti sono elencati nella sezione
> *Changelog Fase 1* in fondo. Tutti gli altri restano invariati rispetto
> all'audit iniziale.

Questo documento è la Traceability Matrix richiesta da **TRACE-01** e **TRACE-02**. Copre
tutti e 300 gli ID della Master R1. Nessun requisito è stato reinterpretato, ridotto o
omesso (**CHANGE-05**).

---

## ⚠️ Nota preliminare sulla collocazione della Master

La Master **non si trova nella root del repository** come indicato nell'istruzione.
Percorso reale in cui è stata trovata e letta, in sola lettura:

```
/Users/alessandropezzali/Downloads/ROAD-SENSE-BETA-MASTER-R1.md   (1128 righe)
/Users/alessandropezzali/Downloads/ROAD-SENSE-BETA-MASTER-R1.docx
```

Non è stata copiata nel repository: l'unico file nuovo autorizzato è questo.
**Va spostata nella root prima del prossimo ciclo**, altrimenti la Master non è
versionata insieme al codice che governa.

---

## 1. MASTER COMPLETENESS CHECK

Estrazione automatica degli ID dai titoli `### <ID>` della Master.

```
Master IDs totali:      300
IDs analizzati:         300
IDs mancanti:             0
Duplicati:                0
```

Distribuzione degli stati:

| Stato | Tutti gli ID | Solo requisiti funzionali* |
|---|---:|---:|
| PASS | 153 | 121 |
| PARTIAL | 57 | 57 |
| MISSING | 69 | 69 |
| BLOCKED | 0 | 0 |
| DEVICE TEST | 9 | 9 |
| BACKEND REQUIRED | 8 | 8 |
| PLATFORM LIMITATION | 4 | 4 |
| **TOTALE** | **300** | **268** |

\* esclusi i 21 `BASE-*` (fatti accertati) e gli 11 `TRACE-*`/`CHANGE-*` (requisiti di
processo, soddisfatti da questo documento stesso). La colonna di destra è quella che
descrive lo stato reale del **prodotto**: 121 requisiti dimostrati su 268.

> **BASE-01 … BASE-21** sono fatti accertati, non requisiti da implementare. Compaiono
> nella matrice perché **TRACE-01** impone che ogni ID vi appaia, con stato `PASS` nel
> senso di «fatto confermato dal codice», non di «requisito soddisfatto».

---

## 2. COMPLETE TRACEABILITY MATRIX

Legenda colonne: **EVIDENZA** = file/funzione · **TEST** = test esistente o `NONE` ·
**GAP** = scarto esatto · **DIP** = dipendenze · **REG** = rischio regressione (L/M/H).

### A — CORE / SESSIONE

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| CORE-01 | PARTIAL | `App.tsx start()` avvia SensorEngine, DetectionEngine, EventStore, AlertEngine, polling NOWCAST | `demoPipeline.test.ts` | road awareness non avviata: non esiste fuori demo | ROAD-*, ROUTE-* | M |
| CORE-02 | PASS | `App.tsx stop()`; cleanup in ogni `useEffect`; `voiceRef.stop()`, `useWakeLock(false)`, `clearInterval` | `wakeLock.test.ts`, `voiceSession.test.ts` | nessuno | — | M |
| CORE-03 | PASS | Ogni effetto ha funzione di cleanup; provider ricreati non accumulati | NONE (vedi TEST-LIFE-01) | nessun test dedicato ai cicli ripetuti | — | M |
| CORE-04 | PASS | `degradation.test.ts` copre assenza rete/voce/sensori | `degradation.test.ts` | nessuno | — | L |

### B — SENSORI E DETECTION

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| SENSOR-01 | PASS | `PhoneSensorProvider` usa `devicemotion` (accel + gyro) e Geolocation | `sensorStatus.test.ts` | nessuno | — | L |
| SENSOR-02 | PASS | `SensorProvider → SensorEngine → DetectionEngine → EventStore` intatta | `demoPipeline.test.ts` | nessuno | — | L |
| SENSOR-03 | PASS | `DetectionEngine.push()` scarta con `'posizione assente'` se `lat/lon` null | `DetectionEngine.test.ts` | nessuno | — | L |
| SENSOR-04 | PASS | `severityFromPeak()`, `singleDetectionConfidence()` nel motore; UI non ricalcola | `DetectionEngine.test.ts` | nessuno | — | L |
| SENSOR-05 | PASS | Soglie in `config.ts DETECTION`; `StabilityMonitor` aggiunge criteri senza alterarle | `StabilityMonitor.test.ts` | soglie `stability` dichiarate provvisorie, da validare su strada | — | M |
| SENSOR-06 | PARTIAL | Aggregazione solo a livello cluster (`buildClusters`) | `ConfidenceEngine.test.ts` | i rilevamenti duplicati restano eventi distinti (BASE-04) | DEDUP-* | M |

### C — VOICE INPUT HANDS-FREE

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| VOICE-IN-01 | **MISSING** | `startVoice()` apre una sessione per tocco; `closeSession` alla prima frase | `voiceSession.test.ts` | ogni segnalazione richiede un tocco (BASE-05) | VOICE-LIFE-03/04, SELF-04/05 | H |
| VOICE-IN-02 | PASS | `parseVoiceReport(t, { requireWakeWord: false })` in `handleTranscript` | `voiceSession.test.ts` «nessuna parola di attivazione» | nessuno | — | L |
| VOICE-IN-03 | **MISSING** | Nessun re-arm: `onend → closeSession`, mai `open()` | `voiceSession.test.ts` | dopo una segnalazione serve un nuovo tocco | VOICE-IN-01 | H |
| VOICE-IN-04 | **MISSING** | Idem | `voiceSession.test.ts` | multi-command non possibile | VOICE-IN-01/03 | H |
| VOICE-IN-05 | PASS | Percorso vocale privo di controlli su velocità; `report()` richiede solo posizione | `voiceSession.test.ts` «non dipende da velocità o sensori» | nessuno | — | L |
| VOICE-IN-06 | PASS | `delivered` + `interimResults=false`; prima frase utile chiude | `voiceSession.test.ts` «risultato duplicato» | nessuno | — | L |
| VOICE-IN-07 | PASS | `report(hazardFamily(hazard), 'voice')` — stessa funzione del pulsante | `voiceSession.test.ts` «convergono» | nessuno | — | M |

### D — LIFECYCLE MICROFONO

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| VOICE-LIFE-01 | PASS | Zero `scheduleNext/restart/gapMs/windowMs`; un solo `this.env.setTimeout`, che chiude | `voiceSession.test.ts` «nessun riavvio automatico» | nessuno (BASE-06) | — | H |
| VOICE-LIFE-02 | PASS | Una istanza per sessione, `release()` incrementa `generation` | `voiceSession.test.ts` | nessuno | — | H |
| VOICE-LIFE-03 | **MISSING** | Nessun recovery esiste | NONE | serve recovery con backoff per VOICE-IN-03/04 | VOICE-IN-03 | H |
| VOICE-LIFE-04 | **MISSING** | Nessun circuit breaker | NONE | da progettare insieme al recovery | VOICE-LIFE-03 | H |
| VOICE-LIFE-05 | PASS | `stop()` → `clearTimer()` + `release()` | `voiceSession.test.ts` «stop non lascia timer» | nessuno | — | M |
| VOICE-LIFE-06 | PASS (vacuo) | Nessun recovery esiste, quindi nessun recovery aggressivo | NONE | diventerà sostanziale quando VOICE-LIFE-03 sarà implementato | PHONE-07 | H |
| VOICE-LIFE-07 | PASS | `continuous = false` esplicito e commentato | `voiceSession.test.ts` «non usa l'ascolto continuo» | nessuno | — | L |

### E — VOICE OUTPUT

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| VOICE-OUT-01 | PASS | `speechRef.current.announce(...)` per alert stradali e meteo | `speech.test.ts` | nessuno | — | M |
| VOICE-OUT-02 | PASS | `roadAlertPhrase()` → «Buca tra 300 metri» | `speech.test.ts` | nessuno | — | L |
| VOICE-OUT-03 | BACKEND REQUIRED | Pipeline completa ma `API.base` vuoto | `speech.test.ts` (solo frase) | nessun evento remoto arriva | NET-*, REMOTE-* | M |
| VOICE-OUT-04 | PASS | `hazardText()` + `EVENT_META`/`HAZARD_META` coprono tutte le famiglie | `speech.test.ts` | nessuno | — | L |
| VOICE-OUT-05 | PASS | `spokenDistance()` arrotonda a 50 m / 0,1 km | `speech.test.ts` | nessuno | — | L |
| VOICE-OUT-06 | PASS | `SPEECH.minGapMs` + stato `speaking` idempotente | `ducking.test.ts` | nessuno | — | M |
| VOICE-OUT-07 | **MISSING** | Nessuna coda: `announce()` parla o tace | NONE | serve pending queue con rivalutazione | ALERT-06/07, PHONE-ALERT-* | H |

### F — SELF-LISTENING / TTS

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| SELF-01 | PASS | `onSpeakingChange(true) → voice.pause() → closeSession()` | `ducking.test.ts` | nessuno (BASE-07) | — | H |
| SELF-02 | PASS | `AlertSpeechEngine.isSpeaking()` + `setSpeaking()` idempotente | `ducking.test.ts` | nessuno | — | M |
| SELF-03 | PASS | Riconoscitore rilasciato; `generation` scarta risultati in ritardo | `voiceSession.test.ts` «evento in ritardo» | nessuno | — | H |
| SELF-04 | **MISSING** | `resume()` è un no-op dichiarato | `voiceSession.test.ts` | nessun recupero post-TTS | VOICE-LIFE-03 | H |
| SELF-05 | **MISSING** | Idem | NONE | serve un nuovo tocco (BASE-07) | SELF-04 | H |

### G — TELEFONATE / BLUETOOTH / CARPLAY / ASSISTENTI

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| PHONE-01 | PLATFORM LIMITATION | Nessun codice; l'OS sospende la pagina | NONE | comportamento non controllato né osservato | DEVICE-02/04 | M |
| PHONE-02 | PASS | ROAD SENSE non trattiene il microfono fuori da una sessione | NONE | nessuno | — | L |
| PHONE-03 | PLATFORM LIMITATION | Il browser non espone route audio | NONE | non verificabile da codice | DEVICE-02/04 | L |
| PHONE-04 | PARTIAL | Nessuna gestione esplicita; dipende dalla sospensione dell'OS | NONE | serve stato `AUDIO_INTERRUPTED` | PHONE-07 | M |
| PHONE-05 | PARTIAL | La sessione si chiude alla prima frase; nessun ascolto permanente | NONE | non dimostrato durante una chiamata reale | DEVICE-02 | M |
| PHONE-06 | PASS (vacuo) | Nessun recovery esiste | NONE | diventerà sostanziale con VOICE-LIFE-03 | PHONE-07 | H |
| PHONE-07 | **MISSING** | Zero occorrenze di stati di interruzione (BASE-08) | NONE | stato da introdurre | — | M |
| PHONE-08 | **MISSING** | `navigator.audioSession` mai usato | NONE | capability detection da aggiungere | PHONE-07 | L |
| PHONE-09 | **MISSING** | `visibilitychange` non è più usato dal provider vocale (solo dichiarato in `VoiceEnvironment`, non consumato) | NONE | codice morto da chiarire | PHONE-07 | L |
| PHONE-10 | **MISSING** | Nessuna macchina a stati | NONE | dipende da PHONE-07 | PHONE-07 | M |
| PHONE-11 | **MISSING** | Nessun recovery | NONE | dipende da VOICE-LIFE-03 | SELF-04 | H |
| PHONE-12 | **MISSING** | Assistenti non rilevati | NONE | rilevabilità limitata dalla piattaforma | PHONE-07 | L |

### H — ALERT DURANTE INTERRUZIONI

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| PHONE-ALERT-01 | **MISSING** | Nessun rilevamento di interruzione | NONE | il TTS parlerebbe comunque | PHONE-07 | M |
| PHONE-ALERT-02 | **MISSING** | Nessuna pending queue | NONE | dipende da VOICE-OUT-07 | VOICE-OUT-07 | H |
| PHONE-ALERT-03 | **MISSING** | Idem | NONE | — | VOICE-OUT-07 | H |
| PHONE-ALERT-04 | **MISSING** | Idem | NONE | — | VOICE-OUT-07 | H |
| PHONE-ALERT-05 | **MISSING** | Idem | NONE | — | ALERT-06/07 | H |
| PHONE-ALERT-06 | PASS (vacuo) | Senza coda non esiste raffica | NONE | da riverificare dopo VOICE-OUT-07 | VOICE-OUT-07 | H |

### I — EVENTSTORE

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| EVENT-01 | PASS | `RoadEvent.id`, `ts`, TTL per tipo | `EventStore.test.ts` | nessuno | — | L |
| EVENT-02 | PARTIAL | `type, lat/lon, source, ts, confidence` presenti | `validation.test.ts` | manca uno **stato** esplicito; la validità è implicita nel TTL | LIFE-02 | M |
| EVENT-03 | PARTIAL | `heading` presente; conferme via cluster | `ConfidenceEngine.test.ts` | segmento stradale assente | ROAD-02 | M |
| EVENT-04 | PASS | `STORAGE.maxEvents = 3000` + TTL in `compact()` | `EventStore.test.ts` | nessuno | — | L |
| EVENT-05 | **MISSING** | `App.tsx:1167` → `{clusters.length} EVENTI` | NONE | l'etichetta dichiara «EVENTI» ma mostra cluster (BASE-01) | EVENT-06 | L |
| EVENT-06 | **MISSING** | Nessuna distinzione in UI o modello | NONE | tre concetti collassati in uno | EVENT-05, DEBUG-04 | L |
| EVENT-07 | PARTIAL | Demo su chiave separata `roadsense.events.demo.v1` | `EventStore.test.ts` | i falsi positivi storici contaminano il conteggio operativo | TTL-09 | M |
| EVENT-08 | PARTIAL | Policy nei commenti di `EventStore.ts` e in `TTL_MS` | `EventStore.test.ts` | non esiste un documento di policy verificabile | TTL-08 | L |

### J — LIFECYCLE EVENTI

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| LIFE-01 | PASS | TTL applicato in `all()`, `add()`, `purge()`, `load()` | `EventStore.test.ts` | nessuno | — | L |
| LIFE-02 | PARTIAL | Solo NEW → ACTIVE → EXPIRED → CLEANED | `EventStore.test.ts` | mancano STALE e CONFIRMED come stati | EVENT-02 | M |
| LIFE-03 | **MISSING** | Nessun `lastConfirmedAt` | NONE | la conferma non aggiorna alcun timestamp | LIFE-05 | M |
| LIFE-04 | PASS | `buildClusters` → confidenza cresce col numero di segnalatori | `ConfidenceEngine.test.ts` | nessuno | — | L |
| LIFE-05 | **MISSING** | TTL calcolato da `e.ts`, mai esteso | `EventStore.test.ts` | conferma non prolunga la validità | LIFE-03 | M |
| LIFE-06 | PASS | `now - e.ts <= TTL_MS[e.type]`, nessun riferimento a mezzanotte | `EventStore.test.ts` | nessuno | — | L |

### K — TTL / DATA HYGIENE

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| TTL-01 | PASS | `TTL_MS` per tipo: da 15 min a 45 giorni | `EventStore.test.ts` | nessuno | — | L |
| TTL-02 | PARTIAL | `pothole: 45 giorni` (BASE-03) | NONE | il TTL non tiene conto di confidence o qualità del dato | TTL-10, CONF-03 | H |
| TTL-03 | PASS | `obstacle: 12 h` | `EventStore.test.ts` | nessuno | — | L |
| TTL-04 | PASS | `water: 4 h` | `EventStore.test.ts` | nessuno | — | L |
| TTL-05 | PASS | `accident: 2 h` | `EventStore.test.ts` | nessuno | — | L |
| TTL-06 | PASS | `roadworks: 7 giorni` | `EventStore.test.ts` | nessuno | — | L |
| TTL-07 | PASS | `NowcastWeatherProvider.isStale()` su `receivedAt` + `orizzonte_min` | `nowcast.test.ts` | nessuno | — | M |
| TTL-08 | PASS | `TTL_MS` centralizzato e commentato in `config.ts` | `EventStore.test.ts` | nessuno | — | L |
| TTL-09 | **MISSING** | Nessuna migrazione né versionamento dei dati | NONE | i falsi positivi storici restano operativi fino a metà novembre | EVENT-07 | H |
| TTL-10 | **MISSING** | TTL, confidence e riconferma progettati separatamente | NONE | serve progettazione congiunta | TTL-02, CONF-03, LIFE-05 | H |

### L — CLEANUP

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| CLEAN-01 | PASS | `buildClusters` filtra `isExpired` prima dell'AlertEngine | `ConfidenceEngine.test.ts` | nessuno | — | L |
| CLEAN-02 | PASS | La mappa disegna i cluster, già filtrati | `EventStore.test.ts` | nessuno | — | L |
| CLEAN-03 | PASS | `purge()` riscrive `localStorage` (BASE-02) | `EventStore.test.ts` | nessuno | — | L |
| CLEAN-04 | PASS | `purge()` e `compact()` agiscono su `this.events` poi `persist()` | `EventStore.test.ts` | nessuno | — | L |
| CLEAN-05 | PARTIAL | Gli expired non gonfiano il conteggio | `EventStore.test.ts` | il conteggio cresce per dati **non scaduti** ma sporchi | TTL-09 | M |
| CLEAN-06 | PASS | `load()` filtra per TTL al costruttore | `EventStore.test.ts` | nessuno | — | L |
| CLEAN-07 | PASS | `setInterval(..., 60_000)` in `App.tsx:477` | NONE | nessun test sul periodico | — | L |
| CLEAN-08 | PASS | `load()` esclude gli scaduti | `EventStore.test.ts` | nessuno | — | L |
| CLEAN-09 | PARTIAL | Mostra tutto il non scaduto | NONE | per le buche significa 45 giorni di storia | TTL-02 | M |

### M — DEDUP / CLUSTER / CONFIDENCE

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| DEDUP-01 | PARTIAL | `buildClusters` fonde entro `MERGE_RADIUS_M` | `ConfidenceEngine.test.ts` | restano 5 eventi grezzi; con raggio 20 m i cluster si moltiplicano (BASE-04) | SENSOR-06 | M |
| DEDUP-02 | PARTIAL | Considera hazard, posizione, tempo | `ConfidenceEngine.test.ts` | strada non considerata | ROAD-02 | M |
| DEDUP-03 | **MISSING** | Direzione non usata nel merge | NONE | `heading` esiste ma non entra nel criterio | ROAD-07 | M |
| DEDUP-04 | PARTIAL | Merge sì, conferma implicita via `reporters` | `ConfidenceEngine.test.ts` | nessun evento di conferma esplicito | LIFE-03 | M |
| DEDUP-05 | PASS | Fuori raggio o tipo diverso → nuovo gruppo | `ConfidenceEngine.test.ts` | nessuno | — | L |
| DEDUP-06 | PASS | `repeatReportWeight: 0.15`, `maxWeightPerReporter: 1.3` | `ConfidenceEngine.test.ts` | nessuno | — | M |
| CONF-01 | PASS | `CONFIDENCE` in `config.ts`, formula `1 - exp(-k·peso)` documentata | `ConfidenceEngine.test.ts` | nessuno | — | H |
| CONF-02 | PARTIAL | Influenza l'ammissione ad alert (`admitsAlert`) | `assessment.test.ts` | non influenza validità/TTL/cleanup | TTL-10 | M |
| CONF-03 | **MISSING** | Nessun decay né riconferma temporale | NONE | da progettare con TTL-10 | TTL-10 | H |

### N — ROAD AWARENESS

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| ROAD-01 | PARTIAL | `isRelevant()` usa distanza + cono angolare + heading del cluster | `AlertEngine.test.ts` | nessuna conoscenza della strada (BASE-09) | ROUTE-02 | H |
| ROAD-02 | PARTIAL | GPS, heading, speed disponibili | `AlertEngine.test.ts` | geometria, segmento, grafo, route: assenti | ROUTE-02 | H |
| ROAD-03 | PARTIAL | Alert se entro `lookahead` e nel cono | `AlertEngine.test.ts` | non è «stessa strada», è «stessa direzione» | ROAD-10 | H |
| ROAD-04 | **MISSING** | Nessun map matching | NONE | strada parallela può allertare (BASE-10) | ROUTE-02 | H |
| ROAD-05 | PASS | `angleDeltaDeg > maxBearingDeltaDeg` esclude ciò che è dietro | `AlertEngine.test.ts` | nessuno | — | M |
| ROAD-06 | PARTIAL | Il cooldown e il cono limitano la ripetizione | `AlertEngine.test.ts` | nessuno stato PASSED esplicito | ALERT-04/05 | M |
| ROAD-07 | PARTIAL | `cluster.heading !== null` → `maxHeadingMatchDeg` | `AlertEngine.test.ts` | inefficace quando `heading` è null | DEDUP-03 | M |
| ROAD-08 | **MISSING** | Nessuno stato di relevance modellato | NONE | serve enum esplicito | ROAD-10 | M |
| ROAD-09 | PARTIAL ⬆ | `allowsRoadRelevance()` è il punto unico della decisione: `heading` e `none` non diventano mai pertinenza, e il cancello è applicato alla voce meteo | `forwardCorridor.test.ts` «affermare la pertinenza stradale» (6 casi), `weather.test.ts` | il principio è applicato al **meteo**; `AlertEngine` (pericoli stradali) non lo consuma ancora | ROAD-08 | M |
| ROAD-10 | PARTIAL ⬆ | L'aggancio dichiara `source`, `status`, `confidence`, `roadEvidence`; nessuna precisione simulata quando i dati mancano | `forwardCorridor.test.ts` «H», «D» | non è map matching probabilistico: è un aggancio a raggio con verifica angolare | ROUTE-02 | H |

### O — FORWARD CORRIDOR / ROUTE

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| ROUTE-01 | PASS | Nessuna destinazione richiesta in nessun punto | `demoPipeline.test.ts` | nessuno | — | L |
| ROUTE-02 | PARTIAL ⬆ | `core/forwardCorridor.ts buildForwardCorridor()`; `App.tsx` costruisce il corridoio fuori demo | `forwardCorridor.test.ts` (25 casi) | il corridoio esiste sempre, ma la componente **road-geometry** dipende dai tile caricati e **non è mai stata verificata su dispositivo**: `querySourceFeatures` non è testabile in Node | DEVICE-06/08 | H |
| ROUTE-03 | **MISSING** | Nessuna sorgente di route reale (destinazione) esiste | NONE | invariato: la Fase 1 costruisce un corridoio, non una route | ROUTE-02 | H |
| ROUTE-04 | PARTIAL ⬆ | Il motore meteo riceve il corridoio anche fuori demo (`App.tsx`, ramo non-demo) | `forwardCorridor.test.ts`, `intersection.test.ts` | vale **solo per il meteo**: `AlertEngine` (pericoli stradali) usa ancora cerchio + cono, non toccato in questa fase | ALERT-02 | H |
| ROUTE-05 | **PASS** ⬆ | Due proseguimenti entro `CORRIDOR.forkAmbiguityDeg` → il corridoio si ferma al nodo e passa a `status: 'uncertain'` | `forwardCorridor.test.ts` «C. biforcazione» (2 casi) | nessuno | — | M |
| ROUTE-06 | **PASS** ⬆ | `CORRIDOR.secondsAhead` × velocità, limitata fra `minLengthM` e `maxLengthM`; policy centralizzata in `config.ts` | `forwardCorridor.test.ts` «lunghezza coerente» (3 casi) | nessuno | — | M |
| ROUTE-07 | PARTIAL ⬆ | `corridorRoute()` espone `pointAt(aheadM)`: distanza lungo il corridoio anche fuori demo | `forwardCorridor.test.ts` «adattamento al contratto RouteAhead» | è distanza lungo **strada** solo con `source: 'road-geometry'`; con `heading` è lungo una proiezione | ROUTE-02 | M |
| ROUTE-08 | PASS | Tutto il calcolo è locale, nessuna API esterna | `intersection.test.ts` | nessuno | — | L |

### P — WARNING DISTANCE / ETA

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| WARN-01 | PASS | `lookaheadMeters()` non è un raggio fisso | `AlertEngine.test.ts` | nessuno | — | L |
| WARN-02 | PARTIAL | Solo velocità (BASE-12) | `AlertEngine.test.ts` | ETA, hazard, severity, confidence, contesto: non considerati | ROUTE-02 | M |
| WARN-03 | PASS | `v × ALERT.lookaheadSec` con min/max | `AlertEngine.test.ts` | nessuno | — | L |
| WARN-04 | PASS | A 50 km/h ≈ 195 m | `AlertEngine.test.ts` | nessuno | — | L |
| WARN-05 | PARTIAL | A 130 km/h ≈ 500 m, limitato da `maxLookaheadM` | `AlertEngine.test.ts` | non arriva all'anticipo chilometrico | WARN-06 | M |
| WARN-06 | **MISSING** | Tetto a `maxLookaheadM` | NONE | nessun anticipo esteso per rischi specifici | WARN-02 | M |
| WARN-07 | PASS | ETA calcolato solo con `route` reale; altrimenti nullo | `intersection.test.ts` | nessuno | — | L |

### Q — ALERT ENGINE

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| ALERT-01 | PARTIAL | `AlertEngine.evaluate()` + `WeatherAlertEngine.evaluate()` separati | `AlertEngine.test.ts` | due motori, arbitration grossolana (BASE-13) | ALERT-09 | H |
| ALERT-02 | PARTIAL | Presenti VALIDITY, CONFIDENCE, DISTANCE, COOLDOWN, VOICE, MAP | `AlertEngine.test.ts` | mancano ROAD RELEVANCE, PRIORITY, QUEUE | ROUTE-02, VOICE-OUT-07 | H |
| ALERT-03 | PASS | `ALERT.cooldownMs = 120 s` per cluster | `AlertEngine.test.ts` | nessuno | — | M |
| ALERT-04 | **MISSING** | Nessuna fase modellata | NONE | esistono solo bande meteo (`WEATHER.bandsM`) | ROAD-08 | M |
| ALERT-05 | PARTIAL | Cono + cooldown limitano la ripetizione | `AlertEngine.test.ts` | nessuno stato PASSED | ALERT-04 | M |
| ALERT-06 | **MISSING** | Nessuna coda | NONE | — | VOICE-OUT-07 | H |
| ALERT-07 | **MISSING** | Nessuna coda | NONE | — | VOICE-OUT-07 | H |
| ALERT-08 | **MISSING** | Nessuna priorità per urgenza | NONE | — | ALERT-01 | H |
| ALERT-09 | **MISSING** | `App.tsx:616` → `if (roadAlertRef.current !== null) return;` — precedenza fissa e cieca | NONE | esattamente ciò che il requisito vieta | ALERT-01 | H |

### R — COOPERAZIONE FRA VEICOLI

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| REMOTE-01 | **MISSING** | Nessuna cooperazione attiva (BASE-14) | NONE | backend non attivato | NET-04 | M |
| REMOTE-02 | PASS | `report()` e `DetectionEngine` creano eventi; `postEvents([event])` invocata | `demoPipeline.test.ts` | nessuno | — | L |
| REMOTE-03 | BACKEND REQUIRED | `net/api.ts postEvents()` pronta, `backendEnabled()` falso | NONE | `API.base` vuoto | NET-04 | M |
| REMOTE-04 | BACKEND REQUIRED | `fetchNearby()` pronta | NONE | Worker/D1 mai deployati | NET-04 | M |
| REMOTE-05 | PARTIAL | `validateEvent()` su ogni payload in ingresso | `validation.test.ts` | manca la verifica «strada» | ROUTE-02 | M |
| REMOTE-06 | BACKEND REQUIRED | `store.add()` → cluster → mappa | `EventStore.test.ts` | nulla arriva | NET-04 | M |
| REMOTE-07 | BACKEND REQUIRED | `announce()` sui cluster | `speech.test.ts` | nulla arriva | NET-04 | M |
| REMOTE-08 | BACKEND REQUIRED | Principio già rispettato nel disegno: mappa e voce condividono lo stesso cluster | `speech.test.ts` | non dimostrabile senza backend | NET-04 | L |
| REMOTE-09 | **MISSING** | Nessun map matching | NONE | strada parallela non distinguibile | ROAD-04 | H |
| REMOTE-10 | PASS | `isRelevant()` esclude ciò che è dietro | `AlertEngine.test.ts` | nessuno | — | M |
| REMOTE-11 | PASS | `add()` rifiuta gli scaduti; `all()` li filtra | `EventStore.test.ts` | nessuno | — | L |
| REMOTE-12 | PASS | Nessuna simulazione presentata come rete reale; `backendEnabled()` dichiara lo stato | `degradation.test.ts` | nessuno | — | L |

### S — NETWORK / BACKEND

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| NET-01 | PASS | Indicatore RETE: `online` / `local` / `offline` da `backendEnabled()` | `degradation.test.ts` | nessuno | — | L |
| NET-02 | PASS | `API.base` vuoto → `local`, multi-device non disponibile | `degradation.test.ts` | nessuno | — | L |
| NET-03 | PASS | `worker/src/index.ts` e `worker/wrangler.toml` esistono e sono da riusare | NONE | `database_id` da compilare | NET-04 | L |
| NET-04 | PASS | Nessun backend attivato; `database_id: DA_COMPILARE_...` | NONE | nessuno | — | L |
| NET-05 | PARTIAL | `validateEvent` ricostruisce l'oggetto per campi, `rawTranscript` escluso | `validation.test.ts` | nessuna misura del payload | PRIV-05 | L |
| NET-06 | **MISSING** | Nessuna protezione spam/flood/replay | NONE | da progettare prima dell'attivazione | NET-04 | M |
| NET-07 | **MISSING** | Nessuna strategia di riconnessione | NONE | — | OFF-05 | M |
| NET-08 | **MISSING** | Zero-cost non verificato per Worker/D1 | NONE | — | COST-03 | L |

### T — NOWCAST: CONTRATTO CONGELATO

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| NOW-01 | PASS | Nessuna modifica a NOWCAST in tutta la storia del repository | `weather.test.ts` «indipendenza» | nessuno | — | L |
| NOW-02 | PASS | Solo `GET`; nessun metodo di scrittura | `nowcast.test.ts` | nessuno | — | L |
| NOW-03 | PASS | `WEATHER.nowcast.url` = endpoint esatto | `nowcast.test.ts` «privacy URL» | nessuno | — | L |
| NOW-04 | PASS | Nessun parametro, nessun corpo (BASE-17) | `nowcast.test.ts` | nessuno | — | H |
| NOW-05 | PASS | Idem | `nowcast.test.ts` | nessuno | — | H |
| NOW-06 | PASS | `HAZARD = { grandine: 'hail', downburst: 'downburst' }` | `nowcast.test.ts` | nessuno | — | L |
| NOW-07 | PASS | `kind === undefined → return null` | `nowcast.test.ts` «pericolo non tradotto» | nessuno | — | L |
| NOW-08 | PASS | `dati_fermi === true → discard()` | `nowcast.test.ts` | nessuno | — | L |
| NOW-09 | PASS | `isStale()` su `receivedAt` + `horizonMs` | `nowcast.test.ts` «freschezza» | nessuno | — | M |
| NOW-10 | PASS | `receivedAt` aggiornato **solo** se `frame_time` cambia | `nowcast.test.ts` «stesso frame non ringiovanisce» | nessuno | — | M |

### U — NOWCAST POLLING

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| NOW-POLL-01 | PASS | `giro()` invocata subito all'attivazione dell'effetto | `nowcast.test.ts` | nessuno | — | L |
| NOW-POLL-02 | PASS | `WEATHER.nowcast.pollMs = 300_000` | `nowcast.test.ts` «attesa fra due richieste» | nessuno | — | L |
| NOW-POLL-03 | PASS | `jitterMs = 30_000`, applicato ±  | `nowcast.test.ts` | nessuno | — | L |
| NOW-POLL-04 | PASS | `if (this.inFlight) return;` | `nowcast.test.ts` «una sola richiesta in volo» | nessuno | — | L |
| NOW-POLL-05 | PASS | Effetto su `[demo, running]`; cleanup `clearTimeout` + `reset()` | NONE | nessun test sul cleanup | CORE-02 | M |
| NOW-POLL-06 | PASS | `navigator.onLine !== false` prima di ogni giro | NONE | nessun test dedicato | — | L |
| NOW-POLL-07 | PASS | `backoffMs = [300_000, 600_000, 1_200_000]` | `nowcast.test.ts` «l'attesa cresce» | nessuno | — | L |
| NOW-POLL-08 | PASS | Nessun retry immediato; solo il timer successivo | `nowcast.test.ts` | nessuno | — | L |

### V — NOWCAST + STRADA

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| NOW-ROAD-01 | PASS | `cellCentreAt`/`cellRadiusAt` interpolano sul `cone` | `intersection.test.ts` «traiettoria dal cono» | nessuno | — | H |
| NOW-ROAD-02 | PASS | Nessuna ricostruzione: il test verifica che la deriva **non** venga usata quando c'è il cono | `intersection.test.ts` | nessuno | — | H |
| NOW-ROAD-03 | PASS | `announce: true` sempre; ROAD SENSE non rivaluta la decisione meteo | `nowcast.test.ts` | nessuno | — | M |
| NOW-ROAD-04 | PARTIAL ⬆ | Il cono NOWCAST viene ora intersecato con il corridoio anche fuori demo | `forwardCorridor.test.ts`, `intersection.test.ts` | l'intersezione avviene, ma contro un corridoio che può essere `heading` (nessuna evidenza stradale) e limitato al viewport | ROUTE-02 | H |
| NOW-ROAD-05 | PARTIAL | Senza route restituisce `NO_INTERSECTION` | `intersection.test.ts` | «non pertinente» per assenza di dati, non per valutazione | ROUTE-02 | M |
| NOW-ROAD-06 | PARTIAL ⬆ | Un fenomeno fuori dal corridoio non produce intersezione; con corridoio `heading` non viene comunque annunciato a voce | `intersection.test.ts`, `forwardCorridor.test.ts` | con `heading` il fenomeno resta visibile su mappa/banner: la distinzione «vicino ma non sul percorso» non è ancora dimostrabile senza geometria | ROUTE-02 | M |

### W — NOWCAST FLOW

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| NOW-FLOW-01 | PARTIAL | Endpoint→provider→validation→freshness→dati_fermi→mapping→cone: **PASS**; intersection→ETA→priority→queue: **MISSING** | `nowcast.test.ts` | tre stadi mancanti | ROUTE-02, VOICE-OUT-07 | H |
| NOW-FLOW-02 | PASS | `weatherAlertPhrase()` cablata su `announce()` | `speech.test.ts` | nessuno | — | M |
| NOW-FLOW-03 | PARTIAL | Può generare voce solo per «nell'area attuale» | `speech.test.ts` | «sul percorso» irraggiungibile | ROUTE-02 | H |
| NOW-FLOW-04 | PARTIAL ⬆ | Con il corridoio l'ETA è calcolabile fuori demo; la frase «sul percorso» è pronunciata **solo** con `roadEvidence` (`App.tsx`, `puoDireSulPercorso`) | `forwardCorridor.test.ts` «affermare la pertinenza stradale», `weather.test.ts` «pertinenza stradale e voce meteo» | resta PARTIAL: con corridoio `heading` non si annuncia, quindi il requisito è soddisfatto solo dove la mappa fornisce geometria | NOW-FLOW-07, ALERT-09 | M |
| NOW-FLOW-05 | PASS | `displayEtaSec === null → nessun tempo nella frase` | `speech.test.ts` | nessuno | — | L |
| NOW-FLOW-06 | PARTIAL | `weatherAlertPhrase` produce «Possibile downburst sul percorso» | `speech.test.ts` | ma solo se l'intersezione esiste | ROUTE-02 | M |
| NOW-FLOW-07 | PASS | Nessun ETA inventato | `intersection.test.ts` | nessuno | — | L |

### X — NOWCAST DURANTE INTERRUZIONI

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| NOW-PHONE-01 | **MISSING** | Nessun rilevamento di interruzione | NONE | — | PHONE-07 | M |
| NOW-PHONE-02 | **MISSING** | Nessuna pending queue | NONE | — | VOICE-OUT-07 | H |
| NOW-PHONE-03 | **MISSING** | Idem | NONE | — | VOICE-OUT-07 | H |
| NOW-PHONE-04 | **MISSING** | Idem | NONE | — | VOICE-OUT-07 | H |
| NOW-PHONE-05 | **MISSING** | Idem | NONE | — | ALERT-07 | H |

### Y — OFFLINE

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| OFF-01 | PARTIAL | GPS, sensori, detection, EventStore, TTS locali (BASE-18) | `degradation.test.ts` | road-awareness locale non esiste | ROUTE-02 | M |
| OFF-02 | PASS | `fetchNearby` fallisce silenziosamente | `degradation.test.ts` | nessuno | — | L |
| OFF-03 | PASS | Polling saltato se `navigator.onLine === false` | NONE | nessun test dedicato | — | L |
| OFF-04 | PASS | `isStale()` scarta i dati oltre l'orizzonte | `nowcast.test.ts` | nessuno | — | M |
| OFF-05 | **MISSING** | Nessuna gestione del rientro online | NONE | rischio flood al ritorno | NET-07 | M |
| OFF-06 | PASS | README dichiara il riconoscimento remoto; nessuna promessa offline | `weather.test.ts` | nessuno | — | L |

### Z — BACKGROUND / LIFECYCLE PWA

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| BG-01 | DEVICE TEST | Nessuna verifica separata Android/iOS eseguita | NONE | richiede due dispositivi | DEVICE-01/03 | L |
| BG-02 | DEVICE TEST | Nessuna matrice di stati testata | NONE | — | DEVICE-01/02/03 | L |
| BG-03 | PASS | README: «App in secondo piano ❌» dichiarato | NONE | nessuno | — | L |
| BG-04 | PASS | Testo introduttivo: «Durante il test lascia ROAD SENSE aperto e lo schermo acceso» | NONE | nessuno | — | L |
| BG-05 | PASS | `wakeLockController.ts` documenta il limite; README lo ribadisce | `wakeLock.test.ts` | nessuno | — | L |

### AA — PWA / SERVICE WORKER

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| PWA-01 | PASS | `public/manifest.webmanifest` completo, icone generate | NONE | installabilità non verificata su dispositivo | DEVICE-01 | L |
| PWA-02 | PASS | `public/sw.js` scritto a mano, registrato in `main.tsx` | NONE | nessun test | — | M |
| PWA-03 | PASS | `SHELL_CACHE`/`ASSET_CACHE` versionate; network-first per navigazioni | NONE | nessun test | — | M |
| PWA-04 | PARTIAL | `skipWaiting` su messaggio + barra AGGIORNA (`usePwaUpdate`) | NONE | senza interazione il tester resta su codice vecchio | — | M |
| PWA-05 | PARTIAL | Fallback offline a `/index.html` o risposta 503 | NONE | `navigationStrategy` riscrive `/index.html` con **qualunque** navigazione: dopo aver visitato `/voice-test` la copia offline è quella pagina | — | M |
| PWA-06 | PASS | CSP e Permissions-Policy verificate in produzione (header reali) | NONE | nessuno | — | H |
| PWA-07 | PARTIAL | `APP.version` in `StatusBar`; `__APP_VERSION__` da build | NONE | versione mostrata, ma non build/commit | DEBUG-02 | L |

### AB — PRIVACY / SECURITY

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| PRIV-01 | PASS | Nessun `MediaRecorder`, nessun buffer audio in tutto il repository | `voiceChain.test.ts` | nessuno | — | H |
| PRIV-02 | PASS | `report()` non trasporta `rawTranscript`; `validateEvent` lo esclude esplicitamente in ingresso | `validation.test.ts` | nessuno | — | H |
| PRIV-03 | PASS | `VoiceProvider.ts` documenta l'elaborazione remota; consenso a due tocchi | `voiceChain.test.ts` «consenso» | nessuno | — | H |
| PRIV-04 | PASS | Nessun parametro verso NOWCAST | `nowcast.test.ts` | nessuno | — | H |
| PRIV-05 | PARTIAL | `validateEvent` ricostruisce per campi | `validation.test.ts` | minimizzazione non quantificata | NET-05 | M |
| PRIV-06 | PASS | Nessun login in tutto il codice | NONE | nessuno | — | L |
| PRIV-07 | PASS | Nessun analytics; `anonId` locale e non trasmesso a NOWCAST | `anonId.test.ts` | nessuno | — | M |
| PRIV-08 | PASS | `fetchNearby` → `validateEvent(raw, ...)` su ogni elemento | `validation.test.ts` | nessuno | — | H |
| PRIV-09 | PASS | Nessun secret nel client; `.env.example` non contiene valori | NONE | nessuno | — | H |

### AC — COSTI

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| COST-01 | PASS | OpenFreeMap, Web Speech API, NOWCAST proprio: tutte gratuite senza chiave | `weather.test.ts` | nessuno | — | L |
| COST-02 | PASS | Nessun servizio a pagamento per voce, routing, meteo, sync | NONE | nessuno | — | L |
| COST-03 | PARTIAL | Worker/D1 previsti nel piano gratuito, mai attivati | NONE | verifica formale non eseguita | NET-08 | L |

### AD — DEBUG / OSSERVABILITÀ

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| DEBUG-01 | PASS | Interfaccia normale con soli chip di stato; pannelli solo dietro parametro | `voiceSession.test.ts` | nessuno | — | L |
| DEBUG-02 | PARTIAL | `?debugVoice=1`: API, microfono, fase, locale/remoto, EVENTI, errore, ultima frase. `?sensorDebug=1`: velocità, accelerazioni, picco, rumore, giroscopio, stabilità, motivo scarto, eventi | `voiceSession.test.ts`, `micPermission.test.ts` | mancano: TTS, interruzione audio, heading, segmento, map-match confidence, road relevance, distanza/ETA, coda alert e motivo scarto, EventStore raw/cluster/active/expired, cleanup, NOWCAST fetch/freshness/cone/intersection | EVENT-06, ROAD-08 | L |
| DEBUG-03 | PASS | Diagnostica solo in memoria, `pushDiagnostics` no-op fuori dal debug | `micPermission.test.ts` | nessuno | — | M |
| DEBUG-04 | **MISSING** | Un solo contatore, etichettato «EVENTI» | NONE | non distingue grezzi/cluster/attivi | EVENT-05/06 | L |

### AE — TEST AUTOMATICI

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| TEST-VOICE-01 | **MISSING** | Nessun test hands-free/multi-command | NONE | la funzione non esiste | VOICE-IN-01/04 | H |
| TEST-VOICE-02 | PARTIAL | Duplicate, no-speech, error, STOP coperti | `voiceSession.test.ts` (24 casi) | interim e recovery non coperti | VOICE-LIFE-03 | M |
| TEST-VOICE-03 | PASS | «nel codice non esiste alcuna riapertura programmata» + avanzamento di 10 min | `voiceSession.test.ts` | nessuno | — | H |
| TEST-VOICE-04 | PARTIAL | TTS e self-listening coperti | `ducking.test.ts` (9 casi) | recovery post-TTS non testabile: non esiste | SELF-04 | M |
| TEST-EVENT-01 | PARTIAL | TTL, expiry, dedup, confidence coperti | `EventStore.test.ts`, `ConfidenceEngine.test.ts` | confirmation non modellata | LIFE-03 | M |
| TEST-CLEAN-01 | PARTIAL | Expired → no alert → no map → no storage → no reload | `EventStore.test.ts` | catena completa non in un unico test | — | M |
| TEST-ROAD-01 | PARTIAL | Copre distanza + cono | `AlertEngine.test.ts` | non «stessa strada» | ROUTE-02 | H |
| TEST-ROAD-02 | PASS | Evento dietro escluso | `AlertEngine.test.ts` | nessuno | — | M |
| TEST-ROAD-03 | **MISSING** | Nessun test su strada parallela | NONE | il caso oggi fallirebbe | ROAD-04 | H |
| TEST-ROAD-04 | PARTIAL | `maxHeadingMatchDeg` testato | `AlertEngine.test.ts` | solo con heading noto | ROAD-07 | M |
| TEST-ROAD-05 | **MISSING** | Nessun concetto di UNKNOWN | NONE | — | ROAD-09 | H |
| TEST-WARN-01 | PARTIAL | `lookaheadMeters` testata su più velocità | `AlertEngine.test.ts` | non la matrice 0/30/50/90/130 | WARN-02 | M |
| TEST-REMOTE-01 | **MISSING** | Nessun test end-to-end evento remoto | NONE | richiede backend | NET-04 | M |
| TEST-PHONE-01 | **MISSING** | Nessun test su interruzioni | NONE | la funzione non esiste | PHONE-07 | M |
| TEST-NOW-01 | PASS | Empty, hail, downburst, stale, dati_fermi, same-frame: tutti coperti | `nowcast.test.ts` (33 casi) | nessuno | — | M |
| TEST-NOW-02 | PARTIAL | Cone, ETA, offline, backoff, TTS coperti | `nowcast.test.ts`, `intersection.test.ts` | intersect/miss reali e priority non coperti | ROUTE-02 | H |
| TEST-LIFE-01 | **MISSING** | Nessun test START/STOP ripetuti | NONE | — | CORE-03 | M |
| TEST-PERF-01 | **MISSING** | Nessun test di volume | NONE | `buildClusters` O(n²) non misurato (BASE-20) | — | M |

### AF — TEST REALI SU DISPOSITIVO

| ID | STATO | EVIDENZA | TEST | GAP | DIP | REG |
|---|---|---|---|---|---|---|
| DEVICE-01 | DEVICE TEST | Fold: tono ripetuto risolto; multi-command non disponibile | — | VOICE-IN-01/04 bloccano lo scenario | VOICE-IN-* | H |
| DEVICE-02 | DEVICE TEST | Nessuna gestione telefonate | — | PHONE-* | PHONE-* | M |
| DEVICE-03 | DEVICE TEST | iPhone: voce funzionante, multi-command no | — | VOICE-IN-04 | VOICE-IN-* | M |
| DEVICE-04 | DEVICE TEST | CarPlay mai testato | — | PHONE-03 | PHONE-* | L |
| DEVICE-05 | BACKEND REQUIRED | Backend non attivato | — | NET-04 | NET-04 | M |
| DEVICE-06 | DEVICE TEST | Strada parallela: oggi fallirebbe | — | ROAD-04 | ROUTE-02 | H |
| DEVICE-07 | DEVICE TEST | Cleanup verificato solo da test unitari | — | conferma sul dispositivo mancante | — | L |
| DEVICE-08 | DEVICE TEST | NOWCAST interrogato davvero; intersezione stradale assente | — | NOW-ROAD-04 | ROUTE-02 | H |

### AI — KNOWN BASELINE R1 (fatti accertati, non requisiti)

Stato `PASS` = fatto confermato dal codice all'HEAD analizzato.

| ID | STATO | CONFERMA |
|---|---|---|
| BASE-01 | PASS | `App.tsx:1167` → `{clusters.length} EVENTI` |
| BASE-02 | PASS | `EventStore` su `localStorage`; `purge()` ogni 60 s riscrive lo storage |
| BASE-03 | PASS | `TTL_MS.pothole = 45 * DAY`, `rough = 30 * DAY` |
| BASE-04 | PASS | `buildClusters` fonde entro `MERGE_RADIUS_M.pothole = 20 m` |
| BASE-05 | PASS | `continuous = false`, `closeSession` alla prima frase |
| BASE-06 | PASS | Zero `scheduleNext/restart`; un solo `this.env.setTimeout` |
| BASE-07 | PASS | `pause()` → `closeSession()`; `resume()` no-op |
| BASE-08 | PASS | Zero occorrenze di `audioSession/interrupted/pagehide/blur` |
| BASE-09 | PASS | Nessun grafo/map matching/routing fuori da `src/demo/` |
| BASE-10 | PASS | `isRelevant()` non distingue strade |
| BASE-11 | PASS | `App.tsx:573` → `demoRef.current ? routeAheadFrom(...) : null` |
| BASE-12 | PASS | `lookaheadMeters()` dipende solo dalla velocità |
| BASE-13 | PASS | `App.tsx:616` → `if (roadAlertRef.current !== null) return;` |
| BASE-14 | PASS | `API.base` vuoto; `database_id` non compilato |
| BASE-15 | PASS | Endpoint verificato in produzione: `HTTP 200`, CORS corretto |
| BASE-16 | PASS | `forecastIntersection(cell, driver, null)` fuori demo |
| BASE-17 | PASS | Nessun GPS/route/ID/cookie verso NOWCAST |
| BASE-18 | PASS | Offline: locale sì, mappa/voce/remoto/NOWCAST no |
| BASE-19 | PASS | 548 test / 26 file; zero device-dependent; mock idealizzati |
| BASE-20 | PASS | `buildClusters` O(n²) con centroide ricalcolato |
| BASE-21 | PASS | HEAD `5f8ecbb8…`, working tree pulito durante l'audit |

### AJ — TRACEABILITY E CHANGE CONTROL

| ID | STATO | EVIDENZA | GAP |
|---|---|---|---|
| TRACE-01 | PASS | Questo documento copre 300/300 ID | nessuno |
| TRACE-02 | PASS | Ogni riga riporta stato, evidenza, test, gap, dipendenze, rischio | «risultato dopo implementazione» sarà compilato nei cicli successivi |
| TRACE-03 | PASS | Nessun ID non dimostrato è marcato PASS; dove la prova manca lo stato è PARTIAL, MISSING o DEVICE TEST | nessuno |
| TRACE-04 | PASS | Demo e mock mai usati come prova: ROUTE-02, NOW-ROAD-04, REMOTE-04, DEVICE-* lo riflettono | nessuno |
| TRACE-05 | PASS | La sezione 7 indica gli ID per fase | vincolante per i cicli futuri |
| TRACE-06 | PASS | La sezione 6 elenca i PASS a rischio per ogni area | da eseguire prima di ogni commit |
| CHANGE-01 | PASS | R1 trattata come congelata; nessun requisito riscritto | nessuno |
| CHANGE-02 | PASS | Nessun nuovo requisito introdotto da questo documento | nessuno |
| CHANGE-03 | PASS | Nessun cambio semantico applicato | nessuno |
| CHANGE-04 | PASS | Nessun ID riutilizzato | nessuno |
| CHANGE-05 | PASS | Le scoperte stanno qui e in AI, non nella Master | nessuno |

---

## 3. BETA GATES

| GATE | STATO | EVIDENZA / BLOCCANTE |
|---|---|---|
| BETA-01 | **MISSING** | VOICE-IN-01: una sessione per tocco |
| BETA-02 | **MISSING** | VOICE-IN-04: nessun multi-command |
| BETA-03 | **PASS** | VOICE-LIFE-01/02 dimostrati da test |
| BETA-04 | PARTIAL | SELF-01/02/03 PASS; SELF-04/05 MISSING |
| BETA-05 | BACKEND REQUIRED | REMOTE-04/06/07: `API.base` vuoto |
| BETA-06 | **MISSING** | ROAD-04: nessun map matching |
| BETA-07 | PARTIAL | WARN-03 PASS; WARN-02/06 PARTIAL/MISSING |
| BETA-08 | PARTIAL | TTL-01/08 PASS; TTL-09/10, CONF-03 MISSING |
| BETA-09 | **PASS** | CLEAN-01/02 dimostrati |
| BETA-10 | **PASS** | CLEAN-03/04 dimostrati |
| BETA-11 | PARTIAL | EVENT-05/06 MISSING; TTL-09 MISSING |
| BETA-12 | PLATFORM LIMITATION | PHONE-01/03: nessuna evidenza di codice |
| BETA-13 | PLATFORM LIMITATION | PHONE-03: il browser non espone il route audio |
| BETA-14 | **MISSING** | PHONE-11, SELF-04 |
| BETA-15 | PARTIAL | NOW-FLOW-03: solo «nell'area attuale» |
| BETA-16 | PARTIAL | NOW-ROAD-05: silenzio per assenza di dati, non per valutazione |
| BETA-17 | PARTIAL | OFF-01 PARTIAL; OFF-05 MISSING |
| BETA-18 | PARTIAL | CORE-03 PASS nel codice; TEST-LIFE-01 MISSING |
| BETA-19 | **PASS** | NET-01/02, REMOTE-12: stato dichiarato senza simulazioni |
| BETA-20 | **PASS** | NOW-01: nessuna modifica a NOWCAST |
| BETA-21 | **MISSING** | ROAD-04, ROUTE-02 |
| BETA-22 | **MISSING** | ROUTE-02 |

**Gate superati: 5 su 22.**

---

## 4. ACCEPTANCE SCENARIO (AH)

| # | Punto | ESITO | Motivo |
|---|---|---|---|
| 1 | Preme START | **PASS** | `start()` avvia sensori, GPS, alert, polling |
| 2 | Mette via il telefono | **PARTIAL** | funziona per il rilevamento; non per la voce |
| 3 | Dice «Buca» | **FAIL** | serve un tocco su VOCE prima di parlare |
| 4 | Evento registrato/consolidato | **PASS** | `report(hazardFamily(...), 'voice')` → EventStore → cluster |
| 5 | Continua ad ascoltare senza touch | **FAIL** | `resume()` è un no-op dichiarato |
| 6 | Altro veicolo riceve l'evento | **NOT TESTABLE YET** | backend non attivato |
| 7 | Determina davanti/strada pertinente/valido | **PARTIAL** | «valido» e «davanti» sì; «strada pertinente» no |
| 8 | Vede e sente «Buca tra 150 metri» | **NOT TESTABLE YET** | la frase esiste; l'evento remoto no |
| 9 | Strada parallela non riceve l'avviso | **FAIL** | senza map matching può riceverlo |
| 10 | Hazard vecchi scadono e vengono rimossi | **PASS** | TTL + `purge()` + `load()` dimostrati |
| 11 | NOWCAST scaricato senza posizione/route | **PASS** | verificato sull'endpoint reale |
| 12 | Confronto locale cone ↔ percorso | **FAIL** | il corridoio non esiste fuori demo |
| 13 | Pertinente → mappa + voce; non pertinente → silenzio | **PARTIAL** | mappa sì; voce solo «area attuale» |
| 14 | Telefonata: cede priorità, non parla, non interpreta | **NOT TESTABLE YET** | nessuna gestione nel codice |
| 15 | Rivaluta e recupera a fine interruzione | **FAIL** | nessuna coda, nessun recovery |
| 16 | STOP arresta correttamente | **PASS** | cleanup verificati |

**PASS 5 · PARTIAL 4 · FAIL 5 · NOT TESTABLE YET 3**

---

## 5. DEPENDENCY MAP

Costruita esclusivamente dai gap rilevati.

```
ROUTE-02  forward corridor reale (segmento + heading + continuità)
   │
   ├─► ROAD-01..04, ROAD-06, ROAD-08..10     road awareness reale
   │        └─► BETA-06, BETA-21, DEVICE-06, TEST-ROAD-03/05
   │
   ├─► ROUTE-03..07                          route e distanza lungo strada
   │        └─► BETA-22
   │
   ├─► NOW-ROAD-04..06                       cone ∩ corridoio
   │        └─► NOW-FLOW-01/03/04/06 ─► BETA-15, BETA-16, DEVICE-08
   │
   ├─► WARN-02/05/06                         warning distance road/hazard-aware
   │        └─► BETA-07
   │
   └─► REMOTE-05/09                          pertinenza degli eventi remoti
            └─► BETA-05 (con NET-04)

VOICE-LIFE-03  recovery controllato con backoff
   │
   ├─► VOICE-IN-01/03/04   hands-free e multi-command
   │        └─► BETA-01, BETA-02, DEVICE-01, TEST-VOICE-01
   │
   ├─► SELF-04/05          recovery post-TTS
   │        └─► BETA-04
   │
   ├─► VOICE-LIFE-04       circuit breaker
   │
   └─► PHONE-11            recovery post-chiamata
            └─► BETA-14

VOICE-OUT-07  pending queue con rivalutazione
   │
   ├─► ALERT-06/07/08      scarto off-route/expired, priorità
   │
   ├─► ALERT-09 + ALERT-01/02   arbitration comune strada/meteo
   │
   ├─► PHONE-ALERT-02..06
   │
   └─► NOW-PHONE-02..05

PHONE-07  stato AUDIO_INTERRUPTED
   │
   ├─► PHONE-04/10/12, NOW-PHONE-01, PHONE-ALERT-01
   │        └─► BETA-12, BETA-13, DEVICE-02, DEVICE-04, TEST-PHONE-01
   │
   └─► VOICE-LIFE-06 (da vacuo a sostanziale)

NET-04  autorizzazione backend
   │
   └─► REMOTE-03/04/06/07/08, VOICE-OUT-03, DEVICE-05, TEST-REMOTE-01
            └─► BETA-05, BETA-19 (già PASS, da riconfermare)

TTL-10  TTL + confidence + riconferma progettati insieme
   │
   ├─► TTL-02, TTL-09, CONF-03, LIFE-03/05
   │        └─► BETA-08, BETA-11
   │
   └─► EVENT-05/06, DEBUG-04   (indipendenti, costo basso)
```

**Radice unica e dominante: `ROUTE-02`.** Da sola blocca 24 ID e 5 Beta Gate.

---

## 6. REGRESSION MAP

| Area da modificare | Moduli toccati | PASS a rischio | Test da eseguire prima/insieme |
|---|---|---|---|
| Forward corridor (ROUTE-02) | `AlertEngine.ts`, `intersection.ts`, `App.tsx` | ROAD-05, ALERT-03, WARN-01/03/04, NOW-ROAD-01/02, NOW-FLOW-05/07, WARN-07 | `AlertEngine.test.ts`, `intersection.test.ts`, `weather.test.ts`, `animation.test.ts` |
| Recovery vocale (VOICE-LIFE-03) | `BrowserVoiceProvider.ts`, `App.tsx` | **VOICE-LIFE-01/02** (rischio massimo: ritorno del «bis»), SELF-01/03, VOICE-IN-06, CORE-02 | `voiceSession.test.ts` (24 casi), `ducking.test.ts`, `voiceChain.test.ts` |
| Pending queue (VOICE-OUT-07) | `AlertEngine.ts`, `AlertSpeechEngine.ts`, `App.tsx` | VOICE-OUT-06, ALERT-03, SELF-01/02 | `speech.test.ts`, `ducking.test.ts`, `AlertEngine.test.ts` |
| Stato interruzione (PHONE-07) | `App.tsx`, `BrowserVoiceProvider.ts` | SELF-01, VOICE-LIFE-05, CORE-02 | `voiceSession.test.ts`, `wakeLock.test.ts` |
| TTL/confidence (TTL-10) | `config.ts`, `EventStore.ts`, `ConfidenceEngine.ts` | **CONF-01** (formula collaudata, già oggetto di una correzione), TTL-01..08, CLEAN-01..08, LIFE-01/04/06 | `ConfidenceEngine.test.ts`, `EventStore.test.ts`, `assessment.test.ts` |
| Contatore/UI (EVENT-05/06) | `App.tsx`, `StatusBar.tsx` | DEBUG-01, DEBUG-03 | `sensorStatus.test.ts` |
| Backend (NET-04) | `net/api.ts`, `worker/` | NET-01/02, PRIV-05/08, REMOTE-11/12 | `validation.test.ts`, `degradation.test.ts` |

> **Avvertenza specifica.** `ConfidenceEngine.ts` è rimasto invariato attraverso tutte le
> modifiche recenti e un test asserisce esplicitamente che la formula non cambi. Qualunque
> intervento su TTL-10 deve motivare per iscritto ogni variazione, come richiesto in
> passato dal committente.

---

## 7. IMPLEMENTATION PHASES (proposta, non eseguita)

### Fase 1 — Forward corridor e road awareness
**Obiettivo:** dare a ROAD SENSE la nozione di «strada davanti» fuori dalla demo.
**ID:** ROUTE-02/03/04/05/07, ROAD-01/02/03/04/06/08/09/10, WARN-02/05/06, BETA-06, BETA-21, BETA-22.
**Prerequisiti:** nessuno. È la radice.
**Test:** TEST-ROAD-01/03/04/05, TEST-WARN-01, regressione completa su `AlertEngine` e `intersection`.
**NON modificare:** `ConfidenceEngine`, `EventStore`, `DetectionEngine`, soglie sensori, NOWCAST, `BrowserVoiceProvider`.

### Fase 2 — NOWCAST sulla strada
**Obiettivo:** cone ∩ corridoio e voce con ETA.
**ID:** NOW-ROAD-04/05/06, NOW-FLOW-01/03/04/06, BETA-15, BETA-16, DEVICE-08.
**Prerequisiti:** Fase 1.
**Test:** TEST-NOW-02, `intersection.test.ts`, `weather.test.ts`.
**NON modificare:** NOWCAST, il contratto `/api/road-alerts`, `NowcastWeatherProvider` nella parte di fetch/freshness (NOW-POLL-* e NOW-01..10 sono PASS).

### Fase 3 — Alert queue e arbitration
**Obiettivo:** una sola pipeline di alert con priorità e rivalutazione.
**ID:** VOICE-OUT-07, ALERT-01/02/04/05/06/07/08/09, BETA-07.
**Prerequisiti:** Fase 1 (serve road relevance nella pipeline).
**Test:** `AlertEngine.test.ts`, `speech.test.ts`, `ducking.test.ts`.
**NON modificare:** `AlertSpeechEngine` dedup/minGap (VOICE-OUT-06 è PASS), `ConfidenceEngine`.

### Fase 4 — Hands-free vocale
**Obiettivo:** multi-command senza tocco, con recovery controllato.
**ID:** VOICE-IN-01/03/04, VOICE-LIFE-03/04/06, SELF-04/05, BETA-01, BETA-02, BETA-04, DEVICE-01/03.
**Prerequisiti:** nessuno tecnico, ma **alto rischio**: tocca il modulo che ha già prodotto due regressioni sul campo.
**Test:** TEST-VOICE-01/02/04, con mock **non idealizzati** (sessione che parte e resta muta, interim, `no-speech` ripetuti).
**NON modificare:** `parser.ts`, `report()`, la convergenza voce/manuale (VOICE-IN-07 è PASS).

### Fase 5 — Interruzioni audio
**Obiettivo:** stato `AUDIO_INTERRUPTED` e recovery post-chiamata.
**ID:** PHONE-04/07/08/09/10/11/12, PHONE-ALERT-01..06, NOW-PHONE-01..05, BETA-12/13/14.
**Prerequisiti:** Fase 3 (coda) e Fase 4 (recovery).
**Test:** TEST-PHONE-01 + DEVICE-02/04.
**NON modificare:** SELF-01/02/03 (PASS).

### Fase 6 — Igiene dati
**Obiettivo:** TTL, confidence e riconferma progettati insieme; contatore onesto.
**ID:** TTL-02/09/10, CONF-02/03, LIFE-02/03/05, EVENT-02/05/06/07, CLEAN-05/09, DEBUG-04, BETA-08, BETA-11.
**Prerequisiti:** nessuno; **eseguibile in parallelo** alle Fasi 1–3.
**Test:** TEST-EVENT-01, TEST-CLEAN-01, TEST-PERF-01.
**NON modificare:** la formula di `ConfidenceEngine` senza motivazione scritta.

### Fase 7 — Backend cooperativo
**Obiettivo:** A → B reale.
**ID:** REMOTE-01/03/04/06/07/08/09, NET-06/07/08, VOICE-OUT-03, COST-03, DEVICE-05, BETA-05.
**Prerequisiti:** Fase 1 (pertinenza stradale) + **autorizzazione esplicita** (NET-04).
**Test:** TEST-REMOTE-01.
**NON modificare:** PRIV-04/08, NOW-*.

---

## 8. VERIFICA FINALE

Riportata nella risposta operativa. L'unico file creato da questo ciclo è
`BETA-TRACEABILITY-R1.md`.

**Nessun commit, nessun push, nessun deploy, nessuna modifica a NOWCAST, Cloudflare o DNS.**

---

*Fine BETA-TRACEABILITY-R1 — riferimento: `ROAD-SENSE-BETA-MASTER-R1.md`*

---

## Changelog Fase 1 — Forward Corridor (ROUTE-02)

**Implementato:** `src/core/forwardCorridor.ts` (modulo puro), `src/ui/mapRoads.ts`
(lettura della geometria dai tile già caricati), integrazione in `src/App.tsx` al posto
del `null` fuori demo, `CORRIDOR` in `src/config/config.ts`.

**Test aggiunti:** `src/core/forwardCorridor.test.ts` — 25 casi, scritti prima del codice.

### ID il cui stato è realmente cambiato

| ID | Prima | Dopo | Perché |
|---|---|---|---|
| ROUTE-02 | MISSING | **PARTIAL** | il corridoio esiste fuori demo; la parte road-geometry non è verificata su dispositivo |
| ROUTE-04 | MISSING | **PARTIAL** | il meteo valuta contro il corridoio; i pericoli stradali no |
| ROUTE-05 | MISSING | **PASS** | biforcazione ambigua → il corridoio si ferma e lo dichiara |
| ROUTE-06 | PARTIAL | **PASS** | lunghezza velocità-dipendente con policy centralizzata |
| ROUTE-07 | PARTIAL | **PARTIAL** ⬆ | distanza lungo corridoio anche fuori demo |
| ROAD-09 | MISSING | **PARTIAL** | UNKNOWN non diventa mai pertinenza |
| ROAD-10 | MISSING | **PARTIAL** | aggancio con confidence e sorgente dichiarate |
| NOW-ROAD-04 | MISSING | **PARTIAL** | cono ∩ corridoio ora avviene fuori demo |
| NOW-ROAD-06 | MISSING | **PARTIAL** | fuori dal corridoio nessuna intersezione |
| NOW-FLOW-04 | MISSING | **PARTIAL** | ETA calcolabile fuori demo |

### ID che NON sono cambiati, benché ROUTE-02 sia implementato

Nessuno di questi è stato promosso: l'evidenza non lo consente.

| ID | Stato | Perché resta così |
|---|---|---|
| ROUTE-03 | MISSING | un corridoio non è una route: nessuna destinazione esiste |
| ROAD-01/02/03/04/06/07 | invariati | `AlertEngine` non è stato toccato: i pericoli stradali usano ancora cerchio + cono |
| ROAD-08 | MISSING | esistono stati del *corridoio*, non stati di *pertinenza* (`AHEAD_RELEVANT`, `OTHER_ROAD`, …) |
| NOW-ROAD-05 | PARTIAL | invariato nella sostanza |
| NOW-FLOW-01/03/06 | PARTIAL | mancano ancora priority e queue |
| WARN-02/05/06 | invariati | la warning distance non è stata toccata |
| BETA-06/21/22 | MISSING | richiedono road relevance nel motore di alert, non solo il corridoio |

### Limiti reali incontrati

1. **La geometria stradale vive solo nella cache tile di MapLibre.** Oltre il viewport non
   esiste: `CORRIDOR.roadMaxLengthM` (2 km) è un limite fisico, non una scelta di prodotto.
   Nessun tile aggiuntivo viene richiesto a OpenFreeMap, come da vincolo.
2. **Il percorso road-geometry non è testabile in automatico.** `querySourceFeatures` non
   esiste in Node. `mapRoads.ts` è scritto in modo difensivo (qualunque errore → `[]` →
   ripiego su heading), ma la sua correttezza **richiede un test su dispositivo**.
3. **Rischio introdotto, da presidiare.** Prima della Fase 1, fuori dalla demo il meteo non
   poteva dire «sul percorso»: mancava il percorso. Ora può. Con un corridoio `heading`
   quella frase afferma una pertinenza stradale che non è stata dimostrata. Il dato per
   evitarlo esiste già (`roadEvidence`), ma **nessuno lo consuma**: va collegato alla
   formulazione dell'avviso in Fase 2/3.

### Correzione di sicurezza (fine Fase 1)

La Fase 1 aveva introdotto una regressione: con un corridoio costruito sul solo
`heading`, il meteo poteva pronunciare «sul percorso» senza alcuna evidenza stradale.
Prima della Fase 1 non poteva farlo, perché il percorso non esisteva.

**Correzione:** `allowsRoadRelevance(corridor)` in `core/forwardCorridor.ts` è il punto
unico in cui si decide se la pertinenza stradale possa essere affermata. In `App.tsx`
l'annuncio meteo predittivo passa da `puoDireSulPercorso`; il banner e la mappa restano,
perché mostrano una previsione senza dichiararla certa. «Nell'area attuale» non dipende
dal percorso e non è toccata. In demo l'evidenza resta vera: il tracciato è una strada nota.

| Caso | Corridoio | «sul percorso» | Mappa/banner |
|---|---|---|---|
| A | `road-geometry`, `roadEvidence: true` | **consentito** | sì |
| B | `heading`, `roadEvidence: false` | **vietato** | sì |
| C | `none` | **vietato** (nessun percorso, nessuna intersezione) | no |
| — | demo | consentito | sì |

Nessun ID è stato promosso a PASS da questa correzione: rende più solida l'evidenza di
ROAD-09, NOW-ROAD-06 e NOW-FLOW-04, che restano PARTIAL. **ROUTE-02 resta PARTIAL** finché
il ramo `road-geometry` non è verificato su dispositivo reale.

---

## Riarmo controllato della voce (blocker Beta)

### Evidenza dal test reale sul Samsung Fold — PRIMA del fix

```
START → VOCE → "Buca" → riconosciuta → evento creato → mappa → EVENTI = 1
     → subito dopo: VOCE OFF
```

**Hands-free = FALLITO.** Il riconoscimento funzionava; la sessione terminava e nessuno
la riapriva. Causa esatta: `BrowserVoiceProvider.onresult` chiamava `closeSession('off')`
e `onend` dichiarava «NESSUN riavvio». Lo stato `restarting` (`VOCE ~`) esisteva in UI ma
non veniva mai emesso.

### Dopo il fix

Ogni chiusura porta un **motivo** (`command` · `silence` · `error` · `denied` · `stopped` ·
`speaking`) e il motivo decide se e quando si riapre. Un comando riuscito azzera i
contatori; il silenzio ha un budget di 3 cicli; gli errori arretrano e poi aprono il
circuito; STOP disarma prima di chiudere.

| ID | Prima | Dopo | Nota |
|---|---|---|---|
| VOICE-IN-01 | MISSING | **DEVICE TEST** | riarmo implementato e testato in automatico |
| VOICE-IN-03 | MISSING | **DEVICE TEST** | idem |
| VOICE-IN-04 | MISSING | **DEVICE TEST** | «buca → ostacolo → acqua» verde in automatico |
| VOICE-LIFE-03 | MISSING | **PASS** | backoff e attese differenziate per motivo |
| VOICE-LIFE-04 | MISSING | **PASS** | circuito aperto dopo 3 errori o 3 silenzi |
| VOICE-LIFE-06 | PASS (vacuo) | **PARTIAL** | da vacuo a sostanziale: resta da verificare durante una telefonata reale |
| SELF-04 | MISSING | **DEVICE TEST** | `resume()` riapre dopo la voce sintetica |
| SELF-05 | MISSING | **DEVICE TEST** | nessun tocco richiesto dopo il TTS |
| BETA-01 | MISSING | **DEVICE TEST** | — |
| BETA-02 | MISSING | **DEVICE TEST** | — |

**Nessuna promozione a PASS per gli ID hands-free.** I test automatici usano un
riconoscitore finto: non dimostrano il comportamento di Chrome Android. Restano
**DEVICE TEST** finché sul Fold non si ripete, senza toccare il telefono:

```
"Buca" → "Ostacolo" → "Acqua"
```

verificando inoltre che il tono di attivazione **non** suoni ciclicamente nel silenzio.

*Aggiornato dopo il riarmo controllato — riferimento: `ROAD-SENSE-BETA-MASTER-R1.md`*
