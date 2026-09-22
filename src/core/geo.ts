/**
 * ROAD SENSE - utilita' geografiche.
 * Funzioni pure, testabili, senza dipendenze.
 */

const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * Distanza ortodromica in metri (formula dell'emiseno).
 * Precisione piu' che sufficiente alle distanze stradali.
 */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Direzione iniziale da `a` verso `b`, in gradi 0..359 (nord = 0, orario). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

/** Riporta un angolo qualsiasi nell'intervallo [0, 360). */
export function normalizeDeg(deg: number): number {
  const d = deg % 360;
  const r = d < 0 ? d + 360 : d;
  // Un valore negativo infinitesimo (-1e-16) sommato a 360 arrotonda
  // esattamente a 360, che e' fuori dal contratto [0, 360) e verrebbe
  // rifiutato dalla validazione di `heading`.
  return r >= 360 ? 0 : r;
}

/**
 * Differenza angolare minima tra due direzioni, in [0, 180].
 * Usata per capire se un evento e' "davanti" e se la carreggiata e' la stessa.
 */
export function angleDeltaDeg(a: number, b: number): number {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/** Punto a distanza `distM` e direzione `bearing` da `origin`. */
export function destinationPoint(origin: LatLon, bearing: number, distM: number): LatLon {
  const ang = distM / EARTH_RADIUS_M;
  const br = toRad(bearing);
  const lat1 = toRad(origin.lat);
  const lon1 = toRad(origin.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(br),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(br) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lon: normalizeLon(toDeg(lon2)) };
}

/** Riporta una longitudine nell'intervallo [-180, 180). */
export function normalizeLon(lon: number): number {
  return ((lon + 540) % 360) - 180;
}

/**
 * Media circolare di un insieme di direzioni (gradi).
 * Necessaria perche' la media aritmetica di 350 e 10 darebbe 180, non 0.
 * Ritorna null se l'insieme e' vuoto o privo di direzione dominante.
 */
export function averageHeading(headings: readonly number[]): number | null {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const h of headings) {
    if (!Number.isFinite(h)) continue;
    x += Math.cos(toRad(h));
    y += Math.sin(toRad(h));
    n++;
  }
  if (n === 0) return null;
  // Vettore risultante troppo corto: direzioni contrastanti, nessuna media sensata.
  if (Math.hypot(x, y) / n < 0.2) return null;
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

/** Arrotonda una coordinata al numero di decimali indicato. */
export function roundCoord(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Formattazione compatta di una distanza per la UI. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '--';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Conversione m/s -> km/h arrotondata. */
export function mpsToKmh(mps: number): number {
  return Math.round(mps * 3.6);
}
