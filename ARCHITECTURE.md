# ROAD SENSE — Architettura

v0.1.0 · Alessandro Pezzali

---

## 1. Principio guida

> Tra una soluzione complessa e una soluzione semplice che funziona,
> si sceglie **la soluzione semplice che funziona**.

Priorità, in quest'ordine:
**affidabilità → semplicità → privacy → costo zero → sicurezza → batteria → estendibilità.**

Ogni scelta in questo documento è giustificata da questa scala. Dove una
funzione non è tecnicamente affidabile in una PWA, è **dichiarata** anziché
mascherata con un workaround fragile.

---

## 2. Vista d'insieme

```
┌─────────────────────────── DISPOSITIVO (tutto locale) ───────────────────────────┐
│                                                                                  │
│  SensorProvider  ──▶  SensorEngine  ──▶  DetectionEngine  ──▶  EventStore        │
│  (astratto)           normalizza         euristica             locale + TTL      │
│                       filtra rumore      anomalie                   │            │
│                       gestisce Hz                                   ▼            │
│                                                            ConfidenceEngine      │
│                                                            aggrega per zona      │
│                                                                     │            │
│                                                      ┌──────────────┴────────┐   │
│                                                      ▼                       ▼   │
│                                                  MapView               AlertEngine│
└──────────────────────────────────────────────────────┬───────────────────────────┘
                                                       │ solo EVENTI, mai tracce
                                                       ▼
                                      ┌────────────────────────────────┐
                                      │  Cloudflare Worker + D1        │
                                      │  (opzionale, non deployato)    │
                                      └────────────────────────────────┘
```

Il flusso è unidirezionale. Nessun componente a valle può influenzare uno a
monte, e l'assenza del backend non interrompe nulla.

---

## 3. Stack

| Scelta | Alternativa scartata | Motivo |
|---|---|---|
| React 19 + TypeScript + Vite | — | richiesto, gratuito, build veloce |
| **Leaflet puro** | `react-leaflet` | una dipendenza in meno e controllo esplicito sul ciclo di vita dei layer, che è ciò che conta per il consumo |
| **CSS unico scritto a mano** | Tailwind / MUI | l'interfaccia ha 6 componenti: un framework CSS sarebbe più pesante del progetto |
| **Service worker scritto a mano** | Workbox / `vite-plugin-pwa` | servono tre strategie di cache, non un generatore. Zero dipendenze di build |
| **Icone generate da script Node** | pacchetto grafico | nessuna dipendenza, icone riproducibili con `npm run icons` |
| **Nessun clustering marker** | `leaflet.markercluster` | il `ConfidenceEngine` già aggrega per zona: un secondo livello di raggruppamento confonderebbe soltanto |

Dipendenze di produzione totali: **3** (`react`, `react-dom`, `leaflet`).

---

## 4. SensorProvider — astrazione vendor-neutral

```ts
interface SensorProvider {
  probe(): Promise<SensorCapabilities>;
  requestPermissions(): Promise<SensorCapabilities>;
  start(handlers: SensorProviderEvents): Promise<void>;
  stop(): void;
}
```

L'app **non sa mai** da dove arrivano i dati. Implementazioni:

| Provider | Stato | Note |
|---|---|---|
| `PhoneSensorProvider` | **attivo** | GPS + `devicemotion` |
| `DemoSensorProvider` | **attivo** | percorso simulato, per il test da desktop |
| `BleSensorProvider` | stub | Web Bluetooth assente su iOS |
| `ObdSensorProvider` | stub | dati veicolo via adattatore OBD-II |
| `SmartTyreProvider` | stub | pressione, temperatura, aderenza |
| `CyberTyreProvider` | stub | segnaposto per un sistema di un costruttore |

### Regole non negoziabili sugli stub

- **nessun reverse engineering** di protocolli proprietari;
- **nessuna intercettazione** di comunicazioni di terzi;
- **nessun uso di marchi o API proprietarie** senza autorizzazione;
- ogni integrazione futura passerà esclusivamente da **SDK, API o
  documentazione ufficialmente disponibili e autorizzati**.

ROAD SENSE deve funzionare perfettamente **anche senza** pneumatici
intelligenti: sono un arricchimento, mai un requisito.

---

## 5. SensorEngine

Responsabilità: acquisire, normalizzare, marcare temporalmente, **filtrare il
rumore**, gestire la frequenza, mantenere lo stato dei sensori.

