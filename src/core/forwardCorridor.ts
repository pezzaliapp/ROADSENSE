/**
 * ROAD SENSE - il corridoio davanti al veicolo.
 *
 * Risolve ROUTE-02: costruire, durante la guida reale e senza destinazione
 * impostata, una rappresentazione locale e plausibile della strada davanti.
 * Fino a questa fase, fuori dalla DEMO MODE, il percorso era `null` e ogni
 * previsione di incontro - stradale e meteo - era inattiva.
 *
 * DUE SORGENTI, TENUTE SEPARATE PER SCELTA
 *
 *   road-geometry  la geometria stradale che la mappa ha gia' scaricato per
 *                  disegnare. E' l'unica che puo' costituire EVIDENZA che un
 *                  evento si trovi sulla stessa strada.
 *
 *   heading        una proiezione da posizione, direzione e velocita'. Serve
 *                  a prevedere un incontro quando la geometria non c'e', ma
 *                  NON dimostra nulla sulla strada: a trenta metri da una
 *                  parallela, quel corridoio comprende entrambe.
 *
 * `roadEvidence` distingue le due cose, e nessun chiamante deve promuovere un
 * corridoio `heading` a prova di pertinenza stradale. E' la ragione per cui
 * il campo esiste invece di essere dedotto da `source`.
 *
 * NESSUNA RICHIESTA DI RETE
 * Questo modulo non contatta niente e non sa da dove venga la geometria: la
 * riceve gia' pronta. Chi la fornisce usa esclusivamente i tile caricati per
 * la normale visualizzazione.
 */

import { CORRIDOR } from '../config/config';
import { angleDeltaDeg, bearingDeg, destinationPoint, distanceM } from './geo';

export interface LatLon {
  lat: number;
  lon: number;
}

/** Un tratto di strada, come arriva dalla cartografia. */
export interface RoadPolyline {
  readonly points: readonly LatLon[];
}

/**
 * Da dove viene il corridoio. Non e' un dettaglio implementativo: decide se
 * il corridoio possa essere usato come evidenza di pertinenza stradale.
 */
export type CorridorSource = 'road-geometry' | 'heading' | 'none';

/**
 *   reliable     agganciato alla strada, proseguimento non ambiguo
 *   uncertain    proiezione, oppure interrotto da una biforcazione
 *   unavailable  evidenza insufficiente: non si costruisce nulla
 */
export type CorridorStatus = 'reliable' | 'uncertain' | 'unavailable';

export interface CorridorPoint extends LatLon {
  /** Distanza percorsa lungo il corridoio dal veicolo, m. */
  atM: number;
}

export interface ForwardCorridor {
  points: readonly CorridorPoint[];
  /** Lunghezza effettivamente coperta, m. */
  lengthM: number;
  source: CorridorSource;
  status: CorridorStatus;
  /** 0..1. Dichiarata, non dedotta dal chiamante. */
  confidence: number;
  /**
   * Il corridoio puo' essere usato come evidenza che un evento sia sulla
   * stessa strada. Vero SOLO con geometria stradale reale.
   */
  roadEvidence: boolean;
}

export interface CorridorInput {
  position: LatLon;
  /** Direzione di marcia, gradi. `null` se sconosciuta. */
  heading: number | null;
  /** Velocita', m/s. `null` se sconosciuta. */
  speedMps: number | null;
  /** Geometria gia' disponibile. Assente o vuota = si ripiega sull'heading. */
  roads?: readonly RoadPolyline[];
}

const VUOTO: ForwardCorridor = {
  points: [],
  lengthM: 0,
  source: 'none',
  status: 'unavailable',
  confidence: 0,
  roadEvidence: false,
};

/**
 * Costruisce il corridoio.
 *
 * Funzione pura: stessi dati, stesso risultato. Non legge la UI, non conosce
 * la mappa, non fa richieste.
 */
export function buildForwardCorridor(input: CorridorInput): ForwardCorridor {
  const { position, heading, speedMps } = input;

  // Senza direzione non esiste un "davanti"; sotto la soglia di velocita' la
  // direzione riportata dal GPS e' rumore. In entrambi i casi si dichiara
  // l'assenza invece di indovinare.
  if (heading === null || !Number.isFinite(heading)) return VUOTO;
  if (speedMps === null || !Number.isFinite(speedMps) || speedMps < CORRIDOR.minSpeedMps) {
    return VUOTO;
  }

  const lengthM = Math.min(
    CORRIDOR.maxLengthM,
    Math.max(CORRIDOR.minLengthM, speedMps * CORRIDOR.secondsAhead),
  );

  const daStrada = seguiStrada(position, heading, input.roads ?? [], lengthM);
  if (daStrada) return daStrada;

  return proiettaHeading(position, heading, lengthM);
}

