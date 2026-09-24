# ROAD SENSE — Privacy

v0.1.0 · Alessandro Pezzali

---

## Il principio

> **ROAD SENSE monitora LA STRADA, NON LE PERSONE.**

E la sua conseguenza operativa:

> **Si inviano EVENTI, non TRACCE.**

Non è una dichiarazione di intenti: è il modo in cui il software è costruito.
Il modello dati **non ha un campo** dove mettere un'identità, e la validazione
scarta ogni campo non previsto — anche se un client tentasse di inviarlo.

---

## Nessun account

Non esiste:

- registrazione;
- login;
- username o password;
- profilo;
- email di verifica;
- recupero password;
- cookie di sessione.

Si apre il link e funziona. Le richieste di rete partono con
`credentials: 'omit'`: nessun cookie viene mai inviato.

---

## Cosa resta sul dispositivo e non lo lascia mai

| Dato | Uso locale |
|---|---|
| **posizione continua (GPS)** | disegnare la mappa, calcolare distanze, generare alert |
| **velocità** | filtrare i rilevamenti e calcolare la distanza di anticipo |
| **direzione di marcia** | capire cosa è "davanti" |
| **campioni dell'accelerometro** | rilevare le anomalie |
| **stima del vettore gravità** | compensare l'inclinazione del telefono |
| **archivio eventi** | `localStorage`, cancellabile |

Il `DetectionEngine` lavora **interamente sul telefono**. I campioni dei
sensori — decine al secondo — non vengono mai trasmessi da nessuna parte.
Nessun machine learning cloud, nessuna API AI, nessun servizio a consumo.

---

## Cosa viene inviato, e solo quando

Un pacchetto parte **solo** quando viene generato un evento: un rilevamento
automatico confermato dall'euristica, oppure una segnalazione manuale.

```json
{
  "id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "lat": 45.46421,
  "lon": 9.19003,
  "ts": 1758543210000,
  "type": "pothole",
  "severity": 2,
  "source": "auto",
  "confidence": 0.45,
  "heading": 87.4,
  "reporterId": "a1b2c3d4e5f60718",
  "sensorData": { "peakVerticalAccel": 7.1, "impulseMs": 120, "speedMps": 13.8 }
}
```

Tutto qui. Un punto sulla strada, non un pezzo di viaggio.

### La richiesta di eventi vicini è volutamente imprecisa

Per ricevere gli eventi della zona, il client invia la propria posizione
**arrotondata a 2 decimali** — circa 1 km:

```
GET /events?lat=45.46&lon=9.19&radius=5000
```

Il server riceve quindi un'area, non un punto, e **non registra** la richiesta.

---

## La voce: l'unica cosa che può uscire dal telefono

È l'eccezione più importante di questo documento, e va detta per prima.

Il riconoscimento vocale dei browser è, per impostazione predefinita, un
**servizio remoto**: l'audio viene inviato a un servizio del browser per essere
trascritto. Non è una scelta di ROAD SENSE, è come funziona l'API.

Per questo ROAD SENSE:

- tiene la voce **spenta** finché non viene attivata esplicitamente;
- chiede l'**elaborazione locale** dove il browser la offre (`processLocally`);
- **non accende il microfono** se l'elaborazione locale non è disponibile e non
  è stato dato un consenso esplicito.

### Il consenso, parola per parola

Quando il browser **non** elabora la voce sul dispositivo, toccare `VOCE` non
accende niente. L'indicatore diventa `VOCE ?` e compare questo testo:

> Questo browser non elabora la voce sul dispositivo: l'audio verrebbe inviato
> a un servizio esterno. Tocca di nuovo VOCE per accettare.

Solo il **secondo** tocco autorizza, e allora compare:

> Voce attiva. L'audio è elaborato da un servizio esterno del browser, non da
> ROAD SENSE.

Il consenso **non viene ricordato** fra una sessione e l'altra: autorizzare
l'invio di audio a un servizio esterno va fatto consapevolmente, non ereditato
da una decisione presa settimane prima.

Quello che ROAD SENSE garantisce comunque:

- **la trascrizione non lascia mai il dispositivo.** Il campo `rawTranscript`
  viene scartato dalla validazione, che ricostruisce l'oggetto dai soli campi
  previsti. Nemmeno il pericolo, il soggetto o la corsia raggiungono il
  backend: parte solo l'evento come qualsiasi altro;
