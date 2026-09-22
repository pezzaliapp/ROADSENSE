# ROAD SENSE

**v0.1.0** — Progressive Web App che usa lo smartphone come sensore stradale.

Autore: **Alessandro Pezzali** · Licenza: [MIT](LICENSE)

---

## Cos'è ROAD SENSE

ROAD SENSE trasforma un telefono appoggiato in auto in un sensore della strada.
Mentre si guida rileva automaticamente buche, urti e fondo irregolare usando
accelerometro e GPS, permette di segnalare un pericolo con due tocchi e avvisa
quando ci si avvicina a un evento segnalato **davanti** al veicolo.

Il principio è uno solo:

> **Si monitora LA STRADA, NON LE PERSONE.**

Nessun account. Nessuna registrazione. Nessuna password.
Si apre il link e funziona.

---

## Come funziona

```
  sensori telefono            DetectionEngine          ConfidenceEngine
  (GPS + accelerometro)  ──▶  euristica locale   ──▶   aggregazione
                                                        per zona
                                    │                        │
                                    ▼                        ▼
                               evento anonimo           mappa + alert
                                    │
                                    ▼
                        backend opzionale (Cloudflare)
                                    │
                                    ▼
                         altri utenti ROAD SENSE
```

1. **START** — l'app acquisisce i sensori disponibili.
2. Il `DetectionEngine` analizza **localmente** l'accelerazione verticale
   compensata rispetto all'orientamento del telefono.
3. Un impulso che supera tutti i controlli (velocità, durata, rapporto con il
   rumore di fondo, rotazione) diventa un evento.
4. Il `ConfidenceEngine` aggrega gli eventi vicini: più segnalatori
   indipendenti concordano, più la zona è affidabile.
5. L'`AlertEngine` avvisa solo per ciò che è **davanti, vicino e attendibile**.
6. Ogni evento ha un **TTL** per categoria: una buca dura settimane, l'acqua ore.

---

## Installazione e sviluppo

Requisiti: Node.js 20+ (testato su Node 24), npm.

```bash
git clone https://github.com/pezzaliapp/ROADSENSE.git
cd ROADSENSE
npm install

npm run dev        # sviluppo su http://localhost:5173
npm run typecheck  # controllo TypeScript
npm run lint       # ESLint
npm run test       # test (vitest)
npm run build      # build di produzione in dist/
npm run preview    # anteprima della build
npm run verify     # typecheck + lint + test + build
npm run icons      # rigenera le icone PWA
```

### Provare dal Mac senza guidare — DEMO MODE

```
http://localhost:5173/?demo=1
```

oppure il pulsante **DEMO** nella barra di stato.

La DEMO MODE simula un veicolo che percorre un anello a 50 km/h, con anomalie
lungo il percorso ed eventi già segnalati da altri utenti fittizi. Serve a
vedere rilevamento, aggregazione, confidenza crescente e alert senza muoversi.

> Gli eventi demo sono marcati `demo: true`, salvati in una chiave di storage
> separata e **rifiutati dalla validazione lato backend**: non possono
> contaminare i dati reali.

### Provare dal telefono in sviluppo

`npm run dev` espone il server sulla LAN, ma **geolocalizzazione e sensori di
movimento richiedono HTTPS** (o `localhost`). In pratica: per il test reale su
strada serve la versione pubblicata su HTTPS.

---

## Struttura del progetto

```
src/
  config/config.ts        TUTTE le soglie, i TTL e i parametri (unico punto)
  core/
    types.ts              modello dati condiviso
    geo.ts                distanza, direzione, media circolare
    validation.ts         validazione eventi (condivisa con il Worker)
    anonId.ts             identificatore anonimo a rotazione
    SensorEngine.ts       acquisizione, normalizzazione, rumore di fondo
    DetectionEngine.ts    euristica anomalie (documentata nel file)
    ConfidenceEngine.ts   aggregazione e confidenza per zona
    AlertEngine.ts        selezione degli alert
    EventStore.ts         archivio locale + TTL
    demoSeed.ts           eventi fittizi della DEMO MODE
    sensors/
      SensorProvider.ts   interfaccia astratta (vendor-neutral)
      PhoneSensorProvider.ts
      DemoSensorProvider.ts
      stubs/index.ts      BLE, OBD, SmartTyre, CyberTyre (solo interfacce)
  net/api.ts              client backend opzionale
  ui/                     mappa, barra di stato, scheda segnalazione, alert
worker/                   Cloudflare Worker + schema D1 (NON deployato)
public/                   manifest, service worker, icone, header di sicurezza
```

