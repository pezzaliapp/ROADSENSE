# ROAD SENSE - BETA MASTER R1

**Documento:** ROAD-SENSE-BETA-MASTER-R1  
**Stato:** BASELINE CONGELATA  
**Scopo:** fonte unica di verita per requisiti, audit, implementazione e accettazione Beta  
**Change control:** gli ID non possono essere cancellati, rinominati o reinterpretati silenziosamente. Ogni modifica futura richiede nuova revisione (R2, R3...) e changelog.

---

## 0. PRINCIPI NON NEGOZIABILI

ROAD SENSE e un sistema cooperativo di assistenza alla guida.

Pipeline di prodotto:

**RILEVARE -> CONDIVIDERE -> CAPIRE LA STRADA -> PREVEDERE L'INCONTRO -> AVVISARE -> CONFERMARE/SCADERE**

Sorgenti:
- sensori smartphone;
- voce conducente;
- segnalazione manuale;
- altri veicoli ROAD SENSE;
- NOWCAST.

Durante la guida l'output primario deve essere vocale. La mappa e un supporto visivo, non un sostituto dell'avviso vocale.

Vincoli:
- zero API a pagamento;
- nessun servizio esterno a pagamento introdotto senza autorizzazione;
- privacy e minimizzazione dei dati;
- dati locali quando possibile;
- nessun deploy, DNS, Cloudflare, Worker, D1 o backend attivato senza autorizzazione esplicita;
- NOWCAST e congelato e non deve essere modificato da ROAD SENSE.

---

# A - CORE / SESSIONE

### CORE-01 - START
START avvia una sessione ROAD SENSE e, secondo disponibilita e permessi, GPS, sensori, detection, road awareness, EventStore, AlertEngine, voce, NOWCAST e futura sincronizzazione cooperativa.

### CORE-02 - STOP
STOP arresta realmente la sessione e rilascia SpeechRecognition, GPS watcher, sensor listener, timer, polling, recovery, Wake Lock e callback non piu valide.

### CORE-03 - START/STOP RIPETUTI
START -> STOP -> START non deve duplicare listener, timer, recognition, watcher, polling o alert.

### CORE-04 - DEGRADAZIONE
La perdita di una funzione non deve necessariamente fermare tutto: rete assente non blocca il rilevamento locale; voce indisponibile non blocca sensori/GPS.

---

# B - SENSORI E DETECTION

### SENSOR-01
Usare i sensori smartphone previsti dal progetto.

### SENSOR-02
La pipeline resta concettualmente SensorProvider -> SensorEngine -> DetectionEngine -> EventStore, salvo adattamento ai nomi reali del codice.

### SENSOR-03
Ogni detection deve essere geolocalizzata.

### SENSOR-04
Severity/confidence devono derivare dal motore centrale, non da logiche duplicate nella UI.

### SENSOR-05
Le soglie di detection non vanno modificate arbitrariamente durante altri interventi Beta.

### SENSOR-06
Detection compatibili dello stesso fenomeno devono poter essere aggregate/confermate anziche moltiplicate senza controllo.

---

# C - VOICE INPUT HANDS-FREE

### VOICE-IN-01
Dopo START il conducente non deve toccare lo smartphone per ogni segnalazione.

### VOICE-IN-02
Deve poter dire direttamente "Buca" senza wake word obbligatoria.

### VOICE-IN-03
Dopo una segnalazione valida ROAD SENSE deve rimanere o ridiventare disponibile automaticamente.

### VOICE-IN-04
Devono essere possibili piu segnalazioni consecutive senza nuovo touch.

### VOICE-IN-05
Velocita 0 non deve invalidare una segnalazione vocale valida.

### VOICE-IN-06
Interim/final/duplicate results non devono generare duplicati.

### VOICE-IN-07
Voce e manuale devono convergere sulla stessa tassonomia hazard centrale.

---

# D - LIFECYCLE MICROFONO

### VOICE-LIFE-01
Non deve tornare il vecchio ciclo start -> end/no-speech -> restart rapido -> tono Android -> ripetizione.

### VOICE-LIFE-02
Nessuna ricreazione aggressiva continua di SpeechRecognition.

### VOICE-LIFE-03
Recovery controllato con backoff/rate limit.

### VOICE-LIFE-04
Circuit breaker dopo errori ripetuti.

### VOICE-LIFE-05
STOP annulla ogni recovery.

