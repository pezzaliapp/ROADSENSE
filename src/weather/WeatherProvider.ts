/**
 * ROAD SENSE - astrazione delle sorgenti meteo.
 *
 * STATO NELLA v0.1.0
 * ROAD SENSE **non e' collegato a NOWCAST**. Non esistono API, connessioni,
 * backend o dipendenze verso NOWCAST, e non devono essere introdotte.
 * L'unica implementazione attiva e' `DemoWeatherProvider`, che produce dati
 * inventati e funziona solo in DEMO MODE.
 *
 * PERCHE' ESISTE QUESTA INTERFACCIA
 * Per fissare il contratto prima di avere l'integrazione, e per dimostrare che
 * ROAD SENSE e NOWCAST restano due progetti indipendenti: il meteo entra da
 * una porta laterale, e se quella porta e' chiusa ROAD SENSE funziona
 * esattamente come prima.
 */

/** Fenomeni che una sorgente meteo puo' segnalare sul percorso. */
export type WeatherKind = 'heavyRain' | 'hail' | 'downburst';

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
  /** Direzione di spostamento prevista, gradi 0..359. `null` se ignota. */
  driftHeading: number | null;
  /** Velocita' di spostamento prevista, m/s. */
  driftSpeedMps: number;
  /** Minuti previsti prima che il fenomeno interessi il percorso. */
  etaMin: number;
  /** 1 = debole, 2 = significativo, 3 = intenso. */
  severity: 1 | 2 | 3;
  /**
   * Tipo di evento stradale che questa cella potrebbe causare.
   * Serve a correlare due sorgenti indipendenti: se ROAD SENSE ha gia'
   * segnalazioni di quel tipo dentro l'area, l'avviso diventa molto piu'
   * attendibile.
   */
  correlatesWith?: 'water' | 'slippery';
  /** Sempre true nella v0.1.0: sono dati simulati. */
  simulated: true;
}

export interface WeatherProvider {
  readonly id: string;
  readonly label: string;
  /**
   * true solo se il provider puo' realmente fornire dati.
   * Nella v0.1.0 e' true unicamente per il provider della demo.
   */
  isAvailable(): boolean;
  /**
   * Celle attualmente rilevanti. Deve essere una funzione pura e SINCRONA:
   * nessuna richiesta di rete, nessuna attesa, nessun effetto collaterale.
   */
  cells(now?: number): WeatherCell[];
  /** Motivo per cui il provider non e' disponibile, mostrabile nella UI. */
  readonly unavailableReason?: string;
}
