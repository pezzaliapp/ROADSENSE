/**
 * ROAD SENSE - descrizione generica di un'area da disegnare sulla mappa.
 *
 * MapView consuma SOLO questo tipo: non sa cosa sia NOWCAST, ne' cosa sia il
 * meteo. Riceve "un'area con un raggio, un colore, un'etichetta e una
 * direzione di spostamento" e la disegna. La traduzione da cella meteo ad
 * area avviene fuori, in `weatherOverlay.ts`.
 *
 * Cosi' la logica della sorgente dati resta separata dal disegno, e domani
 * un'altra sorgente qualsiasi potra' disegnare aree senza toccare MapView.
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
}