### VOICE-LIFE-06
Durante interruzioni audio/telefonate nessun recovery aggressivo.

### VOICE-LIFE-07
Non assumere che continuous=true sia affidabile uniformemente su tutte le piattaforme.

---

# E - VOICE OUTPUT

### VOICE-OUT-01
Un alert rilevante durante la guida deve poter essere pronunciato; il solo marker non basta.

### VOICE-OUT-02
Evento locale pertinente: frase naturale equivalente a "Buca tra 150 metri."

### VOICE-OUT-03
Evento remoto pertinente: MAPPA + VOCE obbligatorie.

### VOICE-OUT-04
Supportare frasi per buca, ostacolo, acqua, incidente, lavori e altri hazard previsti.

### VOICE-OUT-05
Distanze pronunciate con arrotondamento naturale.

### VOICE-OUT-06
Gli avvisi non devono sovrapporsi.

### VOICE-OUT-07
Un alert in attesa deve essere rivalutato prima della pronuncia.

---

# F - SELF-LISTENING / TTS

### SELF-01
ROAD SENSE non deve trasformare la propria TTS in una nuova segnalazione.

### SELF-02
Durante TTS deve esistere uno stato equivalente a ROAD_SENSE_SPEAKING.

### SELF-03
Transcript prodotti durante TTS non diventano report.

### SELF-04
Dopo TTS l'ascolto recupera automaticamente quando tecnicamente possibile.

### SELF-05
Il normale recovery post-TTS non richiede un nuovo tocco.

---

# G - TELEFONATE / BLUETOOTH / CARPLAY / ASSISTENTI

### PHONE-01
Telefonate e sistema audio dell'auto hanno priorita su ROAD SENSE.

### PHONE-02
ROAD SENSE non deve impedire la risposta a una telefonata.

### PHONE-03
Il principio vale con Bluetooth, CarPlay e vivavoce, nei limiti esposti dal browser/OS.

### PHONE-04
Durante la telefonata ROAD SENSE non parla sopra la conversazione.

### PHONE-05
La conversazione non deve diventare una segnalazione ROAD SENSE.

### PHONE-06
Durante l'interruzione nessun tentativo continuo di riprendere il microfono.

### PHONE-07
Prevedere uno stato equivalente ad AUDIO_INTERRUPTED.

### PHONE-08
navigator.audioSession puo essere usato solo con capability detection; non e requisito universale.

### PHONE-09
visibilitychange da solo non prova l'esistenza di una telefonata.

### PHONE-10
Dopo l'interruzione: AUDIO_INTERRUPTED -> RECOVERING -> LISTENING quando la piattaforma lo consente.

### PHONE-11
Recovery post-chiamata senza touch quando tecnicamente possibile.

### PHONE-12
Siri/assistenti vocali vanno trattati come interruzioni prioritarie quando rilevabili.

---

# H - ALERT DURANTE INTERRUZIONI

### PHONE-ALERT-01
Niente TTS durante chiamata/interruzione audio prioritaria.

### PHONE-ALERT-02
Alert importante puo entrare in pending queue.

### PHONE-ALERT-03
Dopo l'interruzione deve essere rivalutato.

### PHONE-ALERT-04
Se ancora pertinente viene annunciato.

### PHONE-ALERT-05
Se expired, passed o off-route viene eliminato.

### PHONE-ALERT-06
Nessuna raffica di vecchi messaggi al termine della chiamata.

---

# I - EVENTSTORE

### EVENT-01
Ogni hazard ha identita e ciclo di vita.

### EVENT-02
Minimo: tipo, posizione, origine, timestamp, confidence, validita, stato.

### EVENT-03
Quando disponibili: segmento stradale, direzione, conferme.

### EVENT-04
Eventi/cluster non devono crescere indefinitamente senza una policy.

### EVENT-05
Il contatore UI deve dichiarare correttamente cosa misura: eventi, cluster o altro.

### EVENT-06
Eventi grezzi, cluster e hazard attivi devono essere concetti distinti nel modello/UI.

### EVENT-07
Eventi demo/test/storici non devono contaminare silenziosamente il conteggio operativo.

### EVENT-08
La persistenza deve avere una policy documentata e verificabile.

---

# J - LIFECYCLE EVENTI

### LIFE-01
Una segnalazione non resta valida per sempre.

