# ROAD SENSE — Roadmap

Alessandro Pezzali

> La roadmap segue la filosofia del progetto: ROAD SENSE non deve fare tutto,
> deve fare poche cose bene. Ogni voce qui sotto entra solo se rispetta
> **costo zero**, **privacy by design** e **semplicità**.

---

## v0.1.0 — MVP ✅ completata

Funzionante e verificata in locale.

- [x] PWA installabile, mobile-first, dark mode, offline shell
- [x] Mappa MapLibre + OpenFreeMap (dati OpenStreetMap) con attribution corretta
- [x] Sorgente cartografica astratta dietro `MapTileProvider` (vettoriale o raster)
- [x] Posizione e direzione dell'utente
- [x] `SensorProvider` astratto + `PhoneSensorProvider`
- [x] `SensorEngine`: normalizzazione, rumore di fondo, frequenza controllata
- [x] Compensazione dell'orientamento senza calibrazione manuale
- [x] `DetectionEngine`: euristica documentata e calibrabile (buche, fondo irregolare)
- [x] `ConfidenceEngine`: aggregazione per zona, saturazione, decadimento
- [x] `AlertEngine`: cono frontale, carreggiata, anticipo proporzionale alla velocità
- [x] TTL per categoria
- [x] Segnalazione manuale in due tocchi
- [x] Identificatore anonimo a rotazione
- [x] Archivio locale con TTL e deduplicazione
- [x] **DEMO MODE** utilizzabile da desktop, su itinerario stradale reale
      congelato nel progetto (offline, deterministico, senza servizi di routing)
- [x] Stub dei provider futuri (BLE, OBD, SmartTyre, CyberTyre)
- [x] Backend Cloudflare Worker + D1 **scritto** (non deployato, disattivo)
- [x] Test su logica critica e percorsi degradati
- [x] Documentazione completa

---

## Fase ZERO TOUCH — in corso

- [x] Tassonomia strutturata dei pericoli e modello `RoadHazard`
- [x] Priorità semantica, distinta dalla confidenza
- [x] Parser vocale italiano, puro e testabile, che non inventa attributi
- [x] `VoiceProvider` astratto: browser e demo
- [x] Avvisi parlati come uscita dell'`AlertEngine`, con cooldown e dedup
- [x] Indicatori GPS / SENSORI / VOCE con stati reali
- [x] Sequenza demo voce → evento non confermato → conferma → avviso
- [ ] **Prova su strada**: nessuna di queste funzioni è stata usata guidando
- [ ] Verifica del riconoscimento vocale su iPhone reale
- [ ] Valutare se l'elaborazione locale sia disponibile sui dispositivi target

## v0.1.1 — Cartografia conforme e pubblicazione

- [x] Sostituita la sorgente cartografica: i server di OpenStreetMap bloccavano
      ROAD SENSE (`x-blocked`), correttamente, perché la loro Tile Usage Policy
      non consente l'uso da parte di applicazioni distribuite
- [x] `Referrer-Policy` corretta, cache cartografica rimossa dal service worker
- [ ] Valutare una sorgente **raster** se il peso di MapLibre (+240 kB gzip) o
      il requisito WebGL dovessero risultare un problema su dispositivi datati

Obiettivo: ROAD SENSE raggiungibile su HTTPS e provabile su strada.

- [ ] Deploy su Cloudflare Pages
- [ ] Dominio `roadsense.pezzalihub.app`
- [ ] Verifica di installazione PWA su Android/Chrome e iOS/Safari
- [ ] **Prova reale su strada** — l'unico modo per tarare le soglie
- [ ] Taratura di `DETECTION` con dati veri (le soglie attuali sono stime
      ragionate, non misure)
- [ ] Verifica del comportamento con telefono in posizioni diverse

---

## v0.2.0 — Collaborazione

Obiettivo: l'auto B viene avvisata della buca rilevata dall'auto A.