- nessun audio viene registrato, salvato o conservato da ROAD SENSE;
- la **sintesi** vocale — gli avvisi parlati — è locale e non invia nulla.

Se questo compromesso non è accettabile, la voce resta spenta e ROAD SENSE
funziona esattamente come prima.

## Cosa NON viene raccolto. Mai. Da nessuna parte

- nome, cognome, email, numero di telefono, username;
- targa, VIN, identificativo del veicolo, dati del costruttore;
- identità reale, documenti, credenziali;
- **la traccia GPS del viaggio** — non esiste, né sul server né sul telefono;
- punto di partenza e destinazione;
- cronologia degli spostamenti;
- orari abituali, luoghi frequentati, profili comportamentali;
- contatti, rubrica, foto, microfono, fotocamera;
- identificatori pubblicitari;
- fingerprinting del dispositivo;
- registrazioni audio: ROAD SENSE non ne conserva nessuna;
- trascrizioni di ciò che viene detto in auto: restano sul dispositivo.

Non ci sono analytics. Non ci sono tracker. Non ci sono script di terze parti:
la Content Security Policy consente il caricamento di codice **solo** dal
dominio di ROAD SENSE.

---

## L'identificatore anonimo

Per calcolare la confidenza serve sapere se due rilevamenti vengono da due
dispositivi diversi o dallo stesso che ripassa. Serve quindi un identificatore,
ma **non deve identificare la persona**.

| Caratteristica | Valore |
|---|---|
| formato | 16 caratteri esadecimali casuali |
| origine | `crypto.getRandomValues()` |
| legame con il dispositivo | **nessuno** (non deriva da hardware, IMEI, IP, account) |
| **rotazione** | **automatica ogni 12 ore** |
| memorizzazione | solo sul dispositivo |
| azzeramento | possibile in qualsiasi momento |

Dopo una rotazione lo stesso telefono appare come un segnalatore nuovo. Questo
rende il conteggio dei segnalatori leggermente ottimista: **è un compromesso
scelto deliberatamente a favore della privacy**, perché un identificatore
stabile permetterebbe di seguire un dispositivo nel tempo.

---

## Il server non ricorda i viaggi

Il database contiene tre tabelle e nessuna di esse può ricostruire un percorso:

| Tabella | Contenuto | Non contiene |
|---|---|---|
| `events` | punti sulla strada con categoria, istante, direzione, `reporter_id` anonimo | utenti, sessioni, percorsi |
| `event_votes` | un voto per segnalatore per evento | identità |
| `rate_buckets` | contatori a finestra di 60 s | indirizzi IP |

Non esiste una tabella degli utenti perché non esistono utenti.

Anche volendo, due eventi dello stesso `reporterId` non ricostruiscono un
viaggio: sono punti sparsi nel tempo, l'identificatore cambia ogni 12 ore e gli
eventi vengono cancellati alla scadenza del TTL.

### Gli indirizzi IP

Cloudflare, come qualsiasi infrastruttura di rete, vede l'indirizzo IP di chi
si connette. ROAD SENSE **non lo memorizza in nessuna forma leggibile**.

Per il rate limiting serve però distinguere i chiamanti. La chiave usata è:

```
SHA-256( indirizzo_IP + sale_segreto + data_del_giorno )  troncato a 16 caratteri
```