---

## Sensori utilizzati

| Sensore | API | Uso | Note |
|---|---|---|---|
| GPS | `navigator.geolocation.watchPosition` | posizione, velocità, direzione | attivo **solo** durante il monitoraggio |
| Accelerometro | `devicemotion` → `accelerationIncludingGravity`, `acceleration` | rilevamento anomalie | elaborato a 50 Hz |
| Giroscopio | `devicemotion` → `rotationRate` | scarta gli urti causati dal telefono che si muove | opzionale |
| Orientamento | stimato dal vettore gravità | compensazione posizione telefono | nessuna calibrazione manuale |

### Compensazione dell'orientamento (niente calibrazione)

Il telefono può stare verticale, orizzontale o inclinato. Invece di chiedere una
procedura di calibrazione, ROAD SENSE stima il vettore gravità con un filtro
passa-basso e proietta su di esso l'accelerazione lineare:

```
g_t    = α · g_(t-1) + (1-α) · a_t          (α = 0.95)
a_vert = (a_lineare · g) / |g|
```

Dopo pochi secondi `g` punta verso il basso reale qualunque sia l'inclinazione.
Se il telefono viene riposizionato in viaggio, il filtro si riadatta da solo.

**START → GUIDA → STOP.** Nient'altro.

---

## Dati raccolti

Quando si genera un evento (automatico o manuale):

| Campo | Contenuto |
|---|---|
| `id` | UUID casuale dell'evento |
| `lat`, `lon` | coordinate **arrotondate a 5 decimali** (~1 m) |
| `ts` | istante del rilevamento |
| `type` | categoria (buca, acqua, ostacolo, …) |
| `severity` | 1–3 |
| `source` | `auto` o `manual` |
| `confidence` | affidabilità del singolo rilevamento |
| `heading` | direzione di marcia, per distinguere le carreggiate |
| `reporterId` | identificatore **anonimo a rotazione** (16 hex, cambia ogni 12 h) |
| `sensorData` | picco, durata impulso, velocità, rumore di fondo |

## Dati NON raccolti

Mai, da nessuna parte, né sul dispositivo né sul server:

- nome, email, numero di telefono, username;
- targa, VIN, identificativo del veicolo;
- identità reale, account, credenziali;
- **la traccia GPS del viaggio**;
- punto di partenza e destinazione;
- cronologia degli spostamenti;
- profili comportamentali;
- indirizzi IP conservati (vedi [PRIVACY.md](PRIVACY.md)).

> **Si inviano eventi, non tracce.** La posizione continua resta sul telefono e
> serve solo a disegnare la mappa, calcolare distanze e generare gli alert.

Dettagli completi: [PRIVACY.md](PRIVACY.md).

---

## Cartografia

