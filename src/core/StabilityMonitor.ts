/**
 * ROAD SENSE - il telefono e' fermo nel veicolo?
 *
 * PERCHE' ESISTE
 * Il primo test su strada ha prodotto 257 eventi. Il motivo non era una soglia
 * troppo bassa: era che i criteri guardavano tutti l'IMPULSO, e un telefono
 * preso in mano produce impulsi perfetti - ampi, brevi, isolati, su fondo
 * tranquillo. Alzare la soglia avrebbe soltanto spostato il problema, perdendo
 * per giunta le buche vere.
 *
 * La differenza fra una buca e una mano non sta nell'impulso: sta nel
 * CONTESTO in cui accade.
 *
 *   un telefono in un supporto        una mano che lo prende
 *   ruota poco e come il veicolo      ruota molto e in modo indipendente
 *   viene spinto soprattutto in su    viene spinto in tutte le direzioni
 *   il veicolo e' in moto da un po'   puo' accadere anche da fermi
 *
 * Questo monitor osserva quelle tre cose e risponde a una sola domanda: in
 * questo istante ha senso attribuire alla STRADA cio' che sta succedendo?
 *
 * NON decide se c'e' una buca: quello resta del DetectionEngine. Qui si
 * stabilisce soltanto se le condizioni rendono la domanda sensata.
 *
 * SOGLIE PROVVISORIE: vedi DETECTION.stability in config/config.ts. Sono
 * ordini di grandezza fisici, non misure. Vanno validate su strada.
 */

import { DETECTION } from '../config/config';

/** Perche' i sensori non sono considerati affidabili in questo istante. */
export type InstabilityReason =
  /** Il telefono sta ruotando troppo per essere fermo in un supporto. */
  | 'rotazione'
  /** Manipolazione recente: si aspetta che tutto torni fermo. */
  | 'quarantena'
  /** Il veicolo non e' in moto, o non lo e' da abbastanza tempo. */
  | 'veicolo fermo';

export interface StabilityState {
  stable: boolean;
  reason: InstabilityReason | null;
  /** Massima rotazione osservata nella finestra recente, deg/s. */
  gyroMaxDps: number;
  /** Da quanto il veicolo e' continuativamente in moto, ms. */
  motionHoldMs: number;
  /** Millisecondi che mancano alla fine della quarantena, 0 se non attiva. */
  quarantineLeftMs: number;
}

interface GyroEntry {
  ts: number;
  dps: number;
}

export class StabilityMonitor {
  private gyro: GyroEntry[] = [];
  private quarantineUntil = Number.NEGATIVE_INFINITY;
  private movingSince: number | null = null;

  reset(): void {
    this.gyro = [];
    this.quarantineUntil = Number.NEGATIVE_INFINITY;
    this.movingSince = null;
  }

  /**
   * Aggiorna lo stato con un campione e restituisce la valutazione corrente.
   *
   * @param speedMps velocita' dal GPS, `null` se sconosciuta.
   */
  push(ts: number, rotationRate: number | null, speedMps: number | null): StabilityState {
    const cfg = DETECTION.stability;

    // -- rotazione: finestra scorrevole del massimo recente -------------------
    // Il giroscopio assente non viene trattato come "fermo": senza quel dato
    // non si puo' affermare che il telefono sia stabile, ma nemmeno accusarlo.
    // Si considera 0, come faceva il motore, e la verticalita' del picco resta
    // l'altro criterio a proteggere dalle manipolazioni.
    const dps = rotationRate !== null && Number.isFinite(rotationRate) ? Math.abs(rotationRate) : 0;
    this.gyro.push({ ts, dps });
    const cutoff = ts - cfg.windowMs;
    while (this.gyro.length > 0 && (this.gyro[0] as GyroEntry).ts < cutoff) this.gyro.shift();
    let gyroMaxDps = 0;
    for (const entry of this.gyro) if (entry.dps > gyroMaxDps) gyroMaxDps = entry.dps;

    // -- manipolazione forte: quarantena -------------------------------------
    // Non basta smettere di ruotare: dopo uno scossone la stima della gravita'
    // e il rumore di fondo restano sporchi per qualche secondo.
    if (dps >= cfg.manipulationDps) this.quarantineUntil = ts + cfg.quarantineMs;
    const quarantineLeftMs = Math.max(0, this.quarantineUntil - ts);

    // -- moto del veicolo, sostenuto nel tempo -------------------------------
    // Un singolo campione sopra soglia non prova nulla: a veicolo fermo il GPS
    // produce velocita' fantasma di pochi m/s per deriva del segnale.
    const moving =
      speedMps !== null && Number.isFinite(speedMps) && speedMps >= DETECTION.minSpeedMps;
    if (!moving) this.movingSince = null;
    else if (this.movingSince === null) this.movingSince = ts;
    const motionHoldMs = this.movingSince === null ? 0 : ts - this.movingSince;

    // -- verdetto -------------------------------------------------------------
    // L'ordine e' quello della causa piu' specifica: dire "veicolo fermo"
    // quando il telefono e' in mano sarebbe una diagnosi fuorviante.
    let reason: InstabilityReason | null = null;
    if (quarantineLeftMs > 0) reason = 'quarantena';
    else if (gyroMaxDps > cfg.gyroStableDps) reason = 'rotazione';
    else if (motionHoldMs < cfg.minMotionHoldMs) reason = 'veicolo fermo';

    return {
      stable: reason === null,
      reason,
      gyroMaxDps: Math.round(gyroMaxDps),
      motionHoldMs,
      quarantineLeftMs,
    };
  }
}

/**
 * Quota della componente verticale sull'accelerazione totale.
 *
 * Una buca spinge in su: la verticale e' la parte dominante. Una mano spinge
 * in tutte le direzioni. Torna `null` quando il dato totale manca, e in quel
 * caso il criterio semplicemente non si applica invece di inventare un valore.
 */
export function verticalShare(vertical: number | null, total: number | null): number | null {
  if (vertical === null || total === null) return null;
  if (!Number.isFinite(vertical) || !Number.isFinite(total)) return null;
  if (total <= 0.001) return null;
  return Math.min(1, Math.abs(vertical) / Math.abs(total));
}