### LIFE-02
Ciclo concettuale: NEW -> ACTIVE -> CONFIRMED/UPDATED -> STALE -> EXPIRED -> CLEANED, adattabile al modello reale.

### LIFE-03
Conferma aggiorna lastConfirmedAt o equivalente.

### LIFE-04
Conferma puo aumentare confidence.

### LIFE-05
Conferma puo estendere la validita.

### LIFE-06
La scadenza non coincide banalmente con la mezzanotte.

---

# K - TTL / DATA HYGIENE

### TTL-01
Hazard differenti possono avere TTL differenti.

### TTL-02
Una buca e potenzialmente persistente, ma il TTL deve essere compatibile con qualita/confidence dei dati.

### TTL-03
Ostacolo generalmente temporaneo.

### TTL-04
Acqua temporanea/dinamica.

### TTL-05
Incidente temporaneo.

### TTL-06
Lavori possono avere durata maggiore.

### TTL-07
NOWCAST usa freshness/validita del feed meteorologico.

### TTL-08
Policy TTL centralizzata e documentata.

### TTL-09
Dati prodotti da versioni precedenti con falsi positivi non devono restare hazard operativi per settimane senza una strategia di igiene/migrazione.

### TTL-10
TTL, confidence e riconferme devono essere progettati insieme per evitare sia accumulo sia cancellazione prematura di hazard persistenti.

---

# L - CLEANUP

### CLEAN-01
Evento expired non genera alert.

### CLEAN-02
Evento expired non compare fra gli hazard attivi sulla mappa.

### CLEAN-03
Evento expired viene eliminato/compattato dallo storage attivo secondo policy.

### CLEAN-04
Cleanup deve agire sul persistence layer, non solo sul rendering.

### CLEAN-05
Il conteggio operativo non cresce a causa di record expired/obsoleti.

### CLEAN-06
Cleanup all'avvio quando necessario.

### CLEAN-07
Cleanup periodico/in-session quando necessario.

### CLEAN-08
Dopo reload gli expired non ricompaiono.

### CLEAN-09
La mappa rappresenta rischi attuali, non l'intera storia.

---

# M - DEDUP / CLUSTER / CONFIDENCE

### DEDUP-01
Cinque segnalazioni compatibili non producono automaticamente cinque hazard indipendenti.

### DEDUP-02
Compatibilita considera almeno hazard, posizione, tempo e strada quando disponibile.

### DEDUP-03
Quando disponibili considera direzione/carreggiata.

### DEDUP-04
Evento compatibile -> merge/conferma.

### DEDUP-05
Evento distinto -> nuovo evento.

### DEDUP-06
Lo stesso dispositivo/sessione non aumenta artificialmente confidence tramite duplicati immediati.

### CONF-01
Confidence ha input, formula e soglie centralizzati/documentati.

### CONF-02
Confidence deve poter influenzare validita/alert/cluster in modo esplicito.

### CONF-03
Decay o riconferma devono essere valutati per hazard persistenti.

---

# N - ROAD AWARENESS

### ROAD-01
La sola distanza geografica non e sufficiente.

### ROAD-02
Usare quando disponibili GPS, heading, speed, geometria stradale, current segment, grafo/continuita e route.

### ROAD-03
Evento sulla stessa strada davanti -> candidato alert.

### ROAD-04
Evento su strada parallela -> nessun alert.

### ROAD-05
Evento dietro -> nessun alert.

### ROAD-06
Evento gia superato -> nessun alert.

### ROAD-07
Direzione/carreggiata opposta -> escludere quando determinabile con affidabilita.

### ROAD-08
Stati equivalenti a AHEAD_RELEVANT, BEHIND, OTHER_ROAD, OFF_ROUTE, OPPOSITE_DIRECTION, UNKNOWN.

### ROAD-09
UNKNOWN non significa automaticamente pericolo.

### ROAD-10
Map matching deve esprimere confidence; non fingere precisione quando i dati non bastano.

---

# O - FORWARD CORRIDOR / ROUTE

### ROUTE-01
ROAD SENSE funziona anche senza destinazione impostata.

### ROUTE-02
Senza route deve costruire un forward corridor plausibile da current segment + heading + continuita del grafo/geometria.

### ROUTE-03
Con route disponibile deve usarla.

### ROUTE-04
Hazard valutati contro percorso/corridoio, non solo cerchio GPS.

### ROUTE-05
A una biforcazione incerta non inventare una route certa.