ROAD SENSE usa **[OpenFreeMap](https://openfreemap.org/)** (stile *Dark*), tile
vettoriali derivate da dati OpenStreetMap, renderizzate con MapLibre GL.

Verificato il 22/09/2026: gratuito, **nessuna chiave API, nessuna
registrazione, nessun cookie, nessuna carta di credito**, nessun limite
dichiarato di richieste; codice del progetto sotto licenza MIT; esplicitamente
destinato a siti e applicazioni. L'attribuzione è obbligatoria ed è sempre
visibile in mappa.

### Perché non i server di OpenStreetMap

La v0.1.0 usava `tile.openstreetmap.org` e veniva **bloccata**:

```
x-blocked: Access denied. See https://operations.osmfoundation.org/policies/tiles/
```

Il blocco era corretto. Quei server sono gestiti da volontari e la loro
[Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
consente *"normal interactive viewing by a human"*, non l'uso da parte di
applicazioni distribuite. ROAD SENSE ne violava tre punti:

1. `Referrer-Policy: no-referrer` — la policy vieta esplicitamente di *"set a
   restrictive Referrer-Policy that prevents the HTTP Referer header being
   sent"*;
2. il service worker **memorizzava le tile** — la policy afferma che *"offline
   use is not permitted"*;
3. la policy richiede uno **User-Agent che identifichi l'applicazione**: una
   PWA non può impostarlo, quindi non può conformarsi.

La soluzione non è aggirare il blocco, ma usare una sorgente che consenta
questo tipo di applicazione. **I dati restano OpenStreetMap e l'attribuzione
resta obbligatoria.**

### Cambiare fornitore

La cartografia è astratta dietro `MapTileProvider` in
[`src/config/mapProviders.ts`](src/config/mapProviders.ts). L'astrazione copre
sia le sorgenti **vettoriali** sia quelle **raster**: cambiare fornitore — o
passare da vettoriale a raster — non richiede alcuna modifica a `MapView`.

```bash
VITE_MAP_PROVIDER=openfreemap-positron   # variante chiara
```

Se si aggiunge un fornitore con domini diversi, vanno aggiornati anche i
`hosts` del provider e la Content-Security-Policy in `public/_headers` e
`index.html`. Un test lo verifica.

---

## Limiti tecnici (dichiarati, non aggirati)

Una PWA non può fare tutto ciò che fa un'app nativa. Questi limiti sono reali:

| Limite | Effetto | Perché |
|---|---|---|
| **Nessuna esecuzione in background** | il monitoraggio si ferma se si esce dall'app o si spegne lo schermo | nessun browser garantisce `devicemotion` in background. ROAD SENSE richiede uno **Screen Wake Lock** dove disponibile, ma non può sostituirsi al sistema operativo |
| **iOS: permesso movimento** | su iPhone serve un tocco esplicito per attivare i sensori | `DeviceMotionEvent.requestPermission()` richiede un gesto utente e HTTPS |
| **iOS: direzione spesso assente** | `coords.heading` è frequentemente `null` | si ricade sul calcolo del bearing tra posizioni successive: affidabile solo in movimento |
| **Web Bluetooth assente su iOS** | `BleSensorProvider` resta uno stub | l'API non esiste su Safari |
| **Nessun grafo stradale** | un alert può riferirsi a una strada parallela vicina | non esiste routing gratuito e offline. Il filtro per cono frontale e direzione riduce il problema ma non lo elimina |
| **Niente notifiche push** | gli alert si vedono solo con l'app aperta | le push richiederebbero un servizio e una registrazione: incompatibili con "nessun account" |
| **HTTPS obbligatorio** | da `http://` non funzionano né GPS né sensori | requisito dei browser |
| **Mappa non disponibile offline** | senza rete l'app si apre ma senza sfondo cartografico | il service worker non memorizza cartografia, per scelta |
| **La mappa richiede WebGL** | su dispositivi molto datati potrebbe non funzionare | le tile vettoriali sono renderizzate da MapLibre GL |
| **Precisione GPS** | segnalazioni con precisione peggiore di 60 m vengono rifiutate | una segnalazione imprecisa è peggio di nessuna segnalazione |

---

## Consumo batteria

Uso automobilistico prolungato significa ore. Scelte esplicite:

- **GPS rilasciato allo STOP** — `clearWatch()` alla pressione di STOP, non un
  watch perenne. È la singola voce di consumo più pesante.
- **Accelerometro a 50 Hz elaborati** — il browser emette a 30–60 Hz, i campioni
  in eccesso vengono scartati prima di qualsiasi calcolo. Sotto i 50 Hz gli
  impulsi brevi da buca (50–200 ms) sfuggirebbero.
- **Nessun rendering continuo** — gli engine vivono in `useRef`, non in stato
  React. Si ridisegna solo quando cambia qualcosa di visibile.
- **Alert valutati a 1 Hz**, agganciati agli aggiornamenti GPS, non a un timer.
- **Marker aggiornati per differenza**, non ricreati a ogni ciclo.
- **Nessun polling di rete** — sincronizzazione al massimo ogni 90 secondi, e
  solo se ci si è spostati di oltre 2 km.
- **Nessun prefetch di tile** — si scarica solo ciò che è visibile.
- **Purge degli eventi scaduti una volta al minuto**, non a ogni frame.

---

## PWA

- installabile su Android/Chrome e iOS/Safari (Aggiungi a schermata Home);
- schermo intero, orientamento verticale, tema scuro;
- **offline shell**: aperta almeno una volta, si riapre anche senza rete, con
  eventi locali e segnalazione manuale funzionanti (**la mappa resta senza
  sfondo cartografico**: vedi sotto);
- **aggiornamenti mai forzati**: quando una nuova versione è pronta compare una
  barra e decide l'utente. Ricaricare l'app mentre qualcuno guida sarebbe
  inaccettabile;
- **il service worker non memorizza cartografia**: nessuna tile, nessuno
  stile, nessun glifo. Ogni richiesta verso un'origine diversa dalla propria
  non viene nemmeno intercettata. Costruirsi un archivio cartografico offline
  è un uso che ROAD SENSE non ha motivo di fare, e che diversi fornitori
  vietano espressamente.

---

## Backend collaborativo

**Nella v0.1.0 il backend è scritto ma NON deployato e disabilitato per
impostazione predefinita** (`VITE_API_BASE` vuoto). ROAD SENSE funziona
completamente in modalità solo-locale.

Il codice in `worker/` è pronto: Cloudflare Worker + D1, tre endpoint
(`POST /events`, `GET /events`, `POST /events/:id/confirm|gone`), validazione
lato server, rate limiting, TTL. Vedi [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Deployment

> Nessuna risorsa Cloudflare è stata creata o modificata. I passaggi seguenti
> vanno eseguiti manualmente e richiedono accesso all'account.

### Fase 1 — frontend (sufficiente per usare ROAD SENSE)

1. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**
2. Repository `pezzaliapp/ROADSENSE`, branch `main`
3. Build command: `npm run build` · Output directory: `dist`
4. Nessuna variabile d'ambiente necessaria
5. Custom domain: `roadsense.pezzalihub.app` (record CNAME verso Pages)

Risultato: ROAD SENSE pubblico su HTTPS, in modalità solo-locale, **costo 0 €**.

### Fase 2 — backend collaborativo (opzionale, v0.2.0)

```bash
npx wrangler d1 create roadsense
# copiare il database_id restituito in worker/wrangler.toml
npx wrangler d1 execute roadsense --remote --file=worker/schema.sql
npx wrangler secret put RATE_SALT        # stringa casuale lunga
npx wrangler deploy --config worker/wrangler.toml
```

Poi aggiungere una route `roadsense.pezzalihub.app/api/*` verso il Worker e
impostare `VITE_API_BASE=/api` nelle variabili di build di Pages.

> Servire il Worker **sullo stesso dominio** del frontend evita il CORS e
> mantiene valida la `connect-src 'self'` della Content Security Policy.

### Costo zero

| Servizio | Piano gratuito | Uso previsto |
|---|---|---|
| Cloudflare Pages | build e banda illimitata per siti statici | frontend |
| Cloudflare Workers | 100.000 richieste/giorno | API |
| Cloudflare D1 | 5 GB, 5 M righe lette/giorno, 100 k scritte/giorno | eventi |
| OpenStreetMap | uso moderato consentito | tile mappa |

Nessuna API a pagamento, nessuna chiave, nessuna carta di credito, nessun
servizio che possa generare costi superando una quota. Se una quota gratuita si
esaurisce Cloudflare **limita** il servizio, non addebita.

---

## Test

```bash
npm run test
```

Coprono la logica critica e i percorsi degradati:

- `geo.test.ts` — distanza, direzione, media circolare, formattazione
- `DetectionEngine.test.ts` — rilevamento, tutti i criteri di scarto, refrattario, fondo irregolare
- `ConfidenceEngine.test.ts` — aggregazione, saturazione, decadimento, TTL per categoria
- `AlertEngine.test.ts` — cono frontale, carreggiata opposta, distanza di anticipo, cooldown
- `validation.test.ts` — validazione e sanitizzazione degli eventi
- `EventStore.test.ts` — TTL, deduplicazione, persistenza, storage non disponibile
- `anonId.test.ts` — formato, rotazione, unicità
- `mapProviders.test.ts` — attribuzione obbligatoria, HTTPS, coerenza con la CSP, service worker che non memorizza cartografia
- `degradation.test.ts` — sensori mancanti, compensazione orientamento, backend assente, stub
- `demoPipeline.test.ts` — catena completa in DEMO MODE a tempo simulato

---

## Sicurezza

Vedi [SECURITY.md](SECURITY.md). In sintesi: HTTPS, Content Security Policy,
validazione server-side di ogni campo, limiti di payload, rate limiting,
nessun segreto nel frontend, nessun segreto nel repository.

---

## Documentazione

- [ARCHITECTURE.md](ARCHITECTURE.md) — architettura, algoritmi, scelte tecniche
- [PRIVACY.md](PRIVACY.md) — cosa viene raccolto e cosa no
- [SECURITY.md](SECURITY.md) — modello di sicurezza
- [ROADMAP.md](ROADMAP.md) — cosa arriva dopo

---

## Avvertenza

ROAD SENSE **non sostituisce** segnaletica stradale, autorità, servizi di
emergenza o i sistemi ADAS del veicolo. Non interagire con il telefono durante
la guida.

---

Dati cartografici © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
