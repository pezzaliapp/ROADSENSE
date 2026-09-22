/**
 * ROAD SENSE - sorgente meteo SIMULATA della DEMO MODE.
 *
 * Produce due o tre celle collocate sul percorso demo, per rendere visibile in
 * pochi secondi l'idea di ROAD WEATHER INTELLIGENCE:
 *
 *   ROAD SENSE dice cosa c'e' SULLA strada.
 *   NOWCAST direbbe cosa sta arrivando SOPRA la strada.
 *   Insieme avvisano prima di arrivarci.
 *
 * I dati sono INVENTATI e generati localmente: nessuna richiesta di rete,
 * nessuna chiave, nessun servizio. Il provider e' sincrono proprio per
 * rendere impossibile, per costruzione, una chiamata remota.
 *
 * Attivo esclusivamente in DEMO MODE.
 */

import { DEMO } from '../config/config';
import { positionAtDistance, ROUTE_LENGTH_M } from '../demo/route';
import { destinationPoint, normalizeDeg } from '../core/geo';
import { cellCentreAt } from './intersection';
import type { WeatherCell, WeatherProvider } from './WeatherProvider';

interface CellSpec {
  id: string;
  kind: WeatherCell['kind'];
  /** Posizione lungo il percorso, come frazione della lunghezza totale. */
  at: number;
  radiusM: number;
  /** Scostamento del centro dalla carreggiata, in metri: la cella non e'
   *  centrata sulla strada, la attraversa. */
  offsetM: number;
  offsetBearingOffsetDeg: number;
  /**
   * Inclinazione della deriva rispetto alla direzione "verso la strada".
   * La direzione di base NON e' scritta a mano: e' ricavata dalla geometria
   * (l'opposto dello scostamento), cosi' la cella punta sempre verso il
   * percorso. Questo valore serve solo a non renderla perfettamente
   * perpendicolare, che sarebbe innaturale.
   */
  driftSkewDeg: number;
  etaMin: number;
  severity: 1 | 2 | 3;
  correlatesWith?: 'water' | 'slippery';
  /** false = area visibile sulla mappa, ma nessun banner. */
  announce: boolean;
}

/**
 * Le posizioni sono scelte perche' la narrazione sia leggibile in 20-30
 * secondi partendo dall'inizio del percorso:
 *
 *  1. la cella di PIOGGIA INTENSA coincide con il punto in cui ROAD SENSE ha
 *     gia' segnalazioni di acqua: e' l'esempio della CORRELAZIONE fra due
 *     sorgenti indipendenti, ed e' il primo avviso che compare;
 *  2. la GRANDINE e' l'esempio del preavviso puro, senza conferme dalla strada;
 *  3. il DOWNBURST e' il piu' lontano lungo il percorso: mostra il preavviso
 *     a chilometri di distanza, che e' il caso d'uso vero.
 *
 * NOTA sulla geometria: l'anello di Milano e' compatto (poco piu' di un
 * chilometro di diametro) e si ripiega su se' stesso, quindi la distanza in
 * linea d'aria e' molto minore di quella percorsa. Le posizioni sono state
 * misurate, non stimate: la cella di pioggia si annuncia a circa 1,3 km, che
 * e' l'unico punto del tracciato dove un preavviso meteo ha una distanza
 * realistica.
 */
const SPECS: CellSpec[] = [
  {
    id: 'demo-rain',
    kind: 'heavyRain',
    at: 0.42,
    radiusM: 520,
    offsetM: 260,
    offsetBearingOffsetDeg: 80,
    driftSkewDeg: 22,
    etaMin: 4,
    severity: 3,
    correlatesWith: 'water',
    announce: true,
  },
  {
    id: 'demo-hail',
    kind: 'hail',
    at: 0.22,
    radiusM: 430,
    offsetM: 500,
    offsetBearingOffsetDeg: -75,
    driftSkewDeg: -18,
    etaMin: 8,
    severity: 3,
    announce: true,
  },
  {
    id: 'demo-downburst',
    kind: 'downburst',
    at: 0.62,
    radiusM: 360,
    offsetM: 700,
    offsetBearingOffsetDeg: 85,
    driftSkewDeg: 26,
    etaMin: 14,
    severity: 2,
    // Ora avvisa, ma solo se la previsione dice che il percorso incrocera'
    // davvero la cella: e' il filtro a tenere corta la narrazione, non un
    // interruttore.
    announce: true,
  },
];