Non decide nulla sulle anomalie.

**Finestra scorrevole.** Mantiene 2 secondi di accelerazione verticale in un
buffer con somma dei quadrati incrementale: l'RMS del rumore di fondo si
calcola in tempo costante, senza riscorrere l'array a ogni campione.

**Punto sottile.** La baseline viene letta **prima** di inserire il campione
corrente: altrimenti l'impulso alzerebbe la propria stessa soglia di
riferimento e il criterio relativo diventerebbe inutile.

**Downsampling.** Al massimo 50 Hz elaborati, il resto scartato prima di
qualsiasi calcolo.

---

## 6. DetectionEngine — l'euristica

Nessun machine learning, nessuna API cloud: **tutta l'analisi resta sul
dispositivo** e i campioni dei sensori non lasciano mai il telefono.

Una buca non è "un'accelerazione alta". Devono valere **tutte** queste
condizioni:

| # | Criterio | Soglia (`config/config.ts`) | Perché |
|---|---|---|---|
| 1 | velocità plausibile | 3–70 m/s | sotto ~11 km/h uno scossone è indistinguibile dal telefono manipolato; oltre 250 km/h il GPS mente |
| 2 | motore "caldo" | 3 s | la stima della gravità deve essersi stabilizzata |
| 3 | picco assoluto | ≥ 3.2 m/s² | soglia minima di significatività |
| 4 | picco **relativo** | ≥ 3× l'RMS di fondo, con fondo < 2.0 | su pavé ogni sobbalzo supererebbe la soglia assoluta |
| 5 | durata coerente | 20–350 ms | più breve = rumore; più lungo = dosso, frenata, rotonda |
| 6 | telefono fermo | rotazione < 220 °/s | se ruota bruscamente è stato preso in mano |
| 7 | contesto prima e dopo | impulso chiuso e rientrato | si valuta solo un impulso **isolato** |
| 8 | periodo refrattario | 2.5 s | una buca non deve diventare dieci eventi |

**Isteresi.** L'impulso si apre a 3.2 m/s² e si chiude a metà soglia: evita
l'apertura e chiusura ripetuta su una singola oscillazione.

**Riarmo.** Se un impulso viene abbandonato perché troppo lungo, il rilevatore
resta bloccato finché il segnale non torna sotto la soglia di uscita. Senza
questo, un'oscillazione prolungata verrebbe spezzata in più "buche" fittizie —
comportamento emerso da un test e corretto.

**Fondo irregolare.** Se l'RMS resta sopra 2.4 m/s² per almeno 4 secondi si
emette un singolo evento `rough` invece di decine di buche.

**Confidenza del singolo rilevamento: massimo 0.60.** Deliberato. Un solo
passaggio non può produrre una certezza; per superare quella soglia servono
rilevamenti indipendenti.

---

## 7. ConfidenceEngine — l'aggregazione

Il problema: un tombino, una cinghia che sbatte o un telefono mal fissato
generano falsi positivi. Una buca vera, invece, la incontrano in molti. È la
**concordanza** a produrre fiducia.

### 7.1 Aggregazione spaziale

Rilevamenti dello stesso tipo entro `MERGE_RADIUS_M[type]` formano un cluster.
Il raggio dipende dalla categoria, perché i fenomeni hanno estensione diversa:

| Categoria | Raggio |
|---|---|
| buca | 20 m |
| ostacolo | 30 m |
| altro | 40 m |
| fondo irregolare | 60 m |
| acqua, scivoloso | 70 m |
| incidente | 80 m |
| lavori | 120 m |

### 7.2 Aggregazione direzionale

Le direzioni si mediano **circolarmente** (la media aritmetica di 350° e 10°
darebbe 180°, non 0°). Se il vettore risultante è troppo corto — direzioni
discordi — il cluster resta **senza direzione** e allerta tutti: scelta
prudenziale.

### 7.3 Peso per segnalatore

| Contributo | Peso |
|---|---|
| prima segnalazione di un segnalatore | ×1.0 |
| segnalazioni successive dello stesso | ×0.15 |
| tetto per singolo segnalatore | 1.3 |
| segnalazione manuale | 1.0 |
| rilevamento automatico | 0.7 × confidenza del rilevamento |

