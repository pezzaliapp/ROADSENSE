-- ROAD SENSE - schema D1.
--
-- CONTENUTO: soltanto eventi stradali. Nessun utente, nessuna sessione,
-- nessuna traccia, nessun indirizzo IP, nessuna cronologia di viaggio.
--
-- `reporter_id` e' l'identificatore anonimo a rotazione generato dal client
-- (16 hex casuali, cambia ogni 12 ore). Serve unicamente a contare segnalatori
-- indipendenti nel calcolo della confidenza.

CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,           -- UUID generato dal client
  lat           REAL NOT NULL,
  lon           REAL NOT NULL,
  ts            INTEGER NOT NULL,           -- epoch ms del rilevamento
  type          TEXT NOT NULL,
  severity      INTEGER NOT NULL,           -- 1..3
  source        TEXT NOT NULL,              -- 'auto' | 'manual'
  confidence    REAL NOT NULL,              -- 0..1, del singolo rilevamento
  heading       REAL,                       -- 0..359, NULL se ignota
  reporter_id   TEXT NOT NULL,
  peak_accel    REAL,
  impulse_ms    INTEGER,
  speed_mps     REAL,
  baseline_rms  REAL,
  expires_at    INTEGER NOT NULL,           -- epoch ms, TTL per categoria
  confirms      INTEGER NOT NULL DEFAULT 0, -- "c'e' ancora"
  denials       INTEGER NOT NULL DEFAULT 0  -- "non c'e' piu'"
);

-- Le query sono sempre "eventi vivi in un riquadro": indice su expires_at + lat.
CREATE INDEX IF NOT EXISTS idx_events_alive ON events (expires_at, lat, lon);
CREATE INDEX IF NOT EXISTS idx_events_lat_lon ON events (lat, lon);

-- Voti su un evento. Impedisce a uno stesso segnalatore di votare piu' volte.
CREATE TABLE IF NOT EXISTS event_votes (
  event_id    TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  vote        INTEGER NOT NULL,             -- +1 conferma, -1 non piu' presente
  ts          INTEGER NOT NULL,
  PRIMARY KEY (event_id, reporter_id)
);

-- Contatori di rate limiting. NON contengono indirizzi IP: solo un hash
-- troncato, salato con un segreto e con la data del giorno, quindi non
-- reversibile e non correlabile tra giorni diversi. Le righe vengono cancellate
-- di continuo (vedi purge nel Worker).
CREATE TABLE IF NOT EXISTS rate_buckets (
  bucket_key TEXT PRIMARY KEY,              -- hash troncato + finestra temporale
  count      INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_expiry ON rate_buckets (expires_at);