/**
 * Il corridoio puo' essere usato per AFFERMARE che qualcosa si trova sulla
 * strada percorsa?
 *
 * Punto unico della decisione, di proposito: senza, ogni chiamante
 * finirebbe per dedurla a modo suo, e prima o poi qualcuno dedurrebbe male.
 *
 * La risposta dipende da DOVE viene la geometria, non da quanto e' lungo il
 * corridoio ne' dal suo `status`:
 *
 *   road-geometry  strade reali lette dalla cartografia -> si'.
 *                  Vale anche quando il corridoio si e' fermato a una
 *                  biforcazione: il tratto che copre resta strada vera, e
 *                  un'intersezione al suo interno e' davvero sulla strada.
 *
 *   heading        una proiezione da posizione e direzione -> no.
 *                  A trenta metri da una parallela quel corridoio le
 *                  comprende entrambe: non dimostra nulla.
 *
 *   none           nessuna evidenza -> no.
 */
export function allowsRoadRelevance(corridor: ForwardCorridor | null | undefined): boolean {
  return corridor?.roadEvidence === true;
}

/**
 * Adatta il corridoio al contratto `RouteAhead` usato dal motore meteo, senza
 * che quest'ultimo debba sapere da dove venga il percorso.
 */
export function corridorRoute(
  corridor: ForwardCorridor,
): { pointAt: (aheadM: number) => LatLon | null } | null {
  if (corridor.source === 'none' || corridor.points.length === 0) return null;
  const pts = corridor.points;

  return {
    pointAt: (aheadM: number) => {
      if (!Number.isFinite(aheadM) || aheadM < 0) return null;
      // Oltre la fine del corridoio non si estrapola: si dichiara che non si sa.
      if (aheadM > corridor.lengthM) return null;

      for (let i = 1; i < pts.length; i++) {
        const b = pts[i] as CorridorPoint;
        if (aheadM > b.atM) continue;
        const a = pts[i - 1] as CorridorPoint;
        const span = b.atM - a.atM;
        const k = span > 0 ? (aheadM - a.atM) / span : 0;
        return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k };
      }
      const ultimo = pts[pts.length - 1] as CorridorPoint;
      return { lat: ultimo.lat, lon: ultimo.lon };
    },
  };
}

// -- geometria stradale -----------------------------------------------------

interface Aggancio {
  linea: RoadPolyline;
  /** Indice del vertice da cui partire. */
  indice: number;
  /** +1 se la polilinea va percorsa in avanti, -1 all'indietro. */
  verso: 1 | -1;
  distanzaM: number;
}

/**
 * Trova su quale strada si trova il veicolo e in che verso la sta percorrendo.
 *
 * Il verso conta quanto la strada: una polilinea e' un elenco di punti senza
 * direzione di marcia, e agganciarla al contrario produrrebbe un corridoio
 * rivolto all'indietro.
 */
function aggancia(
  position: LatLon,
  heading: number,
  roads: readonly RoadPolyline[],
): Aggancio | null {
  let migliore: Aggancio | null = null;

  for (const linea of roads) {
    const pts = linea.points;
    if (pts.length < 2) continue;

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i] as LatLon;
      const d = distanceM(position, p);
      if (d > CORRIDOR.snapRadiusM) continue;
      if (migliore !== null && d >= migliore.distanzaM) continue;

      // In quale verso questa strada prosegue nella direzione di marcia?
      const avanti = i + 1 < pts.length ? bearingDeg(p, pts[i + 1] as LatLon) : null;
      const indietro = i > 0 ? bearingDeg(p, pts[i - 1] as LatLon) : null;
      const scartoAvanti = avanti === null ? 999 : angleDeltaDeg(heading, avanti);
      const scartoIndietro = indietro === null ? 999 : angleDeltaDeg(heading, indietro);
      const scarto = Math.min(scartoAvanti, scartoIndietro);
      // Una strada che va da tutt'altra parte non e' quella che si percorre.
      if (scarto > CORRIDOR.maxTurnDeg) continue;

      migliore = {
        linea,
        indice: i,
        verso: scartoAvanti <= scartoIndietro ? 1 : -1,
        distanzaM: d,
      };
    }
  }
  return migliore;
}

