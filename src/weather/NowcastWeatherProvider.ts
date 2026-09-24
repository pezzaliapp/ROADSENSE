/**
 * ROAD SENSE - alert meteo reali letti da NOWCAST.
 *
 * DUE PROGETTI, UNA PORTA SOLA
 * NOWCAST e ROAD SENSE restano indipendenti: repository separati, deployment
 * separati, nessuna dipendenza di codice in nessuna direzione. L'unico punto
 * di contatto e' una GET su un endpoint pubblico di sola lettura. Se quella
 * porta e' chiusa, ROAD SENSE funziona esattamente come senza meteo.
 *
 * CHI DECIDE COSA
 *   NOWCAST    se il pericolo esiste, e se esiste ANCORA. La decisione nasce
 *              da punteggi, soglie, isteresi, vita della traccia, conferme di
 *              DWD e MeteoSwiss, veti: cose che ROAD SENSE non puo' valutare
 *              e non deve provare a valutare.
 *   ROAD SENSE se quel pericolo incrocia la strada, e quando.
 *
 * Per questo il contratto NON trasporta il punteggio: cio' che non arriva non
 * puo' essere interpretato per sbaglio.
 *
 * LA TRAIETTORIA NON SI RICOSTRUISCE
 * Ogni alert porta con se' il `cone` della cella, gia' proiettato dal motore
 * di NOWCAST. ROAD SENSE lo usa come viene.
 *
 * PRIVACY
 * La richiesta non ha parametri, ne' corpo, ne' credenziali: la posizione di
 * chi guida NON lascia il dispositivo. Il filtro geografico avviene qui, sui
 * dati ricevuti.
 */

import { WEATHER } from '../config/config';
import type { ConePoint, WeatherCell, WeatherKind, WeatherProvider } from './WeatherProvider';

/** Versione di contratto compresa da questa build. */
const CONTRATTO = 1;

/**
 * Pericoli NOWCAST che ROAD SENSE sa tradurre.
 * NOWCAST calcola anche `vento` e `supercella`, ma non ha soglie di
 * allertamento per quelli: non vengono mappati invece di essere indovinati.
 */
const HAZARD: Readonly<Record<string, WeatherKind>> = {
  grandine: 'hail',
  downburst: 'downburst',
};

/** Severita' dalla classificazione GIA' DECISA da NOWCAST, mai da punteggi. */
function severityFromLivello(livello: unknown): 1 | 2 | 3 {
  return livello === 'molto probabile' ? 3 : 2;
}

export interface NowcastEnvironment {
  /** GET del feed. Iniettabile per poter verificare il degrado senza rete. */
  get: (url: string, timeoutMs: number) => Promise<unknown>;
  now: () => number;
}

// -- lettura difensiva del JSON ---------------------------------------------
// Nulla di cio' che arriva dalla rete viene dato per buono.

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseCone(raw: unknown): ConePoint[] {
  if (!Array.isArray(raw)) return [];
  const out: ConePoint[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const minutes = num(item.minutes);
    const lat = num(item.lat);
    const lon = num(item.lon);
    const radiusKm = num(item.radius_km);
    if (minutes === null || lat === null || lon === null || radiusKm === null) continue;
    out.push({ minutes, lat, lon, radiusM: radiusKm * 1000 });
  }
  // L'ordine non e' garantito da nessuna specifica: lo si impone qui.
  out.sort((a, b) => a.minutes - b.minutes);
  return out;
}