Così un singolo dispositivo che ripassa dieci volte **non può** creare da solo
un evento confermato — verificato da un test — ma il fatto che ripassi e rilevi
ancora conta qualcosa.

### 7.4 Saturazione

```
confidence_base = 1 − e^(−0.43 · pesoTotale)
```

| Segnalatori indipendenti | Confidenza base |
|---|---|
| 1 | ≈ 0.35 |
| 2 | ≈ 0.58 |
| 3 | ≈ 0.72 |
| 5 | ≈ 0.88 |

Curva continua e saturante: il secondo segnalatore aggiunge molto, il decimo
quasi nulla. Nessuna soglia arbitraria a gradini.

### 7.5 Intensità e decadimento

```
confidence = (base + 0.05·(severità_media − 1)) · (0.5 + 0.5 · TTL_residuo/TTL)
```

Un evento vicino alla scadenza vale al massimo metà. Oltre il TTL sparisce.

### 7.6 Livelli

| Livello | Soglia | Resa in mappa |
|---|---|---|
| possibile | ≥ 0.30 | marker tratteggiato, trasparente |
| probabile | ≥ 0.55 | marker pieno |
| confermato | ≥ 0.78 | marker pieno con alone |

---

## 8. TTL — gli eventi non sono permanenti

Una buca viene riparata, l'acqua evapora, un incidente viene rimosso.

| Categoria | TTL |
|---|---|
| incidente | 2 ore |
| acqua | 4 ore |
| fondo scivoloso | 6 ore |
| ostacolo | 12 ore |
| altro | 24 ore |
| lavori | 7 giorni |
| fondo irregolare | 30 giorni |
| buca | 45 giorni |

Valori di partenza ragionevoli, **non definitivi**: stanno tutti in
`config/config.ts` e si cambiano in una riga.

Il TTL è applicato in **tre punti indipendenti**: in lettura dall'archivio
locale, nel purge periodico, e nella colonna `expires_at` del database. Una
sola dimenticanza non fa sopravvivere un evento morto.

---

## 9. AlertEngine

Si allerta solo su ciò che è **davanti, vicino e attendibile**.