### ROUTE-06
La lunghezza del corridor dipende almeno dalla velocita ed e limitata da policy centralizzata.

### ROUTE-07
Quando possibile usare distanza lungo strada/corridoio invece della sola distanza geodetica.

### ROUTE-08
Il calcolo road-awareness deve essere locale quando i dati necessari sono disponibili.

---

# P - WARNING DISTANCE / ETA

### WARN-01
Nessun raggio fisso universale.

### WARN-02
Considerare velocita, ETA, hazard, severity, confidence e contesto stradale.

### WARN-03
Concetto base: warning distance circa velocita x tempo utile, con limiti.

### WARN-04
In citta possono bastare centinaia di metri.

### WARN-05
Ad alta velocita puo servire anticipo chilometrico.

### WARN-06
Fino a circa 10 km puo avere senso per determinati rischi, non come raggio standard per ogni buca.

### WARN-07
Se ETA non e affidabile non va inventato.

---

# Q - ALERT ENGINE

### ALERT-01
Un unico sistema coerente di arbitration.

### ALERT-02
Pipeline: EVENT -> VALIDITY -> CONFIDENCE -> ROAD RELEVANCE -> DISTANCE/ETA -> SEVERITY -> PRIORITY -> COOLDOWN -> QUEUE -> VOICE + MAP.

### ALERT-03
Lo stesso evento non viene annunciato ad ogni GPS update.

### ALERT-04
Possibili fasi EARLY -> NEAR -> PASSED quando utili.

### ALERT-05
Passed -> niente ulteriori annunci.

### ALERT-06
Off-route in coda -> scarto.

### ALERT-07
Expired/stale in coda -> scarto.

### ALERT-08
Rischio imminente ha precedenza su rischio futuro meno urgente.

### ALERT-09
Road hazard e weather hazard devono passare da arbitration comune, non da una precedenza fissa e cieca.

---

# R - COOPERAZIONE FRA VEICOLI

### REMOTE-01
ROAD SENSE deve diventare realmente cooperativo.

### REMOTE-02
Veicolo A segnala/rileva un hazard.

### REMOTE-03
L'evento viene condiviso tramite infrastruttura autorizzata.

### REMOTE-04
Veicolo B riceve realmente l'evento su altro dispositivo.

### REMOTE-05
B verifica validita, confidence, strada, direzione, distanza/ETA.

### REMOTE-06
Se pertinente B vede il marker.

### REMOTE-07
Se pertinente B riceve anche VOCE.

### REMOTE-08
La sola mappa non soddisfa il requisito.

### REMOTE-09
Veicolo C su strada parallela -> niente voce.

### REMOTE-10
Evento dietro -> niente voce.

### REMOTE-11
Evento remoto expired -> niente voce e niente hazard attivo.

### REMOTE-12
Mock/localStorage/demo non valgono come comunicazione multi-device reale.

---

# S - NETWORK / BACKEND

### NET-01
Lo stato reale A->B deve essere sempre dichiarato senza simulazioni.

### NET-02
Backend disabilitato significa multi-device reale non disponibile.

### NET-03
Worker/D1/API esistenti vanno riusati/valutati prima di progettare altra infrastruttura.

### NET-04
Nessun backend attivato senza autorizzazione esplicita.

### NET-05
Sincronizzazione minimizza dati trasmessi.

### NET-06
Protezione da spam, flood, replay e duplicati.

### NET-07
Offline/reconnect non deve produrre flood di eventi vecchi.

### NET-08
Zero costi deve essere verificato prima dell'attivazione.

---

# T - NOWCAST: CONTRATTO CONGELATO

### NOW-01
NOWCAST non viene modificato da ROAD SENSE.

### NOW-02
ROAD SENSE e consumer read-only.

### NOW-03
Endpoint: GET https://nowcast.pezzalihub.app/api/road-alerts

### NOW-04
Nessuna posizione utente inviata a NOWCAST.

### NOW-05
Nessuna route inviata a NOWCAST.

### NOW-06
grandine -> hail; downburst -> downburst.

### NOW-07
Hazard sconosciuti scartati.

### NOW-08
dati_fermi=true -> feed non utilizzato per alert.

### NOW-09
Feed stale -> niente alert.

### NOW-10
Stesso frame riscaricato non diventa artificialmente fresco.

---

# U - NOWCAST POLLING