/** Un alert NOWCAST diventa una `WeatherCell`, o niente. */
function toCell(raw: unknown): WeatherCell | null {
  if (!isObject(raw)) return null;

  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null;
  const kind = typeof raw.hazard === 'string' ? HAZARD[raw.hazard] : undefined;
  // Pericolo che ROAD SENSE non sa tradurre: si scarta, non si interpreta.
  if (id === null || kind === undefined) return null;

  const cella = raw.cella;
  if (!isObject(cella)) return null;

  const lat = num(cella.lat);
  const lon = num(cella.lon);
  const radiusKm = num(cella.radius_km);
  if (lat === null || lon === null || radiusKm === null || radiusKm <= 0) return null;

  const cone = parseCone(cella.cone);
  const speedKmh = num(cella.speed_kmh) ?? 0;
  const headingDeg = num(cella.heading_deg);
  // Moto non affidabile: nessuna direzione, invece di una direzione falsa.
  const affidabile = cella.moto_affidabile === true;

  return {
    id,
    kind,
    lat,
    lon,
    radiusM: radiusKm * 1000,
    driftHeading: affidabile ? headingDeg : null,
    driftSpeedMps: affidabile ? speedKmh / 3.6 : 0,
    ...(cone.length > 0 ? { cone } : {}),
    severity: severityFromLivello(raw.livello),
    // NOWCAST ha gia' deciso che questo pericolo va annunciato: e' per questo
    // che l'alert esiste. ROAD SENSE non rivaluta la decisione.
    announce: true,
    simulated: false,
  };
}

export class NowcastWeatherProvider implements WeatherProvider {
  readonly id = 'nowcast';
  readonly label = 'NOWCAST';

  private snapshot: WeatherCell[] = [];
  /** L'ultimo payload accolto era valido e utilizzabile. */
  private usable = false;
  /**
   * `frame_time` dell'ultimo frame accolto, come arriva da NOWCAST.
   *
   * E' un IDENTIFICATORE, non un istante: appartiene all'orologio di NOWCAST
   * e non viene mai confrontato con quello del telefono. Serve solo a
   * riconoscere se il frame e' cambiato.
   */
  private frameTime: number | null = null;
  /**
   * Quando ROAD SENSE ha ricevuto un frame NUOVO, sul proprio orologio.
   *
   * E' il riferimento per l'eta' del feed. Misurare `env.now() - receivedAt`
   * confronta due letture dello STESSO orologio; confrontare invece
   * `env.now()` con `frame_time` metterebbe a confronto due orologi diversi,
   * e in simulazione - o con l'ora del telefono sfasata - il risultato
   * sarebbe arbitrario. Nel verso peggiore, con il telefono indietro
   * rispetto a NOWCAST, la differenza diventa negativa e un feed vecchio non
   * scadrebbe mai.
   */
  private receivedAt: number | null = null;
  /** Orizzonte di previsione dichiarato da NOWCAST, ms. */
  private horizonMs = 0;
  /** Richieste fallite di seguito: governa l'attesa prima di riprovare. */
  private failures = 0;
  private inFlight = false;
  private reason: string | null = null;

  constructor(private readonly env: NowcastEnvironment = browserNowcastEnvironment()) {}

  get unavailableReason(): string | undefined {
    return this.reason ?? undefined;
  }

  isAvailable(): boolean {
    return this.usable && !this.isStale(this.env.now());
  }

  /**
   * Celle valide in questo istante.
   * Sincrona e pura, come impone il contratto: la rete vive in `refresh()`.
   */
  cells(now: number = this.env.now()): WeatherCell[] {
    if (!this.usable || this.isStale(now)) return [];
    return this.snapshot;
  }