- [ ] Creazione di D1 e deploy del Worker
- [ ] Attivazione di `VITE_API_BASE`
- [ ] Sincronizzazione bidirezionale degli eventi
- [ ] Voto "c'è ancora" / "non c'è più" nell'interfaccia
- [ ] Verifica dei consumi reali rispetto alle quote gratuite
- [ ] Monitoraggio dell'uso (senza analytics: solo i contatori di Cloudflare)

---

## v0.3.0 — Affinamento

- [ ] Taratura delle soglie su un campione di percorsi diversi
      (asfalto liscio, pavé, sterrato, tangenziale)
- [ ] Distinzione tra buca e dosso artificiale (i dossi sono ricorrenti e
      sempre nello stesso punto: la ripetibilità è il segnale)
- [ ] Riduzione dei falsi positivi da telefono mal fissato
- [ ] Alert vocale opzionale (`SpeechSynthesis`, disponibile e gratuito nel
      browser) — da valutare: non deve diventare una distrazione
- [ ] Migliore gestione della perdita di segnale GPS in galleria

---

## v0.4.0 — Estensioni hardware

Solo se e quando esisteranno API ufficiali e autorizzate.

- [ ] `ObdSensorProvider` — velocità e stato veicolo indipendenti dal GPS
- [ ] `BleSensorProvider` — sensore esterno via Web Bluetooth (Android)
- [ ] `SmartTyreProvider` — pressione, temperatura, aderenza

> **Vincolo assoluto.** Nessun reverse engineering. Nessuna intercettazione di
> protocolli proprietari. Nessun uso di marchi o API proprietarie senza
> autorizzazione. `CyberTyreProvider` resta uno stub: un'eventuale integrazione
> con un sistema di pneumatici intelligenti di un costruttore potrà avvenire
> **esclusivamente** tramite SDK, API o documentazione ufficialmente
> disponibili e autorizzati.
>
> ROAD SENSE resta **vendor-neutral** e deve funzionare perfettamente anche
> senza pneumatici intelligenti.

---

## Futuro — integrazione NOWCAST

**Non prima che ROAD SENSE sia stabile e provato su strada.**

Nella v0.1.0 esiste una **simulazione puramente visiva** dentro la DEMO MODE
(`src/weather/`), per mostrare il concetto senza implementarlo: aree meteo
inventate sul percorso demo e un esempio di correlazione fra previsione e
segnalazioni stradali. `NowcastWeatherProvider` è uno stub inerte.

L'idea: arricchire gli alert con condizioni meteo pericolose — precipitazioni
intense, grandine, temporali.

> **ROAD SENSE e NOWCAST restano due progetti indipendenti.**
> Repository separati, deployment separati, nessuna dipendenza in nessuna
> direzione. Un malfunzionamento di ROAD SENSE **non può** compromettere
> NOWCAST, perché ROAD SENSE non lo conosce.
>
> L'integrazione avverrebbe come un ulteriore `SensorProvider` opzionale, il cui
> fallimento degrada a "nessun dato meteo" — esattamente come oggi degrada
> l'assenza dell'accelerometro.

---

## Valutato e scartato

| Idea | Perché no |
|---|---|
| Account utente | distruggerebbe il principio del progetto |
| Notifiche push | richiedono registrazione e un servizio: incompatibili con "nessun account" |
| Navigazione turn-by-turn | serve routing: nessuna soluzione gratuita e sostenibile. Esistono già app che lo fanno bene |
| Machine learning in cloud | costo, privacy, complessità. L'euristica locale è leggibile, modificabile e verificabile |
| Download di mappe offline | è un uso che vari fornitori vietano espressamente, OpenStreetMap incluso |
| Classifiche, punteggi, gamification | incentiverebbero a guardare il telefono guidando |
| Foto delle buche | privacy (volti, targhe), banda, moderazione, archiviazione |
| Descrizioni testuali libere | richiederebbero moderazione e aprirebbero superfici di attacco. Le categorie bastano |
| Esecuzione in background | nessun browser la garantisce. Fingere il contrario sarebbe disonesto |
| Cronologia dei propri viaggi | esisterebbe una traccia. Non deve esistere |
