/**
 * ROAD SENSE - segnaposto per una FUTURA integrazione con NOWCAST.
 *
 * QUESTO PROVIDER NON FA NULLA. Non effettua alcuna connessione, non conosce
 * alcun indirizzo, non importa alcun modulo di NOWCAST e non ha alcuna
 * configurazione. Esiste solo per fissare il punto di innesto.
 *
 * NOWCAST e ROAD SENSE restano due progetti INDIPENDENTI:
 * - repository separati;
 * - deployment separati;
 * - nessuna dipendenza in nessuna direzione.
 *
 * Un malfunzionamento di ROAD SENSE non puo' compromettere NOWCAST, perche'
 * ROAD SENSE non lo conosce. Quando e se l'integrazione avverra', il suo
 * fallimento dovra' degradare a "nessun dato meteo", esattamente come oggi
 * degrada l'assenza dell'accelerometro.
 */

import type { WeatherCell, WeatherProvider } from './WeatherProvider';

export class NowcastWeatherProvider implements WeatherProvider {
  readonly id = 'nowcast';
  readonly label = 'NOWCAST (futuro)';
  readonly unavailableReason =
    'Integrazione NOWCAST non presente nella v0.1.0: nessuna connessione viene effettuata.';

  isAvailable(): boolean {
    return false;
  }

  cells(): WeatherCell[] {
    return [];
  }
}