| Criterio | Regola |
|---|---|
| affidabilità | confidenza ≥ 0.35 |
| distanza | ≤ velocità × 14 s, limitata a 120–600 m |
| direzione | evento entro ±35° dalla marcia |
| vicinanza | sotto 60 m il cono si allarga a ±70° (l'errore angolare del GPS esplode) |
| carreggiata | se il cluster ha direzione nota, deve essere concorde entro ±60° |
| ripetizione | stesso cluster non più di una volta ogni 120 s |
| direzione ignota | si allerta solo sotto 60 m, per non disturbare |

La distanza di anticipo **scala con la velocità**, così il tempo di reazione
resta costante: ~195 m a 50 km/h, ~500 m a 130 km/h.

**Limite dichiarato.** ROAD SENSE non conosce il grafo stradale: può allertare
su un evento situato su una strada parallela vicina. Il filtro per cono e
direzione riduce il problema ma non lo elimina. Senza routing gratuito e
offline non è risolvibile in modo affidabile.

---

## 10. Modello dati

```ts
interface RoadEvent {
  id: string;            // UUID v4
  lat: number;           // arrotondato a 5 decimali (~1 m)
  lon: number;
  ts: number;            // epoch ms
  type: EventType;       // pothole | rough | obstacle | water |
                         // slippery | accident | roadworks | other
  severity: 1 | 2 | 3;
  source: 'auto' | 'manual';
  confidence: number;    // 0..1, del SINGOLO rilevamento
  heading: number | null;
  reporterId: string;    // anonimo, a rotazione
  sensorData?: {         // solo dati tecnici
    peakVerticalAccel?: number;
    impulseMs?: number;
    speedMps?: number;
    baselineRms?: number;
  };
  demo?: boolean;
}
```

Il modello **non ha un posto** dove infilare un'identità: non esiste un campo
utente, e la validazione scarta ogni campo non previsto.

---

## 11. Identificatore anonimo

- 16 esadecimali da `crypto.getRandomValues()`;
- nessun legame con hardware, account, IP, IMEI, numero, email;
- **rotazione automatica ogni 12 ore**;
- memorizzato solo sul dispositivo, azzerabile in qualsiasi momento.

Serve unicamente a distinguere segnalatori indipendenti nel calcolo della
confidenza.

**Compromesso accettato:** dopo una rotazione lo stesso dispositivo appare come
un nuovo segnalatore, il che rende il conteggio leggermente ottimista. È una
scelta consapevole a favore della privacy: un identificatore stabile
permetterebbe di seguire un dispositivo nel tempo.

---

## 12. Backend — Cloudflare Worker + D1

### Quale componente serve e perché

| Componente | Serve? | Motivo |
|---|---|---|
| **Cloudflare Pages** | sì | ospita il frontend statico su HTTPS |
| **Cloudflare Workers** | sì (v0.2.0) | tre endpoint HTTP, nessun server da tenere acceso |
| **Cloudflare D1** | sì (v0.2.0) | gli eventi vanno interrogati per area geografica: serve SQL con indici |
| **Cloudflare KV** | **no** | KV è chiave-valore con consistenza eventuale: non sa rispondere a "eventi in questo riquadro" |
| Durable Objects, Queues, R2 | **no** | non servono, e alcuni non sono nel piano gratuito |

Si usa **solo ciò che serve davvero**.

### Cosa contiene il database

Tre tabelle:

- `events` — coordinate, istante, categoria, severità, direzione,
  `reporter_id` anonimo, dati tecnici, `expires_at`, contatori di conferma;
- `event_votes` — un voto per segnalatore per evento (chiave primaria composta:
  il vincolo del database impedisce i voti multipli);
- `rate_buckets` — contatori di rate limiting, cancellati di continuo.

**Nessun utente, nessuna sessione, nessuna traccia, nessun indirizzo IP,
nessuna cronologia di viaggio.**

### API

| Metodo | Percorso | Funzione |
|---|---|---|
| `GET` | `/events?lat&lon&radius` | eventi vivi in un'area |
| `POST` | `/events` | invio di 1–20 eventi |
| `POST` | `/events/:id/confirm` | "c'è ancora" |
| `POST` | `/events/:id/gone` | "non c'è più" |
| `GET` | `/health` | stato del servizio |

La query geografica usa un **riquadro sugli indici** (veloce) seguito da un
filtro di distanza esatta in JavaScript (preciso). Un evento smentito almeno
due volte e più volte di quante sia stato confermato non viene restituito.

### Perché resta a costo zero

- Workers free: 100.000 richieste/giorno;
- D1 free: 5 GB, 5 M righe lette/giorno, 100 k scritte/giorno;
- il client sincronizza **al massimo ogni 90 secondi**, e solo dopo 2 km;
- si inviano solo eventi, non posizioni.

Il traffico resta ordini di grandezza sotto le soglie. Se una quota si esaurisce
Cloudflare **limita** il servizio, non addebita. Nessun binding a pagamento è
presente in `wrangler.toml`.

---

## 13. PWA e cache

| Risorsa | Strategia | Motivo |
|---|---|---|
| HTML di navigazione | rete per prima, cache di riserva | l'app deve restare aggiornata, ma aprirsi anche offline |
| `/assets/*` | cache per prima | nomi con hash: non cambiano mai a parità di nome |
| tile OSM | cache per prima, max 400, TTL 7 giorni | solo le tile **viste**, mai prefetch |
| `/api/*` | **mai in cache** | un evento stradale vecchio è peggio di nessun evento |

L'aggiornamento non viene mai applicato a sorpresa: compare una barra e decide
l'utente.

---

## 14. Estendibilità futura

L'architettura è già predisposta, ma **nulla di tutto questo è nella v0.1.0**.

**Smart tyre.** `VehicleSample` in `SensorProvider.ts` prevede pressione,
temperatura, indice di aderenza e un riferimento **tecnico** del sensore (mai
riferibile a una persona). Basta implementare un provider.

**NOWCAST — integrazione futura, non presente.** ROAD SENSE e NOWCAST restano
due progetti **indipendenti**: repository separati, deployment separati,
nessuna dipendenza in nessuna direzione. Un malfunzionamento di ROAD SENSE non
può compromettere NOWCAST, perché ROAD SENSE non lo conosce. Un'eventuale
integrazione avverrebbe come un ulteriore `SensorProvider` opzionale il cui
fallimento degrada a "nessun dato meteo", esattamente come oggi degrada
l'assenza dell'accelerometro.

**Tile provider.** `TILE_PROVIDER` in `config/config.ts` è un singolo oggetto:
cambiare cartografia significa cambiare tre righe.
