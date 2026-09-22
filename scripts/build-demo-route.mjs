/**
 * ROAD SENSE - generatore della route della DEMO MODE.
 *
 * ESEGUITO UNA SOLA VOLTA IN FASE DI SVILUPPO: `npm run demo:route`.
 * Non fa parte dell'applicazione e non viene eseguito a runtime.
 *
 * COME FUNZIONA
 * Le vector tile che ROAD SENSE gia' scarica per disegnare la mappa contengono
 * la geometria stradale di OpenStreetMap. Lo script ne scarica alcune, le
 * decodifica, costruisce un grafo dei segmenti carrabili e calcola con
 * Dijkstra un circuito chiuso passante per quattro waypoint attorno al centro.
 * Il risultato viene congelato in `src/demo/demoRoute.ts`.
 *
 * PERCHE' COSI'
 * Il percorso deve seguire strade reali, ma la demo non deve dipendere da
 * servizi di routing, chiavi API o account. Generare una volta e congelare
 * soddisfa entrambe le cose: a runtime la demo e' completamente offline e
 * deterministica.
 *
 * DATI: (c) OpenStreetMap contributors, ODbL.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeTile, lonLatToTile, tileToLonLat } from './lib/mvt.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'src', 'demo', 'demoRoute.ts');

const CENTER = { lat: 45.4642, lon: 9.19 };
const ZOOM = 14;
const RING = 1; // 3x3 tile attorno al centro
/** Classi di OpenMapTiles considerate carrabili per un'automobile. */
const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']);
/** Distanza dei waypoint dal centro, in metri. */
const WAYPOINT_RADIUS_M = 700;
/** Tolleranza di semplificazione della polilinea finale, in metri. */
const SIMPLIFY_M = 2;
/** Passo di aggancio dei nodi del grafo, in gradi (~2.2 m). */
const SNAP = 2e-5;

const EARTH_R = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;

function distanceM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function destination(origin, bearingDeg, distM) {
  const ang = distM / EARTH_R;
  const br = toRad(bearingDeg);
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
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

const nodeKey = (lon, lat) =>
  `${Math.round(lon / SNAP)}:${Math.round(lat / SNAP)}`;

// ---------------------------------------------------------------------------

async function fetchTiles() {
  const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
  const template = tj.tiles[0];
  const { x: cx, y: cy } = lonLatToTile(ZOOM, CENTER.lon, CENTER.lat);
  const tiles = [];
  for (let dx = -RING; dx <= RING; dx++) {
    for (let dy = -RING; dy <= RING; dy++) {
      const tx = cx + dx;
      const ty = cy + dy;
      const url = template.replace('{z}', ZOOM).replace('{x}', tx).replace('{y}', ty);
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`  tile ${tx}/${ty}: HTTP ${res.status}, saltata`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      tiles.push({ tx, ty, buf });
      process.stdout.write(`  tile ${tx}/${ty}: ${(buf.length / 1024).toFixed(0)} kB\n`);
    }
  }
  return { tiles, dataVersion: template.split('/')[4] ?? 'sconosciuta' };
}

/** Costruisce il grafo: nodi agganciati a griglia, archi = segmenti stradali. */
function buildGraph(tiles) {
  const nodes = new Map(); // key -> { lon, lat, edges: [{ to, w }] }
  let segments = 0;

  const ensure = (lon, lat) => {
    const k = nodeKey(lon, lat);
    let n = nodes.get(k);
    if (!n) {
      n = { key: k, lon, lat, edges: [] };
      nodes.set(k, n);
    }
    return n;
  };

  for (const { tx, ty, buf } of tiles) {
    const layers = decodeTile(buf);
    const tr = layers.transportation;
    if (!tr) continue;
    for (const f of tr.features) {
      if (f.type !== 2) continue; // solo LineString
      if (!DRIVABLE.has(f.props.class)) continue;
      for (const line of f.geometry) {
        for (let i = 0; i + 1 < line.length; i++) {
          const [lon1, lat1] = tileToLonLat(ZOOM, tx, ty, line[i][0], line[i][1], tr.extent);
          const [lon2, lat2] = tileToLonLat(ZOOM, tx, ty, line[i + 1][0], line[i + 1][1], tr.extent);
          const a = ensure(lon1, lat1);
          const b = ensure(lon2, lat2);
          if (a === b) continue;
          const w = distanceM(a, b);
          if (w <= 0) continue;
          // Grafo non orientato: la demo non simula i sensi unici.
          a.edges.push({ to: b.key, w });
          b.edges.push({ to: a.key, w });
          segments++;
        }
      }
    }
  }
  return { nodes, segments };
}

function nearestNode(nodes, target) {
  let best = null;
  let bestD = Infinity;
  for (const n of nodes.values()) {
    const d = distanceM(n, target);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return { node: best, distance: bestD };
}

/** Dijkstra con coda a estrazione lineare: il grafo e' piccolo, basta. */
function shortestPath(nodes, fromKey, toKey) {
  const dist = new Map([[fromKey, 0]]);
  const prev = new Map();
  const visited = new Set();
  const frontier = new Set([fromKey]);

  while (frontier.size > 0) {
    let uKey = null;
    let uDist = Infinity;
    for (const k of frontier) {
      const d = dist.get(k) ?? Infinity;
      if (d < uDist) {
        uDist = d;
        uKey = k;
      }
    }
    if (uKey === null) break;
    frontier.delete(uKey);
    if (visited.has(uKey)) continue;
    visited.add(uKey);
    if (uKey === toKey) break;

    for (const e of nodes.get(uKey).edges) {
      if (visited.has(e.to)) continue;
      const nd = uDist + e.w;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, uKey);
        frontier.add(e.to);
      }
    }
  }

  if (!dist.has(toKey)) return null;
  const path = [];
  let cur = toKey;
  while (cur !== undefined) {
    path.unshift(nodes.get(cur));
    if (cur === fromKey) break;
    cur = prev.get(cur);
  }
  return path[0]?.key === fromKey ? path : null;
}

