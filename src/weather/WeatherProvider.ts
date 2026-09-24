/**
 * ROAD SENSE - astrazione delle sorgenti meteo.
 *
 * DUE SORGENTI, UN SOLO CONTRATTO
 * - `DemoWeatherProvider` inventa celle e funziona solo in DEMO MODE;
 * - `NowcastWeatherProvider` legge alert REALI gia' decisi da NOWCAST.
 *
 * ROAD SENSE e NOWCAST restano due progetti indipendenti: il meteo entra da
 * una porta laterale, in sola lettura, e se quella porta e' chiusa ROAD SENSE
 * funziona esattamente come prima.
 *
 * CHI DECIDE COSA
 *   NOWCAST    se il pericolo meteorologico esiste, e se esiste ANCORA.
 *   ROAD SENSE se quel pericolo incrocia la strada di chi guida, e quando.
 *
 * ROAD SENSE non interpreta punteggi, soglie, isteresi, vita della cella o
 * conferme dei servizi meteo: sono decisioni che appartengono al motore che
 * le sa prendere. Per questo il contratto NON trasporta il punteggio.
 */

/**
 * Fenomeni che una sorgente meteo puo' segnalare sul percorso.
 *
 * `heavyRain` esiste solo per la demo: NOWCAST produce esclusivamente
 * grandine e downburst, e non si inventa una sorgente che non c'e'.
 */
export type WeatherKind = 'heavyRain' | 'hail' | 'downburst';

/**
 * Un punto della traiettoria prevista, come lo calcola NOWCAST.
 *
 * ROAD SENSE NON ricostruisce il moto della cella: lo riceve. Il raggio
 * cresce con i minuti perche' e' il cono di incertezza della previsione, non
 * la dimensione fisica del fenomeno.
 */
export interface ConePoint {
  /** Minuti dall'istante del frame meteo. */
  minutes: number;
  lat: number;
  lon: number;
  /** Raggio a quel minuto, in metri. */
  radiusM: number;
}

/**
 * Cella meteorologica: un'area circolare in movimento.
 *
 * E' volutamente un modello grossolano. Un nowcast reale produce mappe di
 * probabilita', non cerchi; ma per decidere "c'e' qualcosa di pericoloso
 * davanti a me entro N minuti" un'area e una deriva bastano, e mantengono il
 * modello leggibile.
 */
export interface WeatherCell {
  id: string;
  kind: WeatherKind;
  /** Centro dell'area. */
  lat: number;
  lon: number;
  /** Raggio dell'area, in metri. */
  radiusM: number;
  /**
   * Direzione di spostamento prevista, gradi 0..359. `null` se ignota.
   * Usata per la deriva lineare SOLO quando `cone` non c'e'.
   */
  driftHeading: number | null;
  /** Velocita' di spostamento prevista, m/s. Vedi nota su `driftHeading`. */
  driftSpeedMps: number;
  /**
   * Traiettoria prevista dalla sorgente meteo.
   *
   * Quando c'e', e' l'unica verita' sul moto della cella: centro e raggio si
   * leggono da qui, interpolando fra i punti. Quando manca - la demo non ne
   * ha - si ricade sulla deriva lineare, che resta il comportamento storico.
   */
  cone?: readonly ConePoint[];
  /**
   * Minuti previsti prima che il fenomeno interessi il percorso.
   *
   * Opzionale: lo valorizza solo la demo. Per i dati reali il tempo di
   * incontro lo calcola `forecastIntersection` contro il percorso, e NOWCAST
   * non espone nulla di equivalente.
   */
  etaMin?: number;
  /** 1 = debole, 2 = significativo, 3 = intenso. */
  severity: 1 | 2 | 3;
  /**
   * Tipo di evento stradale che questa cella potrebbe causare.
   * Serve a correlare due sorgenti indipendenti: se ROAD SENSE ha gia'
   * segnalazioni di quel tipo dentro l'area, l'avviso diventa molto piu'
   * attendibile.
   */
  correlatesWith?: 'water' | 'slippery';
  /**
   * Se false la cella viene DISEGNATA sulla mappa ma non genera mai un avviso.
   * Serve a tenere la narrazione semplice: si vede che il fenomeno esiste,
   * senza moltiplicare i banner.
   */
  announce: boolean;
  /** true per i dati inventati della demo, false per gli alert NOWCAST. */
  simulated: boolean;
}

export interface WeatherProvider {
  readonly id: string;
  readonly label: string;
  /** true solo se il provider puo' realmente fornire dati in questo momento. */
  isAvailable(): boolean;
  /**
   * Celle come si trovano NELL'ISTANTE `now`.
   *
   * La posizione restituita e' quella corrente, deriva gia' applicata: e' la
   * stessa che viene disegnata sulla mappa e la stessa da cui il motore fa
   * partire la previsione. Un'unica sorgente, cosi' non puo' esistere uno
   * scarto fra cio' che si vede e cio' che il modello calcola.
   *
   * Deve essere pura e SINCRONA: nessuna richiesta di rete, nessuna attesa,
   * nessun effetto collaterale.
   */
  cells(now?: number): WeatherCell[];
  /** Motivo per cui il provider non e' disponibile, mostrabile nella UI. */
  readonly unavailableReason?: string;
}
