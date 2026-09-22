/**
 * ROAD SENSE - percorso della DEMO MODE.
 *
 * FILE GENERATO. Non modificare a mano: rigenerare con `npm run demo:route`
 * (vedi `scripts/build-demo-route.mjs`).
 *
 * Sono coordinate REALI che seguono strade realmente esistenti a Milano,
 * estratte una sola volta dalle vector tile di OpenStreetMap e congelate qui.
 * A runtime la demo e' quindi completamente OFFLINE e DETERMINISTICA: nessun
 * servizio di routing, nessuna chiave API, nessun account, nessuna rete.
 *
 * Dati cartografici (c) OpenStreetMap contributors, licenza ODbL.
 * https://www.openstreetmap.org/copyright
 *
 * Generato il 2026-09-22
 * Versione dei dati: 20260913_164504_pt
 * Punti: 83 - lunghezza: 5.76 km
 *
 * NOTA: il grafo e' trattato come non orientato, quindi il percorso puo'
 * ignorare i sensi unici. E' irrilevante: serve a muovere un marker lungo
 * strade plausibili, non a simulare la circolazione.
 */

/** Punto del percorso: [latitudine, longitudine]. */
export type RoutePoint = readonly [number, number];

/** Centro dell'area demo, usato per inquadrare la mappa all'avvio. */
export const DEMO_ROUTE_CENTER = { lat: 45.4642, lon: 9.19 } as const;

/** Lunghezza complessiva del percorso, in metri. */
export const DEMO_ROUTE_LENGTH_M = 5761;

export const DEMO_ROUTE: readonly RoutePoint[] = [
  [45.470567, 9.190063],
  [45.469702, 9.190965],
  [45.470436, 9.192252],
  [45.470755, 9.192456],
  [45.471158, 9.192633],
  [45.470763, 9.193481],
  [45.470063, 9.192783],
  [45.469405, 9.193835],
  [45.467366, 9.196249],
  [45.467595, 9.196694],
  [45.467121, 9.197252],
  [45.466847, 9.197257],
  [45.466801, 9.198115],
  [45.466805, 9.199065],
  [45.465838, 9.199312],
  [45.46568, 9.199414],
  [45.465233, 9.199424],
  [45.464954, 9.199296],
  [45.464288, 9.198813],
  [45.463483, 9.198089],
  [45.463408, 9.19796],
  [45.463223, 9.198807],
  [45.459581, 9.195342],
  [45.457602, 9.193389],
  [45.458569, 9.191828],
  [45.458321, 9.191523],
  [45.458723, 9.190868],
  [45.458483, 9.190605],
  [45.458118, 9.190321],
  [45.458072, 9.189913],
  [45.458727, 9.189752],
  [45.459039, 9.189468],
  [45.459043, 9.189409],
  [45.458283, 9.187794],
  [45.458287, 9.187671],
  [45.458595, 9.18722],
  [45.458031, 9.186421],
  [45.458001, 9.18626],
  [45.458381, 9.185396],
  [45.458772, 9.184667],
  [45.460127, 9.181459],
  [45.460153, 9.181298],
  [45.460353, 9.181486],
  [45.460447, 9.181625],
  [45.461019, 9.181513],
  [45.461606, 9.181497],
  [45.461621, 9.181641],
  [45.462174, 9.181523],
  [45.46246, 9.181153],
  [45.462772, 9.18096],
  [45.463024, 9.180863],
  [45.463502, 9.180949],
  [45.463995, 9.180783],
  [45.464111, 9.180665],
  [45.464111, 9.18074],
  [45.464251, 9.181051],
  [45.46454, 9.181196],
  [45.464589, 9.181926],
  [45.464845, 9.181883],
  [45.464947, 9.181743],
  [45.465443, 9.180944],
  [45.465643, 9.180413],
  [45.465993, 9.180638],
  [45.466798, 9.181346],
  [45.466715, 9.181416],
  [45.466485, 9.182183],
  [45.466752, 9.182366],
  [45.466933, 9.18243],
  [45.467084, 9.182387],
  [45.467227, 9.182805],
  [45.467941, 9.182339],
  [45.46796, 9.182494],
  [45.468092, 9.182661],
  [45.468284, 9.182671],
  [45.468577, 9.182822],
  [45.468701, 9.184227],
  [45.468829, 9.18516],
  [45.46898, 9.185488],
  [45.469172, 9.188229],
  [45.469341, 9.189988],
  [45.469439, 9.190466],
  [45.469702, 9.190965],
  [45.470567, 9.190063],
] as const;
