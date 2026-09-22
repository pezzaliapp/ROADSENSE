/**
 * ROAD SENSE - descrizione generica di un'area da disegnare sulla mappa.
 *
 * MapView consuma SOLO questo tipo: non sa cosa sia NOWCAST, ne' cosa sia il
 * meteo. Riceve "un'area con un raggio, un colore, un'etichetta, una direzione
 * di spostamento e qualche tratto visivo" e la disegna. La traduzione da cella
 * meteo ad area avviene fuori, in `weatherOverlay.ts`.
 *
 * I tratti visivi sono descritti in termini generici - punti interni, vettori
 * radiali, pulsazione del bordo - proprio per non far entrare la semantica del
 * fenomeno dentro il disegno.
 *
 * NOTA IMPORTANTE: `lat`/`lon` sono la posizione CORRENTE dell'area, la stessa
 * usata dal motore di previsione. Non e' una posizione "grafica" separata.
 */
export interface AreaOverlay {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
  color: string;
  /** Direzione di spostamento prevista, gradi. `null` se l'area e' ferma. */
  driftHeading: number | null;
  /** Simbolo mostrato sul badge. */
  glyph: string;
  /** Riga superiore del badge (piccola). */
  caption: string;
  /** Riga inferiore del badge (in evidenza). */
  label: string;

  // -- tratti visivi --------------------------------------------------------

  /** Opacita' del riempimento, 0..1. Tenuta bassa: sotto c'e' la strada. */
  fillOpacity: number;
  /** Ampiezza della pulsazione del bordo, 0..1. 0 = bordo fermo. */
  pulse: number;
  /** Quanti punti interni discreti disegnare. 0 = nessuno. */
  speckles: number;
  /** Quanti vettori radiali che si espandono dal centro. 0 = nessuno. */
  gusts: number;
  /**
   * Avanzamento dell'animazione, 0..1, ciclico.
   * Arriva dall'esterno: MapView non possiede alcun orologio proprio, cosi'
   * disegno e modello restano governati dallo stesso tempo.
   */
  phase: number;
}