- non è reversibile;
- **non è correlabile tra giorni diversi** (il giorno entra nell'hash);
- non è correlabile senza il sale, che è un segreto del server;
- le righe vivono **60 secondi** e vengono cancellate di continuo.

Se il sale non è configurato, il rate limiting degrada a un limite globale: meno
efficace, mai peggiore per la privacy.

---

## DEMO MODE non tocca nulla di reale

Gli eventi generati in modalità demo:

- sono marcati `demo: true`;
- sono salvati in una **chiave di storage separata**;
- sono **rifiutati dalla validazione** lato server, quindi non possono essere
  memorizzati nemmeno se inviati per errore;
- non partono mai, perché il client li esclude prima dell'invio.

Sono **tre** barriere indipendenti, ed è verificato da test.

---

## Permessi richiesti

| Permesso | Quando | Se negato |
|---|---|---|
| **Posizione** | alla pressione di START | la mappa resta sul fallback e la segnalazione è disattivata; l'app non va in errore |
| **Movimento** (iOS) | alla pressione di START, da gesto utente | resta attiva la segnalazione manuale; niente rilevamento automatico |

Nessun permesso viene richiesto all'apertura. Nessun altro permesso viene
richiesto mai: niente fotocamera, microfono, contatti, notifiche, Bluetooth.

Alla pressione di **STOP** il GPS viene **rilasciato** (`clearWatch`) e
l'accelerometro scollegato. A monitoraggio fermo ROAD SENSE non osserva nulla.

---

## Controllo dei propri dati

- **cancellare tutto**: cancellare i dati del sito dal browser rimuove archivio
  eventi e identificatore anonimo;
- **disinstallare**: rimuovere la PWA rimuove tutto;
- **usare solo in locale**: è il comportamento **predefinito** della v0.1.0 —
  con `VITE_API_BASE` vuoto non parte alcuna chiamata di rete;
- **non c'è nulla da cancellare lato server**: gli eventi sono anonimi,
  scadono da soli e non sono riconducibili a una persona.

---

## Meteo: NOWCAST

Il meteo reale arriva da [NOWCAST](https://nowcast.pezzalihub.app/), un
progetto indipendente. ROAD SENSE lo interroga **in sola lettura**, e la
richiesta è deliberatamente muta:

- **nessun parametro e nessun corpo**: la posizione di chi guida **non lascia
  il dispositivo**. ROAD SENSE riceve tutti gli alert attivi e filtra in
  locale;
- **nessun cookie, nessuna credenziale, nessun referrer**
  (`credentials: 'omit'`, `referrerPolicy: 'no-referrer'`): NOWCAST non può
  distinguere un dispositivo da un altro;
- **nessuna autenticazione, nessun account, nessun identificatore**;
- una richiesta ogni cinque minuti, e **solo mentre il monitoraggio è attivo**:
  mai da fermi, mai a pagina nascosta, mai offline, mai in DEMO MODE.

Come per qualsiasi richiesta di rete, il server riceve l'indirizzo IP del
dispositivo: è inevitabile e va detto. Nient'altro viene trasmesso.

Se NOWCAST non risponde, il meteo semplicemente non compare. Nessun'altra
funzione di ROAD SENSE ne risente.

---

## Cartografia

La cartografia proviene da [OpenFreeMap](https://openfreemap.org/), con dati
OpenStreetMap. Come per qualsiasi mappa online, il server della cartografia
riceve la richiesta con l'IP del dispositivo: è inevitabile.

ROAD SENSE:

- non aggiunge alcun identificatore alle richieste;
- non invia cookie (OpenFreeMap dichiara di non usarne e non richiede
  registrazione né chiave API);
- non effettua prefetch: si scarica solo ciò che è visibile;
- non memorizza cartografia nel service worker.

### Una correzione rispetto alla v0.1.0

La v0.1.0 impostava `Referrer-Policy: no-referrer`. Ora è
`strict-origin-when-cross-origin`, quindi **il server della cartografia riceve
l'origine di ROAD SENSE** (es. `https://roadsense.pezzalihub.app/`), mai il
percorso o parametri.

Il motivo è dichiarato: i fornitori di cartografia hanno bisogno di sapere
quale applicazione li sta chiamando, e la Tile Usage Policy di OpenStreetMap
vieta esplicitamente una Referrer-Policy che impedisca l'invio del Referer.

È un'informazione in più rispetto a prima, ed è giusto dirlo. Non riguarda
comunque l'utente: identifica **l'applicazione**, non chi la usa. Verso
qualsiasi altra destinazione non viene inviato nulla, perché ROAD SENSE non
contatta nessun altro dominio.

---

## In sintesi

| Domanda | Risposta |
|---|---|
| Serve un account? | No |
| Si sa chi sono? | No |
| Si sa dove vado? | No |
| Si sa da dove vengo? | No |
| Il server conosce il mio percorso? | No — non esiste un percorso da nessuna parte |
| Cosa sa il server? | Che in un certo punto c'è una buca |
| Quanto a lungo? | Finché non scade il TTL della categoria |
| Posso usarlo senza inviare nulla? | Sì, ed è il comportamento predefinito |