### NOW-POLL-01
Fetch immediato all'avvio del monitoraggio secondo implementazione prevista.

### NOW-POLL-02
Polling nominale 300 s.

### NOW-POLL-03
Jitter +/-30 s.

### NOW-POLL-04
Single in-flight.

### NOW-POLL-05
STOP -> niente polling.

### NOW-POLL-06
Offline -> niente polling inutile.

### NOW-POLL-07
Backoff 5 -> 10 -> 20 minuti secondo implementazione esistente.

### NOW-POLL-08
Nessun retry aggressivo.

---

# V - NOWCAST + STRADA

### NOW-ROAD-01
Se NOWCAST fornisce il cone, ROAD SENSE usa quel cone.

### NOW-ROAD-02
ROAD SENSE non ricostruisce una seconda previsione meteo.

### NOW-ROAD-03
Principio: NOWCAST decide se il fenomeno merita allarme; ROAD SENSE decide se l'allarme interseca la strada.

### NOW-ROAD-04
Valutazione: NOWCAST CONE ∩ ROUTE/FORWARD CORRIDOR.

### NOW-ROAD-05
Cone non pertinente -> nessun alert.

### NOW-ROAD-06
Fenomeno vicino ma non sul percorso -> nessun alert.

---

# W - NOWCAST FLOW

### NOW-FLOW-01
Pipeline: endpoint -> NowcastWeatherProvider -> schema validation -> freshness -> dati_fermi -> hazard mapping -> cone -> intersection -> ETA/lead -> priority -> AlertEngine -> queue -> MAPPA + VOCE.

### NOW-FLOW-02
La sola mappa non basta.

### NOW-FLOW-03
NOWCAST pertinente deve poter generare voce.

### NOW-FLOW-04
Con ETA affidabile: frase equivalente a "Grandine prevista sul percorso tra 12 minuti."

### NOW-FLOW-05
Senza ETA affidabile: frase senza tempo inventato.

### NOW-FLOW-06
Downburst: avviso vocale equivalente a "Possibile downburst sul percorso."

### NOW-FLOW-07
Non inventare ETA.

---

# X - NOWCAST DURANTE INTERRUZIONI

### NOW-PHONE-01
Durante telefonata niente TTS NOWCAST.

### NOW-PHONE-02
Alert puo entrare in pending queue.

### NOW-PHONE-03
Dopo chiamata rivalutare freshness, cone, route e ETA.

### NOW-PHONE-04
Ancora pertinente -> voce.

### NOW-PHONE-05
Non piu pertinente -> eliminazione.

---

# Y - OFFLINE

### OFF-01
Offline continuano quando tecnicamente disponibili GPS, sensori, detection, EventStore locale, road-awareness locale e alert locali.

### OFF-02
Offline non arrivano nuovi eventi cooperativi.

### OFF-03
Offline non arrivano nuovi dati NOWCAST.

### OFF-04
Dati meteo stale non sono presentati come nuovi.

### OFF-05
Ritorno online senza flood di alert/eventi vecchi.

### OFF-06
Non dichiarare SpeechRecognition offline se la piattaforma usa riconoscimento remoto.

---

# Z - BACKGROUND / LIFECYCLE PWA

### BG-01
Verificare separatamente Android PWA e iOS PWA.

### BG-02
Testare foreground, background, screen-off, cambio app e telefonata.

### BG-03
Non dichiarare supportata un'esecuzione che il browser sospende.

### BG-04
Se foreground e necessario per affidabilita, dichiararlo.

### BG-05
Wake Lock non equivale a background execution.

---

# AA - PWA / SERVICE WORKER

### PWA-01
Manifest/installabilita verificati.

### PWA-02
Service worker verificato.

### PWA-03
Strategia cache verificata.

### PWA-04
Nuovi deploy non devono lasciare indefinitamente tester su versioni obsolete.

### PWA-05
Offline shell degrada correttamente.

### PWA-06
CSP e Permissions-Policy verificate.

### PWA-07
Versione/build visibile in debug per sapere quale codice sta testando il dispositivo.

---

# AB - PRIVACY / SECURITY

### PRIV-01
Nessun audio conservato.

### PRIV-02
Transcript non conservati inutilmente.

### PRIV-03
Non dichiarare SpeechRecognition necessariamente locale.

### PRIV-04
Nessun GPS/route inviato a NOWCAST.