/** Estremi di una polilinea, per cercare i proseguimenti. */
function estremi(linea: RoadPolyline): { punto: LatLon; indice: number; verso: 1 | -1 }[] {
  const pts = linea.points;
  return [
    { punto: pts[0] as LatLon, indice: 0, verso: 1 },
    { punto: pts[pts.length - 1] as LatLon, indice: pts.length - 1, verso: -1 },
  ];
}

function seguiStrada(
  position: LatLon,
  heading: number,
  roads: readonly RoadPolyline[],
  lengthM: number,
): ForwardCorridor | null {
  const inizio = aggancia(position, heading, roads);
  if (!inizio) return null;

  const tetto = Math.min(lengthM, CORRIDOR.roadMaxLengthM);
  const points: CorridorPoint[] = [];
  const usate = new Set<RoadPolyline>();

  let linea = inizio.linea;
  let indice = inizio.indice;
  let verso = inizio.verso;
  let percorso = 0;
  let rotta = heading;
  let biforcazione = false;

  let corrente = linea.points[indice] as LatLon;
  points.push({ ...corrente, atM: 0 });
  usate.add(linea);

  while (percorso < tetto) {
    const prossimo = indice + verso;

    if (prossimo >= 0 && prossimo < linea.points.length) {
      const p = linea.points[prossimo] as LatLon;
      const passo = distanceM(corrente, p);
      const direzione = bearingDeg(corrente, p);
      // Una strada che ripiega su se' stessa oltre il limite non e' piu' "avanti".
      if (angleDeltaDeg(rotta, direzione) > CORRIDOR.maxTurnDeg) break;

      percorso += passo;
      rotta = direzione;
      corrente = p;
      indice = prossimo;
      points.push({ ...p, atM: percorso });
      continue;
    }

    // Fine della polilinea: si cerca chi la continua.
    const candidati: { linea: RoadPolyline; indice: number; verso: 1 | -1; scarto: number }[] = [];
    for (const altra of roads) {
      if (usate.has(altra) || altra.points.length < 2) continue;
      for (const e of estremi(altra)) {
        if (distanceM(corrente, e.punto) > CORRIDOR.joinRadiusM) continue;
        const vicino = altra.points[e.indice + e.verso] as LatLon | undefined;
        if (!vicino) continue;
        const scarto = angleDeltaDeg(rotta, bearingDeg(e.punto, vicino));
        if (scarto > CORRIDOR.maxTurnDeg) continue;
        candidati.push({ linea: altra, indice: e.indice, verso: e.verso, scarto });
      }
    }

    if (candidati.length === 0) break;

    candidati.sort((a, b) => a.scarto - b.scarto);
    const primo = candidati[0] as (typeof candidati)[number];
    const secondo = candidati[1];
    // Due proseguimenti ugualmente plausibili: e' una biforcazione, e non si
    // sceglie. Il corridoio finisce qui e lo dichiara (ROUTE-05).
    if (secondo !== undefined && Math.abs(secondo.scarto - primo.scarto) <= CORRIDOR.forkAmbiguityDeg) {
      biforcazione = true;
      break;
    }

    linea = primo.linea;
    indice = primo.indice;
    verso = primo.verso;
    usate.add(linea);
  }

  // Un aggancio che non produce un tratto utile non vale come geometria.
  if (points.length < 2) return null;

  return {
    points,
    lengthM: percorso,
    source: 'road-geometry',
    status: biforcazione ? 'uncertain' : 'reliable',
    confidence: biforcazione ? CORRIDOR.forkConfidence : CORRIDOR.reliableConfidence,
    // La geometria c'e': puo' essere usata come evidenza di pertinenza.
    roadEvidence: true,
  };
}

// -- proiezione sull'heading ------------------------------------------------

/**
 * Corridoio senza geometria: una retta nella direzione di marcia.
 *
 * Utile per prevedere un incontro, inutile per stabilire su quale strada si
 * trovi un evento. `roadEvidence: false` lo dice a chiunque lo riceva.
 */
function proiettaHeading(position: LatLon, heading: number, lengthM: number): ForwardCorridor {
  const points: CorridorPoint[] = [{ ...position, atM: 0 }];
  for (let d = CORRIDOR.stepM; d <= lengthM; d += CORRIDOR.stepM) {
    points.push({ ...destinationPoint(position, heading, d), atM: d });
  }
  const ultimo = points[points.length - 1] as CorridorPoint;

  return {
    points,
    lengthM: ultimo.atM,
    source: 'heading',
    // Mai `reliable`: una proiezione non diventa una strada.
    status: 'uncertain',
    confidence: CORRIDOR.headingConfidence,
    roadEvidence: false,
  };
}
