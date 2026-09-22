# ROAD SENSE — Sicurezza

v0.1.0 · Alessandro Pezzali

---

## Modello di minaccia

ROAD SENSE non ha account, non ha sessioni e non conserva dati personali:
**non c'è un'identità da rubare**. Le minacce concrete sono altre.

| Minaccia | Contromisura |
|---|---|
| Inquinamento dei dati (eventi falsi di massa) | validazione server-side, rate limiting, confidenza basata su segnalatori **indipendenti**, TTL, voto "non c'è più" |
| Payload malformati o giganti | limite 4 KB, massimo 20 eventi per richiesta, ogni campo validato e ritipizzato |
| XSS | nessun input testuale libero **esiste** nell'app; CSP che consente script solo dal proprio dominio |
| SQL injection | esclusivamente query parametrizzate (`prepare().bind()`) |
| Esfiltrazione di dati verso terzi | CSP che blocca ogni connessione esterna tranne il dominio della cartografia |
| Segreti esposti | il frontend **non ha** segreti; i segreti del Worker stanno in `wrangler secret` |
| Costi imprevisti | nessun servizio a consumo, nessun binding a pagamento, nessuna carta di credito |
| Abuso del rate limiting per tracciare | la chiave è un hash salato e giornaliero, mai un IP |

---

## Trasporto

- **HTTPS obbligatorio**. I browser non espongono geolocalizzazione né
  `devicemotion` su origini non sicure: da `http://` ROAD SENSE semplicemente
  non funziona.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `upgrade-insecure-requests` nella CSP.

---

## Content Security Policy

Applicata come **header HTTP** (`public/_headers`, letto da Cloudflare Pages) e
replicata in un `<meta>` per l'anteprima locale:

```
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
form-action 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://tiles.openfreemap.org;
connect-src 'self' https://tiles.openfreemap.org;
worker-src 'self' blob:;
manifest-src 'self';
upgrade-insecure-requests
```

Conseguenze volute:

- **nessuno script di terze parti** può essere caricato: niente analytics,
  niente tracker, niente CDN esterne;
- **nessuna connessione** verso domini diversi dal proprio e da quello della
  cartografia;
- la pagina non può essere incorniciata (`frame-ancestors 'none'`);
- non esistono form da dirottare (`form-action 'none'`).

### Le due concessioni

`style-src 'unsafe-inline'` è richiesta da MapLibre, che posiziona i marker e i
controlli tramite attributi `style` inline.

`worker-src blob:` è richiesta perché MapLibre crea il proprio worker di
rendering da una blob URL.

Il rischio residuo è basso — `script-src` resta rigido, `default-src` è `'self'`
e non esiste alcun punto in cui contenuto non fidato entri nel DOM: ROAD SENSE
non ha campi di testo liberi, e i marker vengono popolati con `textContent`, mai
con `innerHTML`. Restano però **concessioni reali**, documentate qui invece che
nascoste.

### Se il backend viene servito su un dominio diverso

`connect-src 'self'` lo bloccherebbe. Per questo la configurazione consigliata
serve il Worker **sullo stesso dominio** del frontend, su `/api/*`. In
alternativa occorre aggiungere esplicitamente l'origine del Worker alla CSP.

---

## Altri header

| Header | Valore | Funzione |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | niente interpretazione creativa dei tipi MIME |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | verso l'esterno viene inviata **solo l'origine**, mai il percorso. `no-referrer` è stato abbandonato perché impediva di identificare l'applicazione e viola la Tile Usage Policy di OpenStreetMap |
| `X-Frame-Options` | `DENY` | anti-clickjacking (compatibilità) |
| `Cross-Origin-Opener-Policy` | `same-origin` | isolamento del contesto di navigazione |
| `Permissions-Policy` | `geolocation=(self), accelerometer=(self), gyroscope=(self), camera=(), microphone=(), payment=(), usb=()` | **nega esplicitamente** ciò che ROAD SENSE non usa |

---

## Validazione degli input

> **Non ci si fida dei dati inviati dal client. Mai.**

Il modulo `src/core/validation.ts` è **condiviso** tra frontend e Worker: una
sola definizione, un solo comportamento, un solo posto da correggere.

Ogni evento in arrivo viene verificato su:

| Campo | Controllo |
|---|---|
| `id` | formato UUID v4 |
| `lat` / `lon` | numero finito, entro i range geografici, arrotondato a 5 decimali |
| `ts` | numero finito, non oltre 5 minuti nel futuro, non oltre 6 ore nel passato |
| `type` | appartenenza alla lista chiusa delle categorie |
| `severity` | esattamente 1, 2 o 3 |
| `source` | esattamente `auto` o `manual` |
| `confidence` | numero finito in [0, 1] |
| `heading` | `null` oppure numero in [0, 360) |
| `reporterId` | esattamente 16 caratteri esadecimali |
| `sensorData` | solo campi noti, ciascuno limitato a un intervallo plausibile |
| `demo` | se `true`, **evento rifiutato** |