### PRIV-05
Rete cooperativa con minimo dato necessario.

### PRIV-06
Nessun account obbligatorio senza necessita tecnica reale.

### PRIV-07
Nessun tracking.

### PRIV-08
Payload remoti validati prima di entrare nel dominio eventi.

### PRIV-09
Nessun secret client-side.

---

# AC - COSTI

### COST-01
Nessuna API a pagamento.

### COST-02
Nessun servizio esterno a pagamento per voce, routing, meteo o sincronizzazione.

### COST-03
Worker/D1 devono essere valutati rispetto al vincolo zero-cost prima dell'attivazione.

---

# AD - DEBUG / OSSERVABILITA

### DEBUG-01
UI normale semplice.

### DEBUG-02
Debug Beta mostra almeno: voice state/lifecycle/transcript/error/recovery, TTS, audio interruption, GPS, speed, heading, current segment/map-match confidence, road relevance, distance/ETA, alert queue/drop reason, EventStore raw/cluster/active/expired, cleanup, NOWCAST fetch/freshness/cone/intersection.

### DEBUG-03
Debug non introduce persistenza inutile di dati personali.

### DEBUG-04
Il contatore deve distinguere almeno eventi grezzi, cluster e hazard attivi quando utile al test.

---

# AE - TEST AUTOMATICI

### TEST-VOICE-01
Hands-free e multi-command.

### TEST-VOICE-02
Duplicate/interim/no-speech/error/recovery/STOP.

### TEST-VOICE-03
Assenza del vecchio loop Android.

### TEST-VOICE-04
TTS/self-listening/recovery post-TTS.

### TEST-EVENT-01
TTL, expiry, dedup, confirmation, confidence.

### TEST-CLEAN-01
Expired -> no alert -> no active map -> no active storage -> no reload resurrection.

### TEST-ROAD-01
Same road ahead.

### TEST-ROAD-02
Same road behind.

### TEST-ROAD-03
Parallel road.

### TEST-ROAD-04
Opposite direction/carriageway quando determinabile.

### TEST-ROAD-05
Branch uncertainty / UNKNOWN.

### TEST-WARN-01
0, 30, 50, 90, 130 km/h.

### TEST-REMOTE-01
Remote event -> relevance -> MAPPA + TTS.

### TEST-PHONE-01
Interruption -> no TTS -> pending -> recovery.

### TEST-NOW-01
Empty/hail/downburst/stale/dati_fermi/same-frame.

### TEST-NOW-02
Cone intersect/miss/ETA/priority/offline/backoff/TTS.

### TEST-LIFE-01
START/STOP ripetuti senza zombie.

### TEST-PERF-01
Event/cluster volume non produce regressioni incompatibili con uso mobile.

---

# AF - TEST REALI SU DISPOSITIVO

### DEVICE-01 - SAMSUNG FOLD
START -> telefono non toccato -> "buca" -> evento -> seconda segnalazione -> niente nuovo touch -> niente loop tono -> TTS -> niente self-trigger.

### DEVICE-02 - ANDROID + BLUETOOTH
Telefonata -> nessuna interferenza -> fine chiamata -> recovery -> nuovo comando senza touch quando supportato.

### DEVICE-03 - IPHONE
Hands-free, multi-command, TTS, post-TTS recognition, telefonata e recovery nei limiti piattaforma.

### DEVICE-04 - CARPLAY
Telefonata tramite CarPlay -> ROAD SENSE non interferisce -> recovery post-call quando tecnicamente consentito.

### DEVICE-05 - DUE TELEFONI
Dopo autorizzazione backend: A segnala -> B riceve realmente -> stessa strada -> MAPPA + "Buca tra X metri".

### DEVICE-06 - STRADA PARALLELA
Evento vicino su altra strada -> nessuna voce.

### DEVICE-07 - CLEANUP
Expired -> sparisce da active map/storage -> non ricompare dopo reload.

### DEVICE-08 - NOWCAST REALE
Alert NOWCAST -> endpoint -> provider -> cone -> road-awareness -> AlertEngine -> MAPPA + VOCE se pertinente.

---

# AG - BETA GATES

Stati ammessi nella Traceability Matrix:
**PASS | PARTIAL | MISSING | BLOCKED | DEVICE TEST | BACKEND REQUIRED | PLATFORM LIMITATION**

### BETA-01
Hands-free reale dopo START.

### BETA-02
Piu comandi senza touch.