/** Semplificazione Douglas-Peucker con tolleranza in metri. */
function simplify(points, toleranceM) {
  if (points.length < 3) return points;
  const sqTol = toleranceM * toleranceM;

  // Distanza punto-segmento approssimata in metri (piano locale).
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(toRad(points[0].lat));
  const px = (p) => p.lon * mPerDegLon;
  const py = (p) => p.lat * mPerDegLat;

  const sqSegDist = (p, a, b) => {
    let x = px(a);
    let y = py(a);
    let dx = px(b) - x;
    let dy = py(b) - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((px(p) - x) * dx + (py(p) - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = px(b);
        y = py(b);
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = px(p) - x;
    dy = py(p) - y;
    return dx * dx + dy * dy;
  };

  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let maxSq = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(points[i], points[first], points[last]);
      if (sq > maxSq) {
        maxSq = sq;
        index = i;
      }
    }
    if (maxSq > sqTol && index > 0) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// ---------------------------------------------------------------------------

console.log('ROAD SENSE - generazione della route demo');
console.log(`  area: ${CENTER.lat}, ${CENTER.lon}  zoom ${ZOOM}`);

const { tiles, dataVersion } = await fetchTiles();
if (tiles.length === 0) throw new Error('nessuna tile scaricata');

const { nodes, segments } = buildGraph(tiles);
console.log(`  grafo: ${nodes.size} nodi, ${segments} segmenti carrabili`);

// Quattro waypoint attorno al centro: producono un circuito urbano chiuso.
const waypoints = [0, 90, 180, 270].map((bearing) => {
  const target = destination(CENTER, bearing, WAYPOINT_RADIUS_M);
  const { node, distance } = nearestNode(nodes, target);
  console.log(`  waypoint ${bearing}deg -> nodo a ${distance.toFixed(0)} m dal punto ideale`);
  return node;
});

const full = [];
for (let i = 0; i < waypoints.length; i++) {
  const from = waypoints[i];
  const to = waypoints[(i + 1) % waypoints.length];
  const leg = shortestPath(nodes, from.key, to.key);
  if (!leg) throw new Error(`nessun percorso tra i waypoint ${i} e ${(i + 1) % waypoints.length}`);
  // Il primo punto di ogni tratta coincide con l'ultimo della precedente.
  full.push(...(i === 0 ? leg : leg.slice(1)));
}

const simplified = simplify(full, SIMPLIFY_M);

let length = 0;
for (let i = 0; i + 1 < simplified.length; i++) length += distanceM(simplified[i], simplified[i + 1]);
const closure = distanceM(simplified[0], simplified[simplified.length - 1]);

console.log(`  percorso: ${full.length} punti -> ${simplified.length} dopo semplificazione`);
console.log(`  lunghezza: ${(length / 1000).toFixed(2)} km`);
console.log(`  chiusura dell'anello: ${closure.toFixed(1)} m`);

const coords = simplified.map((p) => [
  Math.round(p.lat * 1e6) / 1e6,
  Math.round(p.lon * 1e6) / 1e6,
]);

const body = coords.map(([lat, lon]) => `  [${lat}, ${lon}],`).join('\n');

writeFileSync(
  OUT,
  `/**
 * ROAD SENSE - percorso della DEMO MODE.
 *
 * FILE GENERATO. Non modificare a mano: rigenerare con \`npm run demo:route\`
 * (vedi \`scripts/build-demo-route.mjs\`).
 *
 * Sono coordinate REALI che seguono strade realmente esistenti a Milano,
 * estratte una sola volta dalle vector tile di OpenStreetMap e congelate qui.
 * A runtime la demo e' quindi completamente OFFLINE e DETERMINISTICA: nessun
 * servizio di routing, nessuna chiave API, nessun account, nessuna rete.
 *
 * Dati cartografici (c) OpenStreetMap contributors, licenza ODbL.
 * https://www.openstreetmap.org/copyright
 *
 * Generato il ${new Date().toISOString().slice(0, 10)}
 * Versione dei dati: ${dataVersion}
 * Punti: ${coords.length} - lunghezza: ${(length / 1000).toFixed(2)} km
 *
 * NOTA: il grafo e' trattato come non orientato, quindi il percorso puo'
 * ignorare i sensi unici. E' irrilevante: serve a muovere un marker lungo
 * strade plausibili, non a simulare la circolazione.
 */

/** Punto del percorso: [latitudine, longitudine]. */
export type RoutePoint = readonly [number, number];

/** Centro dell'area demo, usato per inquadrare la mappa all'avvio. */
export const DEMO_ROUTE_CENTER = { lat: ${CENTER.lat}, lon: ${CENTER.lon} } as const;

/** Lunghezza complessiva del percorso, in metri. */
export const DEMO_ROUTE_LENGTH_M = ${Math.round(length)};

export const DEMO_ROUTE: readonly RoutePoint[] = [
${body}
] as const;
`,
  'utf8',
);

console.log(`  scritto: ${OUT}`);