**L'oggetto memorizzato viene ricostruito da zero** a partire dai soli campi
validati: qualunque proprietà aggiuntiva — `email`, `plate`, `track` — viene
scartata, non ignorata. Verificato da un test dedicato.

Anche le risposte **del proprio backend** vengono rivalidate dal client con lo
stesso modulo.

### Limiti di dimensione

| Limite | Valore |
|---|---|
| payload massimo | 4 KB (verificato su `content-length` **e** sul corpo effettivo) |
| eventi per richiesta | 20 |
| risultati per query | 300 |
| raggio massimo di query | 20 km |

---

## Rate limiting

Finestre di 60 secondi, contatori su D1:

| Operazione | Limite |
|---|---|
| invio eventi | 30 / minuto |
| interrogazioni | 60 / minuto |
| voti | 40 / minuto |

Risposta `429` con header `Retry-After`.

La chiave è `SHA-256(IP + sale segreto + giorno)` troncata a 16 caratteri: non
reversibile, non correlabile tra giorni diversi, righe cancellate di continuo.
**Nessun indirizzo IP viene memorizzato.** Se il sale non è configurato il
limite degrada a globale.

---

## Protezione dallo spam sui dati

Il rate limiting da solo non basta: chi volesse inquinare la mappa potrebbe
ruotare l'identificatore anonimo. La difesa vera è nel **`ConfidenceEngine`**:

- un solo segnalatore produce al massimo confidenza ≈ 0.35 — sotto la soglia di
  "probabile";
- ripassare molte volte con lo stesso identificatore è **limitato a un tetto**:
  non porta a un evento confermato (verificato da test);
- gli eventi **scadono** da soli (TTL per categoria);
- il voto "non c'è più" rimuove dalla distribuzione un evento smentito almeno
  due volte e più di quante sia stato confermato;
- una conferma prolunga la vita di un evento solo di 6 ore.

Un attacco su larga scala resta possibile con molti dispositivi reali. Sarebbe
affrontato — se dovesse accadere — con analisi di coerenza geografica e
temporale, non con un account: introdurre la registrazione distruggerebbe il
principio del progetto.

---

## Errori

Il Worker restituisce messaggi generici (`internal error`) e **non espone mai**
stack trace, query o struttura del database. Il client degrada silenziosamente:
backend assente, offline, 404 o JSON invalido portano tutti allo stesso
risultato — modalità solo-locale, nessun messaggio allarmante a chi guida.

---

## Segreti

> **Nessun segreto nel frontend. Nessun segreto nel repository.**

Il frontend **non ha** e non può avere segreti: è codice pubblico servito al
browser. Tutto ciò che inizia con `VITE_` finisce nel bundle, ed è per questo
che `.env.example` contiene solo `VITE_API_BASE`, che è un URL pubblico.

| Elemento | Dove sta |
|---|---|
| `RATE_SALT` | `wrangler secret put RATE_SALT` (mai su disco) |
| variabili locali del Worker | `.dev.vars` — in `.gitignore` |
| credenziali Cloudflare | solo nella sessione di `wrangler`, mai nel repository |
| `database_id` D1 | `wrangler.toml`, con valore segnaposto fino al deploy (non è un segreto: da solo non dà accesso) |

`.gitignore` esclude: `.env`, `.env.*` (tranne `.env.example`), `.dev.vars`,
`.wrangler/`, `node_modules/`, `dist/`.

### Verifica prima di ogni commit

```bash
git status
git diff --cached
grep -rInE "(api[_-]?key|secret|password|token|bearer|BEGIN .*PRIVATE KEY)" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist .
```

---

## Sicurezza durante la guida

È una questione di sicurezza a tutti gli effetti.

- l'app **non incentiva** l'interazione: a monitoraggio attivo il
  funzionamento è automatico;
- due soli pulsanti, alti 64 px, con alto contrasto;
- la segnalazione richiede **due tocchi**, senza campi di testo né conferme;
- gli alert **non richiedono alcuna interazione**: compaiono e spariscono da
  soli;
- nessun menu, nessuna impostazione da navigare, nessuna notifica ripetuta
  (cooldown di 120 secondi per evento);
- disclaimer permanente: ROAD SENSE **non sostituisce** segnaletica stradale,
  autorità, servizi di emergenza o i sistemi ADAS del veicolo.

---

## Dipendenze

Tre dipendenze di produzione: `react`, `react-dom`, `maplibre-gl`.

Meno dipendenze significa meno superficie di attacco e meno aggiornamenti di
sicurezza da inseguire. Il service worker, le icone e la validazione sono
scritti a mano proprio per questo.

```bash
npm audit    # atteso: 0 vulnerabilità
```

---

## Segnalare un problema di sicurezza

Aprire una issue su <https://github.com/pezzaliapp/ROADSENSE> **senza** includere
dettagli sfruttabili, chiedendo un contatto privato per la descrizione completa.