### BETA-03
Nessun vecchio loop Android.

### BETA-04
TTS senza self-listening e con recovery appropriato.

### BETA-05
Evento remoto pertinente -> MAPPA + VOCE.

### BETA-06
Strada parallela -> niente falso alert.

### BETA-07
Warning dinamico/ETA coerente.

### BETA-08
TTL/dedup/confidence coerenti.

### BETA-09
Expired eliminati dagli hazard attivi sulla mappa.

### BETA-10
Expired eliminati/compattati dallo storage attivo.

### BETA-11
Contatore/eventi/cluster comprensibili e dati sporchi non mantenuti operativi impropriamente.

### BETA-12
Telefonate Bluetooth non interferite.

### BETA-13
CarPlay non interferito nei limiti piattaforma.

### BETA-14
Recovery post-chiamata quando consentito.

### BETA-15
NOWCAST pertinente -> MAPPA + VOCE.

### BETA-16
NOWCAST non pertinente -> silenzio.

### BETA-17
Offline degrada correttamente.

### BETA-18
START/STOP senza leak.

### BETA-19
Stato multi-device dichiarato realmente, senza simulazioni.

### BETA-20
Nessuna modifica a NOWCAST.

### BETA-21
Road-awareness reale fuori dalla demo.

### BETA-22
Forward corridor reale o route utilizzabile fuori dalla demo.

---

# AH - SCENARIO DI ACCETTAZIONE FINALE

1. Il conducente preme START.
2. Mette via il telefono.
3. Dice "Buca".
4. ROAD SENSE registra/consolida l'evento.
5. Continua ad ascoltare o recupera automaticamente senza nuovo touch.
6. Un altro veicolo riceve realmente l'evento tramite backend autorizzato.
7. ROAD SENSE determina che l'hazard e davanti, sulla strada pertinente e valido.
8. Il secondo conducente vede il rischio e sente "Buca tra 150 metri" o equivalente.
9. Un veicolo su strada parallela non riceve l'avviso.
10. Hazard vecchi perdono validita, smettono di allertare e vengono rimossi/compattati secondo policy.
11. NOWCAST pubblica hail/downburst; ROAD SENSE scarica il feed senza inviare posizione/route.
12. ROAD SENSE confronta localmente cone e percorso/corridoio.
13. Se pertinente, MAPPA + VOCE; se non pertinente, silenzio.
14. Durante telefonata Bluetooth/CarPlay ROAD SENSE cede priorita audio, non parla e non interpreta la conversazione.
15. Terminata l'interruzione rivaluta gli alert e recupera quando la piattaforma lo consente.
16. STOP arresta correttamente la sessione.

---

# AI - KNOWN BASELINE R1
Questa sezione registra fatti accertati dall'audit del repository al 25/09/2026. NON sostituisce i requisiti sopra.

### BASE-01 - EVENT COUNTER
L'etichetta UI osservata come "389 EVENTI" mostra in realta `clusters.length`, quindi cluster e non eventi grezzi.

### BASE-02 - EVENT PERSISTENCE
EventStore usa localStorage (`roadsense.events.v1`; demo separata). `purge()` esiste, viene eseguito periodicamente e riscrive lo storage.

### BASE-03 - TTL ATTUALE
L'audit ha rilevato TTL attuale pothole = 45 giorni e rough = 30 giorni. L'accumulo osservato e legato soprattutto a falsi positivi storici ancora non scaduti, non all'assenza di purge.

### BASE-04 - CLUSTERING
Detection duplicate restano eventi distinti; la fusione avviene a livello cluster. Un merge radius ridotto puo lasciare molti cluster lungo il percorso.

### BASE-05 - VOICE ATTUALE
BrowserVoiceProvider usa una sessione per tocco, `continuous=false`; dopo il primo risultato la sessione si chiude. Multi-command hands-free non e attualmente soddisfatto.

### BASE-06 - VECCHIO LOOP ANDROID
L'audit non trova piu scheduleNext/restart automatici del vecchio ciclo rapido; il timer attuale chiude la sessione.

### BASE-07 - SELF LISTENING ATTUALE
Il recognizer viene chiuso/pausato prima della TTS, quindi self-listening non risulta attivo; effetto collaterale: la sessione vocale puo morire senza recovery automatico.

### BASE-08 - PHONE INTERRUPTION
Nessuna gestione esplicita di audioSession/interrupted/pagehide/blur/call recovery e stata trovata.