/**
 * Velocita' media del veicolo simulato, usata per dimensionare la deriva
 * delle celle. Non e' la velocita' istantanea, che varia: e' il valore su cui
 * si costruisce lo scenario.
 */
const NOMINAL_VEHICLE_SPEED_MPS = (DEMO.minSpeedMps + DEMO.maxSpeedMps) / 2;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export class DemoWeatherProvider implements WeatherProvider {
  readonly id = 'demo-weather';
  readonly label = 'Road Weather (simulazione)';

  /** Celle come si trovano all'istante zero dello scenario. */
  private readonly base: WeatherCell[];
  /**
   * Istante in cui lo scenario e' partito. Finche' e' null le celle restano
   * ferme al tempo zero: la deriva comincia con il monitoraggio, cosi' la
   * demo e' deterministica e ripetibile.
   */
  private startedAt: number | null = null;

  constructor() {
    this.base = SPECS.map((spec) => {
      const onRoute = positionAtDistance(spec.at * ROUTE_LENGTH_M);
      // Il centro e' spostato a lato: la cella attraversa il percorso invece
      // di esservi appoggiata sopra, come accade a un fenomeno reale.
      const routeDistanceM = spec.at * ROUTE_LENGTH_M;
      const offsetBearing = normalizeDeg(onRoute.heading + spec.offsetBearingOffsetDeg);
      const center = destinationPoint(onRoute, offsetBearing, spec.offsetM);
      // La deriva e' l'opposto dello scostamento, con una leggera
      // inclinazione: per costruzione la cella si sta muovendo VERSO la
      // strada, che e' l'unica ragione per cui vale la pena avvisare.
      const driftHeading = normalizeDeg(offsetBearing + 180 + spec.driftSkewDeg);

      // La VELOCITA' della cella non e' scelta a caso: e' ricavata dalla
      // geometria in modo che la cella raggiunga la strada all'incirca quando
      // ci arriva il veicolo. E' una scelta di scenario, dichiarata: la demo
      // deve mostrare un incontro che avviene davvero, e con velocita' prese
      // a caso la cella spazzava la strada e se ne andava prima dell'arrivo.
      const vehicleEtaSec = Math.max(30, routeDistanceM / NOMINAL_VEHICLE_SPEED_MPS);
      const driftSpeedMps = clamp(spec.offsetM / vehicleEtaSec, 1, 12);
      return {
        id: spec.id,
        kind: spec.kind,
        lat: center.lat,
        lon: center.lon,
        radiusM: spec.radiusM,
        driftHeading,
        driftSpeedMps,
        etaMin: spec.etaMin,
        severity: spec.severity,
        announce: spec.announce,
        ...(spec.correlatesWith ? { correlatesWith: spec.correlatesWith } : {}),
        simulated: true as const,
      };
    });
  }

  isAvailable(): boolean {
    return true;
  }

  /** Avvia l'orologio dello scenario. */
  start(nowMs: number): void {
    this.startedAt = nowMs;
  }

  /** Ferma l'orologio e riporta le celle al tempo zero. */
  stop(): void {
    this.startedAt = null;
  }

  /** Secondi trascorsi dall'avvio dello scenario. */
  elapsedSec(now: number = Date.now()): number {
    return this.startedAt === null ? 0 : Math.max(0, (now - this.startedAt) / 1000);
  }

  /**
   * Celle nell'istante richiesto, con la deriva gia' applicata.
   *
   * E' l'UNICA sorgente di posizione: lo stesso array alimenta il disegno
   * sulla mappa e la previsione dell'incontro. Se un giorno queste due cose
   * divergessero, sarebbe perche' qualcuno ha smesso di usare questa
   * funzione, non perche' i due calcoli si sono disallineati.
   */
  cells(now: number = Date.now()): WeatherCell[] {
    const elapsed = this.elapsedSec(now);
    return this.base.map((c) => {
      const p = cellCentreAt(c, elapsed);
      return { ...c, lat: p.lat, lon: p.lon };
    });
  }
}