  /**
   * Scarica il feed. Non solleva MAI: un guasto di NOWCAST non puo'
   * diventare un guasto di ROAD SENSE.
   */
  async refresh(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const payload = await this.env.get(WEATHER.nowcast.url, WEATHER.nowcast.timeoutMs);
      this.accept(payload);
      this.failures = 0;
    } catch {
      // Rete assente, timeout, CORS negato, 5xx: si tiene l'ultimo dato
      // valido finche' non scade da solo.
      this.failures++;
      this.reason = 'NOWCAST non raggiungibile.';
    } finally {
      this.inFlight = false;
    }
  }

  /** Attesa prima della prossima richiesta, con arretramento sugli errori. */
  nextDelayMs(): number {
    const { pollMs, backoffMs, jitterMs } = WEATHER.nowcast;
    const base = this.failures === 0 ? pollMs : (backoffMs[Math.min(this.failures, backoffMs.length) - 1] ?? pollMs);
    // Sfasamento casuale: senza, tutti i dispositivi chiamerebbero insieme.
    return base + (Math.random() * 2 - 1) * jitterMs;
  }

  /** Dimentica tutto: usata allo STOP. */
  reset(): void {
    this.snapshot = [];
    this.usable = false;
    this.frameTime = null;
    this.receivedAt = null;
    this.horizonMs = 0;
    this.failures = 0;
    this.reason = null;
  }

  // -- interni --------------------------------------------------------------

  private accept(payload: unknown): void {
    if (!isObject(payload)) return this.discard('Risposta NOWCAST non valida.');

    // Uno schema che non si conosce non si interpreta: si scarta.
    if (payload.contratto !== CONTRATTO) {
      return this.discard('Contratto NOWCAST non compatibile con questa versione.');
    }
    // NOWCAST dichiara i propri dati fermi: non si annuncia nulla.
    if (payload.dati_fermi === true) return this.discard('Dati NOWCAST fermi.');

    const frameTime = num(payload.frame_time);
    if (frameTime === null) return this.discard('Frame NOWCAST assente.');

    const orizzonte = num(payload.orizzonte_min);
    this.horizonMs = orizzonte !== null && orizzonte > 0 ? orizzonte * 60_000 : 0;

    // L'orologio locale riparte SOLO quando il frame cambia davvero.
    // Interrogare piu' spesso non deve poter ringiovanire un feed fermo: se
    // NOWCAST continua a restituire lo stesso frame, quel frame invecchia.
    if (frameTime !== this.frameTime) {
      this.frameTime = frameTime;
      this.receivedAt = this.env.now();
    }

    // `alerts` assente o di tipo sbagliato e' un contratto violato, non
    // "nessun fenomeno in corso": le due cose non vanno confuse.
    if (!Array.isArray(payload.alerts)) return this.discard('Elenco alert NOWCAST non valido.');

    const alerts = payload.alerts;
    const cells: WeatherCell[] = [];
    for (const alert of alerts) {
      const cell = toCell(alert);
      // Un alert malformato non invalida gli altri.
      if (cell) cells.push(cell);
    }
    this.snapshot = cells;
    this.usable = true;
    this.reason = null;
  }

  /**
   * Payload inutilizzabile: nessuna cella, ma la contabilita' del frame NON
   * viene toccata. Azzerarla permetterebbe a uno stesso frame, rifiutato e
   * poi riaccettato, di ripartire con un'eta' di zero.
   */
  private discard(reason: string): void {
    this.snapshot = [];
    this.usable = false;
    this.reason = reason;
  }

  /**
   * Un nowcast scaduto e' peggio di nessun nowcast: annuncerebbe un pericolo
   * dove non c'e' piu'. Oltre l'orizzonte dichiarato dal motore si tace.
   */
  private isStale(now: number): boolean {
    if (this.receivedAt === null) return true;
    if (this.horizonMs <= 0) return true;
    // Due letture dello stesso orologio: nessun confronto fra client e
    // NOWCAST, quindi nessuna sensibilita' allo sfasamento o alla
    // simulazione.
    return now - this.receivedAt > this.horizonMs;
  }
}

/** Ambiente reale: una GET, senza credenziali e senza parametri. */
export function browserNowcastEnvironment(): NowcastEnvironment {
  return {
    get: async (url, timeoutMs) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          cache: 'no-store',
          // Nessun cookie, nessuna credenziale, nessun referrer: NOWCAST non
          // deve poter distinguere un dispositivo da un altro.
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          mode: 'cors',
        });
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as unknown;
      } finally {
        clearTimeout(timer);
      }
    },
    now: () => Date.now(),
  };
}