### BASE-09 - ROAD AWARENESS ATTUALE
Fuori dalla demo non risultano grafo stradale, map matching o routing reali. Il filtro attuale usa principalmente distanza + cono angolare/heading.

### BASE-10 - PARALLEL ROAD RISK
Una buca su strada parallela puo attualmente generare alert.

### BASE-11 - FORWARD CORRIDOR
`routeAheadFrom` e usato nella demo; fuori demo la route/ahead risulta null.

### BASE-12 - WARNING ATTUALE
`lookaheadMeters()` e speed-dependent con min/max, ma non risulta road-, hazard- o ETA-dependent.

### BASE-13 - ALERT ARBITRATION
L'arbitration attuale e grossolana: road alert puo bloccare weather alert; non risulta una queue generale con rivalutazione.

### BASE-14 - MULTI DEVICE
Client pipeline per eventi remoti esiste, ma API base e vuota e Worker/D1 non sono attivati: A -> B reale non e disponibile.

### BASE-15 - NOWCAST FETCH
NOWCAST e realmente interrogato dal consumer ROAD SENSE; endpoint e privacy read-only risultano corretti.

### BASE-16 - NOWCAST ROAD INTERSECTION
Fuori dalla demo manca il forward corridor; quindi la previsione "sul percorso tra N minuti" non e attualmente completa. Il controllo dell'area attuale puo funzionare.

### BASE-17 - NOWCAST PRIVACY
L'audit non rileva invio a NOWCAST di GPS, route, user/vehicle ID, cookie o credenziali.

### BASE-18 - OFFLINE ATTUALE
GPS/sensori/detection/EventStore/TTS possono funzionare localmente; tile mappa, riconoscimento vocale remoto, eventi remoti e NOWCAST richiedono rete secondo l'implementazione auditata.

### BASE-19 - TEST ATTUALI
Audit: 548 test in 26 file; nessun test device-dependent reale. I mock SpeechRecognition sono idealizzati.

### BASE-20 - PERFORMANCE
`buildClusters` e stato identificato come O(n^2); con centinaia di cluster il costo diventa rilevante.

### BASE-21 - REPOSITORY STATE
Audit eseguito su HEAD `5f8ecbb8ba7f74d95a20f55ed25bb0f7c0815ca3`, senza modifiche/commit/push/deploy durante l'audit.

---

# AJ - TRACEABILITY E CHANGE CONTROL

### TRACE-01
Ogni requisito di questa Master deve comparire nella Traceability Matrix.

### TRACE-02
Per ogni ID registrare:
- stato;
- evidenza/file/funzione;
- test esistente;
- gap;
- rischio regressione;
- moduli coinvolti;
- eventuale device test;
- eventuale backend requirement;
- risultato dopo implementazione.

### TRACE-03
Un requisito non dimostrato non puo essere marcato PASS.

### TRACE-04
Mock/demo non dimostrano funzionalita reale multi-device o device-specific.

### TRACE-05
Ogni implementazione futura deve indicare esplicitamente quali ID Master modifica/soddisfa.

### TRACE-06
Prima di commit/deploy deve essere eseguita regressione sui requisiti collegati.

### CHANGE-01
R1 e congelata.

### CHANGE-02
Nuovo requisito -> nuovo ID oppure nuova revisione documentata.

### CHANGE-03
Cambio semantico di un requisito -> R2 con changelog.

### CHANGE-04
Nessun ID viene riutilizzato con significato diverso.

### CHANGE-05
Le scoperte del codice vanno nella Baseline/Traceability; non devono riscrivere retroattivamente il requisito.

---

# AK - ORDINE DI LAVORO

L'ordine definitivo di implementazione deve derivare dalla Traceability Matrix e dalle dipendenze tecniche, non da preferenze estemporanee.

Prima di modificare il codice:
1. completare la Traceability Matrix R1;
2. identificare dipendenze;
3. definire una fase limitata;
4. implementare solo gli ID della fase;
5. eseguire test/regressioni;
6. aggiornare Traceability;
7. chiedere autorizzazione prima di commit/push/deploy/backend.

---

# FINE MASTER R1

**Regola finale:** se una futura istruzione operativa entra in conflitto con questa Master, Claude deve segnalarlo prima di modificare il codice. Non deve eliminare silenziosamente il requisito.
